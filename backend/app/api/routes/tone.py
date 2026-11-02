import uuid
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlmodel import Session

from app.api.brand_deps import BrandAccessDep
from app.api.deps import SessionDep
from app.core.config import settings
from app.core.db import engine
from app.core.errors import error_response
from app.domain.tone import InvalidToneOutput, NoValidTones, ToneSuggestions
from app.fakes.demo_llm import DemoLlmClient
from app.infra.openai_compat import OpenAICompatibleClient
from app.ports.llm import LlmClient
from app.services import model_catalog, provider_keys
from app.services.llm_log import DbLlmCallRecorder
from app.services.tone_generate import (
    GeneratedTones,
    ToneGenerateRequest,
    generate_tones,
)
from app.services.tone_suggestions import suggestions

router = APIRouter(tags=["tone"])


@router.get("/brands/{brand_id}/tone-suggestions", response_model=ToneSuggestions)
def read_tone_suggestions(
    access: BrandAccessDep,
    session: SessionDep,
    scene: Annotated[str | None, Query(min_length=1, max_length=20)] = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
) -> ToneSuggestions:
    """Scene filters task history and results; presets and structures remain brand-wide."""
    return suggestions(
        session=session, brand_id=access.brand_id, scene=scene, limit=limit
    )


ToneLlmFactory = Callable[[uuid.UUID], LlmClient]


def get_tone_llm_factory() -> ToneLlmFactory:
    def build(brand_id: uuid.UUID) -> LlmClient:
        if settings.LLM_MODE == "demo_fake":
            return DemoLlmClient()
        return OpenAICompatibleClient(
            provider="deepseek",
            model=settings.DEEPSEEK_MODEL,
            base_url=settings.DEEPSEEK_BASE_URL,
            api_key=provider_keys.resolve_key("deepseek"),
            price=model_catalog.price_for(settings.DEEPSEEK_MODEL),
            recorder=DbLlmCallRecorder(lambda: Session(engine), brand_id=brand_id),
            max_retries=0,
        )

    return build


@router.post(
    "/brands/{brand_id}/tone-suggestions/generate", response_model=GeneratedTones
)
def generate_tone_suggestions(
    request: Request,
    access: BrandAccessDep,
    session: SessionDep,
    body: ToneGenerateRequest,
    llm_factory: Annotated[ToneLlmFactory, Depends(get_tone_llm_factory)],
) -> GeneratedTones | Response:
    try:
        return generate_tones(
            session=session,
            brand_id=access.brand_id,
            actor_id=access.user_id,
            data=body,
            llm=llm_factory(access.brand_id),
        )
    except (InvalidToneOutput, NoValidTones) as exc:
        return error_response(
            request,
            status_code=422,
            code="TONE_NO_VALID_SUGGESTIONS"
            if isinstance(exc, NoValidTones)
            else "TONE_INVALID_MODEL_OUTPUT",
            message=str(exc),
        )
