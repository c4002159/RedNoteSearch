from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable
from uuid import UUID

SourceLevel = Literal["approved_kb", "task_material"]


@dataclass(frozen=True)
class KnowledgeChunk:
    """One retrievable piece of evidence.

    ``approved_kb`` chunks come from an approved, current knowledge document version
    (``document_id`` and ``document_version`` are set). ``task_material`` chunks come from the
    operator's own material for a task (``snapshot_id`` is set); they are not reviewed.
    """

    chunk_id: UUID
    source_level: SourceLevel
    content: str
    content_hash: str
    score: float
    document_id: UUID | None = None
    document_version: int | None = None
    snapshot_id: UUID | None = None


@runtime_checkable
class KnowledgeSearch(Protocol):
    """Evidence retrieval, provided by member A.

    Rules every implementation must follow:

    * The caller has already authorised ``brand_id`` (BrandAuthContext); implementations still
      only ever return data of that brand.
    * ``approved_kb`` results only come from documents whose status is ``approved`` and whose
      version is the current one. Pending, rejected, deactivated and superseded versions are
      never returned.
    * ``task_material`` results are returned only when ``task_id`` is given, and only that task's
      own snapshots; other tasks' materials are never visible.
    * Results are ordered by descending ``score`` and capped at ``limit``.
    """

    def search(
        self,
        *,
        brand_id: UUID,
        query: str,
        product_id: UUID | None = None,
        task_id: UUID | None = None,
        limit: int = 8,
    ) -> list[KnowledgeChunk]: ...
