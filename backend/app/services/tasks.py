import uuid

from sqlmodel import Session, col, func, select

from app.models import (
    GenerationVersion,
    Product,
    ProductStatus,
    ScenarioTemplate,
    Task,
    TaskCreate,
)
from app.models.common import get_datetime_utc
from app.ports.embedding import EmbeddingProvider
from app.services.audit import record_audit
from app.services.errors import ConflictError, NotFoundError
from app.services.task_input import DbTaskInputRepository


def _clean_terms(terms: list[str]) -> list[str]:
    seen: dict[str, None] = {}
    for term in terms:
        if term.strip():
            seen.setdefault(term.strip(), None)
    return list(seen)


def create_task(
    *,
    session: Session,
    embedder: EmbeddingProvider,
    data: TaskCreate,
    user_id: uuid.UUID,
) -> Task:
    """Create a task and snapshot its materials in one transaction.

    The caller has already checked that the user is a member of ``data.brand_id``. The product and the
    scenario must belong to that brand (or be global, for scenarios); otherwise they look missing.
    Snapshots are embedded before anything is committed, so a model outage leaves nothing behind.
    """
    product = session.get(Product, data.product_id)
    if product is None or product.brand_id != data.brand_id:
        raise NotFoundError("Product not found")
    if product.status != ProductStatus.ACTIVE.value:
        raise ConflictError("The product is archived")
    scenario = session.get(ScenarioTemplate, data.scenario_id)
    if (
        scenario is None
        or not scenario.enabled
        or scenario.brand_id not in (None, data.brand_id)
    ):
        raise NotFoundError("Scenario not found")

    task = Task(
        brand_id=data.brand_id,
        product_id=data.product_id,
        scenario_id=data.scenario_id,
        style=data.style.model_dump(),
        brief=data.brief.strip(),
        required_terms=_clean_terms(data.required_terms),
        created_by=user_id,
    )
    session.add(task)
    session.flush()
    repo = DbTaskInputRepository(session, embedder)
    for material in data.task_materials:
        repo.add_snapshot(
            brand_id=data.brand_id,
            task_id=task.id,
            filename=material.filename,
            text=material.text,
        )
    record_audit(
        session,
        action="task.create",
        entity_type="task",
        actor_id=user_id,
        brand_id=data.brand_id,
        entity_id=task.id,
        detail={"materials": len(data.task_materials)},
    )
    session.commit()
    session.refresh(task)
    return task


def get_task(*, session: Session, task_id: uuid.UUID) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise NotFoundError("Task not found")
    return task


def list_tasks(
    *,
    session: Session,
    brand_id: uuid.UUID,
    status: str | None,
    newest_first: bool,
    page: int,
    page_size: int,
) -> tuple[list[Task], int]:
    where = [Task.brand_id == brand_id]
    if status:
        where.append(Task.flow_status == status)
    total = session.exec(select(func.count()).select_from(Task).where(*where)).one()
    order = col(Task.created_at).desc() if newest_first else col(Task.created_at).asc()
    rows = session.exec(
        select(Task)
        .where(*where)
        .order_by(order, col(Task.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def list_versions(*, session: Session, task_id: uuid.UUID) -> list[GenerationVersion]:
    return list(
        session.exec(
            select(GenerationVersion)
            .where(GenerationVersion.task_id == task_id)
            .order_by(col(GenerationVersion.version_no))
        ).all()
    )


def get_version(*, session: Session, version_id: uuid.UUID) -> GenerationVersion:
    version = session.get(GenerationVersion, version_id)
    if version is None:
        raise NotFoundError("Version not found")
    return version


def set_task_status(
    *,
    session: Session,
    task: Task,
    flow_status: str,
    stage: str | None = None,
    latest_version_id: uuid.UUID | None = None,
) -> None:
    """Update the task's visible progress. The caller commits."""
    task.flow_status = flow_status
    task.progress_stage = stage
    if latest_version_id is not None:
        task.latest_version_id = latest_version_id
    task.updated_at = get_datetime_utc()
    session.add(task)


def task_labels(
    *, session: Session, tasks: list[Task]
) -> dict[uuid.UUID, tuple[str, str, str]]:
    """Product name, scenario name and scene of each task, for list and detail views."""
    if not tasks:
        return {}
    products = {
        p.id: p.name
        for p in session.exec(
            select(Product).where(col(Product.id).in_({t.product_id for t in tasks}))
        ).all()
    }
    scenarios = {
        s.id: (s.name, s.scene)
        for s in session.exec(
            select(ScenarioTemplate).where(
                col(ScenarioTemplate.id).in_({t.scenario_id for t in tasks})
            )
        ).all()
    }
    return {
        t.id: (
            products.get(t.product_id, ""),
            *scenarios.get(t.scenario_id, ("", "")),
        )
        for t in tasks
    }
