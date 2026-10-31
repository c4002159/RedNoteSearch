"""Upload a short document into an existing queued task's immutable snapshots."""

import uuid
from typing import BinaryIO

from sqlmodel import Session, col, func, select

from app.domain.task_materials import (
    MAX_MATERIAL_CHARS,
    MAX_MATERIALS,
    MaterialCountExceeded,
    MaterialTextTooLong,
    validate_material_count,
    validate_material_length,
)
from app.models import Task, TaskInput
from app.models.common import get_datetime_utc
from app.models.task_input import TaskMaterialPublic, TaskMaterialsPublic
from app.ports.embedding import EmbeddingProvider
from app.ports.task_input import TaskInputSnapshot
from app.services.audit import record_audit
from app.services.errors import (
    InvalidStateError,
    MaterialLimitExceededError,
    MaterialTooLongError,
)
from app.services.parsing import check_size, parse_document, size_limit_for
from app.services.task_input import DbTaskInputRepository


def material_public(snapshot: TaskInputSnapshot) -> TaskMaterialPublic:
    return TaskMaterialPublic(
        id=snapshot.id,
        filename=snapshot.filename,
        char_count=len(snapshot.content),
        content_hash=snapshot.content_hash,
        created_at=snapshot.created_at,
        excerpt=snapshot.content[:200],
    )


def add_file(
    *,
    session: Session,
    task: Task,
    user_id: uuid.UUID,
    filename: str,
    stream: BinaryIO,
    embedder: EmbeddingProvider,
) -> TaskMaterialPublic:
    """Caller authorizes the resource first. The task lock is shared with begin_generation."""
    try:
        locked = session.exec(
            select(Task)
            .where(Task.id == task.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).one()
        if locked.flow_status != "queued":
            raise InvalidStateError(
                "Only a queued task accepts materials",
                {"current_state": locked.flow_status},
            )
        count = session.exec(
            select(func.count())
            .select_from(TaskInput)
            .where(TaskInput.task_id == task.id)
        ).one()
        try:
            validate_material_count(count)
        except MaterialCountExceeded as exc:
            raise MaterialLimitExceededError(
                "The task already has five materials",
                {"material_count": count, "limit_count": MAX_MATERIALS},
            ) from exc
        limit = size_limit_for(filename)
        content = stream.read(limit + 1)
        check_size(filename, len(content))
        text = parse_document(filename, content)
        try:
            validate_material_length(text)
        except MaterialTextTooLong as exc:
            raise MaterialTooLongError(
                "Task material text is too long; use the knowledge base for large documents",
                {"char_count": len(text), "limit_chars": MAX_MATERIAL_CHARS},
            ) from exc
        snapshot = DbTaskInputRepository(session, embedder).add_snapshot(
            brand_id=locked.brand_id, task_id=locked.id, filename=filename, text=text
        )
        record_audit(
            session,
            action="task.material_add",
            entity_type="task_input",
            actor_id=user_id,
            brand_id=locked.brand_id,
            entity_id=snapshot.id,
            detail={"filename": filename, "char_count": len(text)},
        )
        result = material_public(snapshot)
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise


def list_materials(
    *, session: Session, task: Task, page: int, page_size: int
) -> TaskMaterialsPublic:
    where = (TaskInput.task_id == task.id, TaskInput.brand_id == task.brand_id)
    total = session.exec(
        select(func.count()).select_from(TaskInput).where(*where)
    ).one()
    rows = session.exec(
        select(TaskInput)
        .where(*where)
        .order_by(col(TaskInput.created_at), col(TaskInput.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return TaskMaterialsPublic(
        items=[
            material_public(
                TaskInputSnapshot(
                    id=r.id,
                    brand_id=r.brand_id,
                    task_id=r.task_id,
                    filename=r.filename,
                    content=r.content,
                    content_hash=r.content_hash,
                    created_at=r.created_at or get_datetime_utc(),
                )
            )
            for r in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )
