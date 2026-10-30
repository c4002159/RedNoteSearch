import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable
from uuid import UUID


def content_hash(text: str) -> str:
    """SHA-256 hex digest of the UTF-8 text; the single hashing rule for snapshots and evidence."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class TaskInputSnapshot:
    """Immutable copy of the material an operator supplied for one task."""

    id: UUID
    brand_id: UUID
    task_id: UUID
    filename: str
    content: str
    content_hash: str
    created_at: datetime


@runtime_checkable
class TaskInputRepository(Protocol):
    """Task material storage, provided by member A.

    Snapshots are immutable: later edits to a source file, or promoting the material into the
    knowledge base, never change an existing snapshot or the evidence that references it.
    """

    def create_snapshot(
        self, *, brand_id: UUID, task_id: UUID, filename: str, text: str
    ) -> TaskInputSnapshot: ...

    def list_snapshots(
        self, *, brand_id: UUID, task_id: UUID
    ) -> list[TaskInputSnapshot]: ...
