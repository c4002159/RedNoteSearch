import uuid

from sqlmodel import Session, col, select

from app.models import TaskInput, TaskInputChunk, get_datetime_utc
from app.ports.embedding import EmbeddingProvider
from app.ports.task_input import TaskInputSnapshot, content_hash
from app.services.chunking import chunk_text
from app.services.errors import ParseError


def _snapshot(row: TaskInput) -> TaskInputSnapshot:
    return TaskInputSnapshot(
        id=row.id,
        brand_id=row.brand_id,
        task_id=row.task_id,
        filename=row.filename,
        content=row.content,
        content_hash=row.content_hash,
        created_at=row.created_at or get_datetime_utc(),
    )


class DbTaskInputRepository:
    """``TaskInputRepository`` backed by the database.

    A snapshot is chunked and embedded when it is created, so the task's own material can be
    retrieved by ``DbKnowledgeSearch`` (source level ``task_material``). Embedding happens before
    anything is committed: a model outage (``ModelUnavailableError``) leaves no snapshot behind and
    the caller can simply retry. Snapshots are never updated or deleted by the application.
    """

    def __init__(self, session: Session, embedder: EmbeddingProvider) -> None:
        self._session = session
        self._embedder = embedder

    def create_snapshot(
        self, *, brand_id: uuid.UUID, task_id: uuid.UUID, filename: str, text: str
    ) -> TaskInputSnapshot:
        snapshot = self.add_snapshot(
            brand_id=brand_id, task_id=task_id, filename=filename, text=text
        )
        self._session.commit()
        return snapshot

    def add_snapshot(
        self, *, brand_id: uuid.UUID, task_id: uuid.UUID, filename: str, text: str
    ) -> TaskInputSnapshot:
        """Like ``create_snapshot`` but leaves the commit to the caller, so several snapshots and the
        task that owns them can be stored in one transaction."""
        pieces = chunk_text(text)
        if not pieces:
            raise ParseError("The task material has no text")
        vectors = self._embedder.embed(pieces)
        row = TaskInput(
            brand_id=brand_id,
            task_id=task_id,
            filename=filename[:300],
            content=text,
            content_hash=content_hash(text),
        )
        self._session.add(row)
        self._session.flush()
        self._session.add_all(
            TaskInputChunk(
                brand_id=brand_id,
                task_input_id=row.id,
                chunk_index=i,
                content=piece,
                embedding=vectors[i],
            )
            for i, piece in enumerate(pieces)
        )
        self._session.flush()
        self._session.refresh(row)
        return _snapshot(row)

    def list_snapshots(
        self, *, brand_id: uuid.UUID, task_id: uuid.UUID
    ) -> list[TaskInputSnapshot]:
        rows = self._session.exec(
            select(TaskInput)
            .where(TaskInput.brand_id == brand_id, TaskInput.task_id == task_id)
            .order_by(col(TaskInput.created_at), col(TaskInput.id))
        ).all()
        return [_snapshot(r) for r in rows]
