import uuid
from typing import Any

from sqlmodel import Session, col, select

from app.models import (
    DocumentStatus,
    IndexStatus,
    KbChunk,
    KbDocument,
    TaskInput,
    TaskInputChunk,
)
from app.ports.embedding import EmbeddingProvider
from app.ports.knowledge import KnowledgeChunk
from app.ports.task_input import content_hash


class DbKnowledgeSearch:
    """``KnowledgeSearch`` over pgvector.

    ``approved_kb`` results: only chunks of the given brand whose document version is approved, current
    and indexed. ``task_material`` results: only when ``task_id`` is given, and only that task's own
    snapshots of that brand. Both are ordered together by cosine similarity. ``product_id`` is
    accepted but not used yet (documents are not linked to products).

    For ``task_material`` the ``content_hash`` is the hash of the chunk text, like for knowledge base
    chunks; the whole snapshot's hash is on the snapshot itself (``snapshot_id``).
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
        results = self._search_approved(brand_id, vector, limit)
        if task_id is not None:
            results += self._search_task_material(brand_id, task_id, vector, limit)
        results.sort(key=lambda c: c.score, reverse=True)
        return results[:limit]

    def _search_approved(
        self, brand_id: uuid.UUID, vector: list[float], limit: int
    ) -> list[KnowledgeChunk]:
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

    def _search_task_material(
        self,
        brand_id: uuid.UUID,
        task_id: uuid.UUID,
        vector: list[float],
        limit: int,
    ) -> list[KnowledgeChunk]:
        embedding: Any = TaskInputChunk.embedding
        distance = embedding.cosine_distance(vector)
        rows = self._session.exec(
            select(TaskInputChunk, distance.label("distance"))
            .join(TaskInput, col(TaskInputChunk.task_input_id) == col(TaskInput.id))
            .where(
                TaskInputChunk.brand_id == brand_id,
                TaskInput.brand_id == brand_id,
                TaskInput.task_id == task_id,
                col(TaskInputChunk.embedding).is_not(None),
            )
            .order_by(distance)
            .limit(limit)
        ).all()
        return [
            KnowledgeChunk(
                chunk_id=chunk.id,
                source_level="task_material",
                content=chunk.content,
                content_hash=content_hash(chunk.content),
                score=1.0 - float(dist),
                snapshot_id=chunk.task_input_id,
            )
            for chunk, dist in rows
        ]
