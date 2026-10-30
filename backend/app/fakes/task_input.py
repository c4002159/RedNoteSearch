from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.ports.task_input import TaskInputSnapshot, content_hash


class FakeTaskInputRepository:
    """In-memory ``TaskInputRepository``."""

    def __init__(self) -> None:
        self._snapshots: list[TaskInputSnapshot] = []

    def create_snapshot(
        self, *, brand_id: UUID, task_id: UUID, filename: str, text: str
    ) -> TaskInputSnapshot:
        snapshot = TaskInputSnapshot(
            id=uuid4(),
            brand_id=brand_id,
            task_id=task_id,
            filename=filename,
            content=text,
            content_hash=content_hash(text),
            created_at=datetime.now(UTC),
        )
        self._snapshots.append(snapshot)
        return snapshot

    def list_snapshots(
        self, *, brand_id: UUID, task_id: UUID
    ) -> list[TaskInputSnapshot]:
        return [
            s
            for s in self._snapshots
            if s.brand_id == brand_id and s.task_id == task_id
        ]
