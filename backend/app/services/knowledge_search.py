import uuid
from typing import Any

from sqlmodel import Session, col, select

from app.models import DocumentStatus, IndexStatus, KbChunk, KbDocument
from app.ports.embedding import EmbeddingProvider
from app.ports.knowledge import KnowledgeChunk
from app.ports.task_input import content_hash


class DbKnowledgeSearch:
    """``KnowledgeSearch`` over pgvector.

    Only chunks of the given brand whose document version is approved, current and indexed are
    returned, ordered by cosine similarity. ``product_id`` is accepted but not used yet (documents are
    not linked to products), and ``task_id`` is ignored until task material snapshots exist: only
    ``approved_kb`` results are produced.
    """

    def __init__(self, session: Session, embedder: EmbeddingProvider) -> None:
        self._session = session
        self._embedder = embedder

    def search(
        self,
        *,
        brand_id: uuid.UUID,
        query: str,
        product_id: uuid.UUID | None = None,
        task_id: uuid.UUID | None = None,
        limit: int = 8,
    ) -> list[KnowledgeChunk]:
        if not query.strip() or limit <= 0:
            return []
        (vector,) = self._embedder.embed([query])
        # pgvector adds comparison methods such as cosine_distance to the column.
        embedding: Any = KbChunk.embedding
        distance = embedding.cosine_distance(vector)
        rows = self._session.exec(
            select(KbChunk, KbDocument, distance.label("distance"))
            .join(KbDocument, col(KbChunk.document_id) == col(KbDocument.id))
            .where(
                KbChunk.brand_id == brand_id,
                KbDocument.brand_id == brand_id,
                KbDocument.status == DocumentStatus.APPROVED.value,
                col(KbDocument.is_current).is_(True),
                KbDocument.index_status == IndexStatus.READY.value,
                col(KbChunk.embedding).is_not(None),
            )
            .order_by(distance)
            .limit(limit)
        ).all()
        return [
            KnowledgeChunk(
                chunk_id=chunk.id,
                source_level="approved_kb",
                content=chunk.content,
                content_hash=content_hash(chunk.content),
                score=1.0 - float(dist),
                # The port's ``document_id`` is the logical document (ADR-010): all versions share it.
                document_id=doc.group_id,
                document_version=doc.version,
            )
            for chunk, doc, dist in rows
        ]
