import uuid

from sqlmodel import Session, col, func, select

from app.domain.viral import (
    CHECKER_VERSION,
    PROMPT_VERSION,
    ViralAnalysis,
    analysis_messages,
    contains_copied_text,
    has_format_artifacts,
)
from app.models import ScenarioTemplate
from app.models.viral import (
    ViralPattern,
    ViralSample,
    ViralSampleCreate,
    ViralToTemplateRequest,
)
from app.ports.llm import LlmClient, LlmMessage, LlmRequest
from app.services import scenarios
from app.services.audit import record_audit
from app.services.errors import InvalidModelOutputError
from app.services.llm_structured import LlmOutputError, generate_structured


def create_sample(
    session: Session, brand_id: uuid.UUID, actor_id: uuid.UUID, data: ViralSampleCreate
) -> ViralSample:
    row = ViralSample(brand_id=brand_id, created_by=actor_id, **data.model_dump())
    session.add(row)
    record_audit(
        session,
        action="viral.sample_create",
        entity_type="viral_sample",
        actor_id=actor_id,
        brand_id=brand_id,
        entity_id=row.id,
        detail={"char_count": len(row.text)},
    )
    session.commit()
    session.refresh(row)
    return row


def list_samples(
    session: Session, brand_id: uuid.UUID, page: int, page_size: int, newest: bool
) -> tuple[list[ViralSample], int]:
    where = ViralSample.brand_id == brand_id
    total = session.exec(
        select(func.count()).select_from(ViralSample).where(where)
    ).one()
    rows = session.exec(
        select(ViralSample)
        .where(where)
        .order_by(
            col(ViralSample.created_at).desc()
            if newest
            else col(ViralSample.created_at),
            col(ViralSample.id),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def list_patterns(
    session: Session, sample: ViralSample, page: int, page_size: int
) -> tuple[list[ViralPattern], int]:
    where = (
        ViralPattern.sample_id == sample.id,
        ViralPattern.brand_id == sample.brand_id,
    )
    total = session.exec(
        select(func.count()).select_from(ViralPattern).where(*where)
    ).one()
    rows = session.exec(
        select(ViralPattern)
        .where(*where)
        .order_by(col(ViralPattern.created_at).desc(), col(ViralPattern.id).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def analyze(
    session: Session,
    sample: ViralSample,
    actor_id: uuid.UUID,
    model_id: str,
    llm: LlmClient,
) -> ViralPattern:
    # End the read transaction first: the model call can take a minute and must not hold a connection
    # inside an open transaction.
    session.rollback()
    messages = analysis_messages(sample.text)
    analysis: ViralAnalysis | None = None
    reason = "schema_invalid"
    for _ in range(2):
        try:
            generated = generate_structured(
                llm,
                LlmRequest(messages=messages, purpose="viral_analyze", temperature=0.3),
                ViralAnalysis,
                max_attempts=1,
            )
        except LlmOutputError:
            reason = "schema_invalid"
        else:
            if contains_copied_text(sample.text, generated.value):
                reason = "copied_text"
            elif has_format_artifacts(generated.value):
                reason = "format_invalid"
            else:
                analysis = generated.value
                break
        messages += (
            LlmMessage(
                "user",
                f"上次分析不符合要求（{reason}），请仅返回结构描述和一段通顺的中文写作指引，不使用花括号、方括号或代码块，不复用样本原句。",
            ),
        )
    if analysis is None:
        raise InvalidModelOutputError(
            "The structural analysis output was rejected", {"reason": reason}
        )
    row = ViralPattern(
        sample_id=sample.id,
        brand_id=sample.brand_id,
        model_id=model_id,
        prompt_version=PROMPT_VERSION,
        checker_version=CHECKER_VERSION,
        **analysis.model_dump(),
    )
    session.add(row)
    record_audit(
        session,
        action="viral.analyze",
        entity_type="viral_pattern",
        actor_id=actor_id,
        brand_id=sample.brand_id,
        entity_id=row.id,
        detail={
            "sample_id": str(sample.id),
            "model_id": model_id,
            "prompt_version": PROMPT_VERSION,
            "checker_version": CHECKER_VERSION,
        },
    )
    session.commit()
    session.refresh(row)
    return row


def to_template(
    session: Session,
    pattern: ViralPattern,
    actor_id: uuid.UUID,
    data: ViralToTemplateRequest,
) -> ScenarioTemplate:
    try:
        row = scenarios.add_brand_template(
            session,
            brand_id=pattern.brand_id,
            scene=data.scene.value,
            name=data.name,
            structure=pattern.abstract_template,
            source_pattern_id=pattern.id,
        )
        record_audit(
            session,
            action="viral.to_template",
            entity_type="scenario_template",
            actor_id=actor_id,
            brand_id=pattern.brand_id,
            entity_id=row.id,
            detail={
                "pattern_id": str(pattern.id),
                "template_version": row.template_version,
            },
        )
        session.commit()
        session.refresh(row)
        return row
    except Exception:
        session.rollback()
        raise
