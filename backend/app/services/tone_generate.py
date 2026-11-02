"""Ephemeral tone generation: scoped context, bounded model calls, count-only audit."""

import uuid

from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session, col, or_, select

from app.domain.tone import (
    InvalidToneOutput,
    NoValidTones,
    ToneCandidate,
    filter_generated_tones,
)
from app.domain.tone_prompt import TONE_PROMPT_VERSION, build_tone_prompt
from app.models import Product, ScenarioTemplate
from app.ports.llm import LlmClient, LlmMessage, LlmRequest
from app.services.audit import record_audit
from app.services.errors import ModelUnavailableError, NotFoundError
from app.services.tone_suggestions import suggestions
from app.services.voice_profiles import DbVoiceProfileProvider

MAX_RETRIES = 2


class ToneGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scene: str | None = Field(default=None, min_length=1, max_length=20)
    product_id: uuid.UUID | None = None
    count: int = Field(default=5, ge=1, le=5, strict=True)


class GeneratedTones(BaseModel):
    items: list[ToneCandidate]
    model: str
    prompt_version: str = TONE_PROMPT_VERSION


def generate_tones(
    *,
    session: Session,
    brand_id: uuid.UUID,
    actor_id: uuid.UUID,
    data: ToneGenerateRequest,
    llm: LlmClient,
) -> GeneratedTones:
    product_data: dict[str, object] | None = None
    if data.product_id is not None:
        product = session.exec(
            select(Product).where(
                Product.id == data.product_id, Product.brand_id == brand_id
            )
        ).first()
        if product is None:
            raise NotFoundError("Product not found")
        product_data = {
            "category": product.category,
            "product_line": product.product_line,
        }
    scene_name = None
    if data.scene is not None:
        scenario = session.exec(
            select(ScenarioTemplate)
            .where(
                ScenarioTemplate.scene == data.scene,
                or_(
                    ScenarioTemplate.brand_id == brand_id,
                    col(ScenarioTemplate.brand_id).is_(None),
                ),
            )
            .order_by(
                col(ScenarioTemplate.brand_id).asc().nulls_last(),
                col(ScenarioTemplate.id),
            )
        ).first()
        # Unknown keys have the same permissive behaviour as PR1; do not guess a name.
        scene_name = scenario.name if scenario else data.scene
    voice = DbVoiceProfileProvider(session).get_active(brand_id=brand_id)
    profile: dict[str, object] | None = None
    if voice is not None:
        profile = {
            "tone_keywords": voice.tone_keywords,
            "persona": voice.persona,
            "preferred_words": voice.preferred_words,
            "forbidden_words": voice.forbidden_words,
        }
    groups = suggestions(session=session, brand_id=brand_id, scene=data.scene)
    tones = {
        "history": [row.tone for row in groups.history],
        "template": [row.tone for row in groups.template],
        "results": [row.tone for row in groups.results.items],
    }
    system, context = build_tone_prompt(
        profile=profile,
        product=product_data,
        scene_name=scene_name,
        existing_tones=tones,
        count=data.count,
    )
    request = LlmRequest(
        messages=(LlmMessage("system", system), LlmMessage("user", context)),
        json_mode=True,
        max_tokens=1000,
        purpose="tone_suggestions",
    )
    # The production adapter has max_retries=0, so these are at most three wire calls in total.
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = llm.complete(request)
            if not response.text.strip():
                raise ModelUnavailableError("语气模型返回空响应")
            items = filter_generated_tones(
                response.text,
                existing=[tone for group in tones.values() for tone in group],
                forbidden_words=voice.forbidden_words if voice else (),
                count=data.count,
            )
        except ModelUnavailableError, InvalidToneOutput, NoValidTones:
            if attempt == MAX_RETRIES:
                raise
            continue
        result = GeneratedTones(items=items, model=response.model)
        record_audit(
            session,
            action="tone.generate",
            entity_type="brand",
            actor_id=actor_id,
            brand_id=brand_id,
            entity_id=brand_id,
            detail={"count": len(items)},
        )
        session.commit()
        return result
    raise AssertionError("bounded loop must return or raise")
