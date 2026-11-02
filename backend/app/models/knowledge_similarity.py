from typing import Literal

from pydantic import BaseModel, Field

from app.domain.knowledge_similarity import SimilarDocument as SimilarDocument


class SimilarityPreview(BaseModel):
    status: Literal["ready", "unavailable"]
    message: str
    items: list[SimilarDocument] = Field(default_factory=list)
    token: str | None = None
