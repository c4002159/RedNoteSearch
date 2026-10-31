import uuid
from collections.abc import Callable
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from sqlmodel import Session

from app.api.brand_deps import BrandAccessDep
from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.core.db import engine
from app.infra.openai_compat import OpenAICompatibleClient
from app.models import BrandMember, MemberRole, ScenarioPublic
from app.models.viral import (
    ViralAnalyzeRequest,
    ViralPattern,
    ViralPatternPublic,
    ViralPatternsPublic,
    ViralSample,
    ViralSampleCreate,
    ViralSampleListItem,
    ViralSamplePublic,
    ViralSamplesPublic,
    ViralToTemplateRequest,
)
from app.ports.llm import LlmClient
from app.services import model_catalog, viral
from app.services.errors import NotFoundError
from app.services.llm_log import DbLlmCallRecorder

router = APIRouter(tags=["viral"])
ViralLlmFactory = Callable[[uuid.UUID, str], LlmClient]


def get_viral_llm_factory() -> ViralLlmFactory:
    def build(brand_id: uuid.UUID, model_id: str) -> LlmClient:
        return OpenAICompatibleClient(
            provider="deepseek",
            model=model_id,
            base_url=settings.DEEPSEEK_BASE_URL,
            api_key=settings.DEEPSEEK_API_KEY,
            price=model_catalog.price_for(model_id),
            recorder=DbLlmCallRecorder(lambda: Session(engine), brand_id=brand_id),
            max_retries=0,
        )

    return build


def get_sample(
    sample_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> ViralSample:
    row = session.get(ViralSample, sample_id)
    if row is None or session.get(BrandMember, (row.brand_id, user.id)) is None:
        raise NotFoundError("Sample not found")
    return row


def get_pattern(
    pattern_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> ViralPattern:
    row = session.get(ViralPattern, pattern_id)
    if row is None or session.get(BrandMember, (row.brand_id, user.id)) is None:
        raise NotFoundError("Pattern not found")
    return row


SampleDep = Annotated[ViralSample, Depends(get_sample)]
PatternDep = Annotated[ViralPattern, Depends(get_pattern)]


@router.post(
    "/brands/{brand_id}/viral-samples",
    response_model=ViralSamplePublic,
    status_code=201,
)
def create_sample(
    access: BrandAccessDep, session: SessionDep, body: ViralSampleCreate
) -> ViralSamplePublic:
    """Save a manually supplied text sample within one brand."""
    return ViralSamplePublic.model_validate(
        viral.create_sample(session, access.brand_id, access.user_id, body),
        from_attributes=True,
    )


@router.get("/brands/{brand_id}/viral-samples", response_model=ViralSamplesPublic)
def read_samples(
    access: BrandAccessDep,
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    sort: Literal["created_at", "-created_at"] = "-created_at",
) -> ViralSamplesPublic:
    """List sample metadata, without returning full text."""
    rows, total = viral.list_samples(
        session, access.brand_id, page, page_size, sort == "-created_at"
    )
    return ViralSamplesPublic(
        items=[
            ViralSampleListItem(
                id=r.id,
                brand_id=r.brand_id,
                note=r.note,
                source_url=r.source_url,
                created_at=r.created_at,
                char_count=len(r.text),
                excerpt=r.text[:200],
            )
            for r in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/viral-samples/{sample_id}", response_model=ViralSamplePublic)
def read_sample(sample: SampleDep) -> ViralSamplePublic:
    """Read the original sample text after refreshing the page."""
    return ViralSamplePublic.model_validate(sample, from_attributes=True)


@router.get("/viral-samples/{sample_id}/patterns", response_model=ViralPatternsPublic)
def read_patterns(
    sample: SampleDep,
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ViralPatternsPublic:
    """Read saved analyses, newest first."""
    rows, total = viral.list_patterns(session, sample, page, page_size)
    return ViralPatternsPublic(
        items=[ViralPatternPublic.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/viral-patterns/{pattern_id}", response_model=ViralPatternPublic)
def read_pattern(pattern: PatternDep) -> ViralPatternPublic:
    """Read one saved structural analysis."""
    return ViralPatternPublic.model_validate(pattern)


@router.post(
    "/viral-samples/{sample_id}/analyze",
    response_model=ViralPatternPublic,
    status_code=201,
)
def analyze_sample(
    sample: SampleDep,
    session: SessionDep,
    user: CurrentUser,
    body: ViralAnalyzeRequest,
    llm_factory: Annotated[ViralLlmFactory, Depends(get_viral_llm_factory)],
) -> ViralPatternPublic:
    """Analyze synchronously; callers should allow at least ninety seconds."""
    if body.model_id not in model_catalog.known_model_ids():
        raise RequestValidationError(
            [
                {
                    "loc": ("body", "model_id"),
                    "msg": "Unknown model",
                    "type": "value_error",
                }
            ]
        )
    return ViralPatternPublic.model_validate(
        viral.analyze(
            session,
            sample,
            user.id,
            body.model_id,
            llm_factory(sample.brand_id, body.model_id),
        )
    )


@router.post(
    "/viral-patterns/{pattern_id}/to-template",
    response_model=ScenarioPublic,
    status_code=201,
)
def convert_pattern(
    pattern: PatternDep,
    session: SessionDep,
    user: CurrentUser,
    body: ViralToTemplateRequest,
) -> ScenarioPublic:
    """Create the next version of a brand scene template; only brand admins may convert."""
    member = session.get(BrandMember, (pattern.brand_id, user.id))
    if member is None or member.role != MemberRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Brand admin role required")
    return ScenarioPublic.model_validate(
        viral.to_template(session, pattern, user.id, body), from_attributes=True
    )
