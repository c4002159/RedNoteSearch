"""The models the system can call and what they cost. Prices come from configuration (ADR-006); with no
price configured the cost is simply unknown, never guessed."""

from decimal import Decimal

from app.core.config import settings
from app.infra.openai_compat import Price
from app.models import ModelInfo


def list_models() -> list[ModelInfo]:
    enabled = bool(settings.DEEPSEEK_API_KEY)
    return [
        ModelInfo(
            id=model_id,
            provider="deepseek",
            model_name=model_id,
            enabled=enabled,
            price_in_per_1k=settings.DEEPSEEK_PRICE_IN_PER_1K,
            price_out_per_1k=settings.DEEPSEEK_PRICE_OUT_PER_1K,
            price_version=settings.LLM_PRICE_VERSION,
        )
        for model_id in settings.DEEPSEEK_MODELS
    ]


def known_model_ids() -> set[str]:
    return {m.id for m in list_models()}


def price_for(model_id: str) -> Price | None:
    """The configured price of a model per million tokens, or ``None`` when not configured."""
    info = next((m for m in list_models() if m.id == model_id), None)
    if (
        info is None
        or info.price_in_per_1k is None
        or info.price_out_per_1k is None
        or not info.price_version
    ):
        return None
    return Price(
        version=info.price_version,
        input_per_million=Decimal(str(info.price_in_per_1k)) * 1000,
        output_per_million=Decimal(str(info.price_out_per_1k)) * 1000,
    )
