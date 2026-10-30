from dataclasses import dataclass
from typing import Literal
from uuid import UUID, uuid4

from app.fakes.task_input import FakeTaskInputRepository
from app.ports.knowledge import KnowledgeChunk
from app.ports.task_input import content_hash

DocumentStatus = Literal["pending_review", "approved", "rejected", "deactivated"]


@dataclass(frozen=True)
class _FakeDocument:
    brand_id: UUID
    document_id: UUID
    version: int
    status: DocumentStatus
    is_current: bool
    chunks: tuple[tuple[UUID, str], ...]


def _score(query: str, content: str) -> float:
    """Fraction of whitespace-separated query terms contained in the content (0.0 to 1.0)."""
    terms = query.split()
    if not terms:
        return 0.0
    return sum(1 for term in terms if term in content) / len(terms)


class FakeKnowledgeSearch:
    """In-memory ``KnowledgeSearch`` with the same visibility rules as the real one."""

    def __init__(self, task_inputs: FakeTaskInputRepository | None = None) -> None:
        self._documents: list[_FakeDocument] = []
        self._task_inputs = task_inputs

    def add_document(
        self,
        *,
        brand_id: UUID,
        chunks: list[str],
        status: DocumentStatus = "approved",
        version: int = 1,
        is_current: bool = True,
        document_id: UUID | None = None,
    ) -> UUID:
        doc_id = document_id or uuid4()
        self._documents.append(
            _FakeDocument(
                brand_id=brand_id,
                document_id=doc_id,
                version=version,
                status=status,
                is_current=is_current,
                chunks=tuple((uuid4(), text) for text in chunks),
            )
        )
        return doc_id

    def search(
        self,
        *,
        brand_id: UUID,
        query: str,
        product_id: UUID | None = None,
        task_id: UUID | None = None,
        limit: int = 8,
    ) -> list[KnowledgeChunk]:
        results: list[KnowledgeChunk] = []
        for doc in self._documents:
            if (
                doc.brand_id != brand_id
                or doc.status != "approved"
                or not doc.is_current
            ):
                continue
            for chunk_id, text in doc.chunks:
                score = _score(query, text)
                if score > 0:
                    results.append(
                        KnowledgeChunk(
                            chunk_id=chunk_id,
                            source_level="approved_kb",
                            content=text,
                            content_hash=content_hash(text),
                            score=score,
                            document_id=doc.document_id,
                            document_version=doc.version,
                        )
                    )
        if task_id is not None and self._task_inputs is not None:
            for snapshot in self._task_inputs.list_snapshots(
                brand_id=brand_id, task_id=task_id
            ):
                score = _score(query, snapshot.content)
                if score > 0:
                    results.append(
                        KnowledgeChunk(
                            chunk_id=uuid4(),
                            source_level="task_material",
                            content=snapshot.content,
                            content_hash=snapshot.content_hash,
                            score=score,
                            snapshot_id=snapshot.id,
                        )
                    )
        results.sort(key=lambda c: c.score, reverse=True)
        return results[:limit]
