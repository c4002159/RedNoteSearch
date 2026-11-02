"""Read-only similarity hints; neither embedding previews nor snapshots are persisted."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, col, select

from app.core.config import settings
from app.domain.knowledge_similarity import merge_similarities
from app.models import KbChunk, KbDocument
from app.models.knowledge_similarity import SimilarityPreview
from app.ports.embedding import EmbeddingProvider
from app.services import knowledge as kb
from app.services.errors import InvalidStateError, ModelUnavailableError

MAX_CHECK_CHUNKS = 20
NEIGHBORS_PER_CHUNK = 5


class SimilarContentRequired(InvalidStateError):
    def __init__(self, report: SimilarityPreview) -> None:
        super().__init__("内容相近，请核对", report.model_dump(mode="json"))


def snapshot(doc: KbDocument, ids: list[str]) -> str:
    return jwt.encode(
        {
            "purpose": "kb_similarity",
            "document": str(doc.id),
            "brand": str(doc.brand_id),
            "ids": ids,
            "exp": datetime.now(UTC) + timedelta(minutes=10),
        },
        settings.SECRET_KEY,
        algorithm="HS256",
    )


def acknowledged(doc: KbDocument, token: str | None) -> set[str]:
    if not token:
        return set()
    try:
        data = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return set()
    if (
        data.get("purpose") != "kb_similarity"
        or data.get("document") != str(doc.id)
        or data.get("brand") != str(doc.brand_id)
    ):
        return set()
    values = data.get("ids")
    return (
        set(values)
        if isinstance(values, list) and all(isinstance(value, str) for value in values)
        else set()
    )


def unavailable() -> SimilarityPreview:
    return SimilarityPreview(status="unavailable", message="相似检查暂不可用")


def compare_vectors(
    session: Session, doc: KbDocument, vectors: list[list[float]]
) -> SimilarityPreview:
    eligible: list[Any] = [
        KbDocument.brand_id == doc.brand_id,
        KbDocument.group_id != doc.group_id,
        KbDocument.status == "approved",
        col(KbDocument.is_current).is_(True),
        KbDocument.index_status == "ready",
    ]
    try:
        # A savepoint keeps an optional comparison failure from poisoning approval's transaction.
        with session.begin_nested():
            titles = session.exec(
                select(KbDocument.id, KbDocument.title)
                .where(*eligible, KbDocument.title == doc.title)
                .order_by(col(KbDocument.id))
                .limit(10)
            ).all()
            hits: list[tuple[uuid.UUID, str, float]] = []
            embedding: Any = KbChunk.embedding
            for vector in vectors[:MAX_CHECK_CHUNKS]:
                distance = embedding.cosine_distance(vector)
                found = session.exec(
                    select(KbDocument.id, KbDocument.title, distance)
                    .join(KbChunk, col(KbChunk.document_id) == col(KbDocument.id))
                    .where(
                        *eligible,
                        KbChunk.brand_id == doc.brand_id,
                        col(KbChunk.embedding).is_not(None),
                        distance <= 1 - settings.KB_SIMILARITY_THRESHOLD,
                    )
                    .order_by(distance)
                    .limit(NEIGHBORS_PER_CHUNK)
                ).all()
                hits.extend(
                    (id_, title, 1 - float(score)) for id_, title, score in found
                )
            items = merge_similarities(titles, hits)
    except SQLAlchemyError:
        return unavailable()
    return SimilarityPreview(
        status="ready",
        message="内容相近，请核对" if items else "暂无内容相近的资料",
        items=items,
        token=snapshot(doc, [str(item.id) for item in items]),
    )


def preview(
    session: Session, doc: KbDocument, embedder: EmbeddingProvider
) -> SimilarityPreview:
    if doc.status != "pending_review":
        raise InvalidStateError("只有待审资料可以检查相近内容")
    chunks = kb._chunks_of(session, doc)[:MAX_CHECK_CHUNKS]
    try:
        vectors = embedder.embed([chunk.content for chunk in chunks])
    except ModelUnavailableError:
        return unavailable()
    if len(vectors) != len(chunks):
        return unavailable()
    return compare_vectors(session, doc, vectors)
