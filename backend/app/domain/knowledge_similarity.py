"""Aggregate nearest-neighbour hits, reserve exact-title matches, never invent a score."""

import uuid
from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel, Field


class SimilarDocument(BaseModel):
    id: uuid.UUID
    title: str
    similarity: float | None = None
    reasons: list[Literal["title_match", "content_near"]] = Field(default_factory=list)


def merge_similarities(
    title_matches: Sequence[tuple[uuid.UUID, str]],
    hits: Sequence[tuple[uuid.UUID, str, float]],
    limit: int = 10,
) -> list[SimilarDocument]:
    # These DTOs are Pydantic values, without database/model dependencies.
    items = {
        id_: SimilarDocument(id=id_, title=title, reasons=["title_match"])
        for id_, title in title_matches[:limit]
    }
    for id_, title, score in hits:
        row = items.setdefault(id_, SimilarDocument(id=id_, title=title))
        if row.similarity is None or score > row.similarity:
            row.similarity = max(0.0, min(1.0, score))
        if "content_near" not in row.reasons:
            row.reasons.append("content_near")
    reserved = {id_ for id_, _ in title_matches[:limit]}

    def order(row: SimilarDocument) -> tuple[float, str]:
        return (-(row.similarity if row.similarity is not None else -1), str(row.id))

    chosen = [items[id_] for id_ in reserved]
    chosen += sorted(
        (row for row in items.values() if row.id not in reserved), key=order
    )[: max(0, limit - len(chosen))]
    return sorted(chosen, key=order)
