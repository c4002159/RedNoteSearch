import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.brand_deps import BrandAccess, BrandAccessDep, get_brand_access
from app.api.deps import CurrentUser, SessionDep
from app.api.routes.knowledge import EmbedderDep
from app.domain.flow import FlowStatus
from app.models import (
    BrandMember,
    GenerationVersion,
    GenerationVersionPublic,
    GenerationVersionsPublic,
    MemberRole,
    ScenarioPublic,
    ScenariosPublic,
    StyleParams,
    StylePresetCreate,
    StylePresetPublic,
    StylePresetsPublic,
    Task,
    TaskCreate,
    TaskCreated,
    TaskPublic,
    TasksPublic,
)
from app.services import scenarios as scenario_service
from app.services import tasks as task_service

router = APIRouter(tags=["tasks"])


def _member_access(
    session: SessionDep, current_user: CurrentUser, brand_id: uuid.UUID
) -> BrandAccess | None:
    member = session.get(BrandMember, (brand_id, current_user.id))
    if member is None:
        return None
    return BrandAccess(
        brand_id=brand_id, user_id=current_user.id, role=MemberRole(member.role)
    )


def get_task_access(
    task_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> tuple[Task, BrandAccess]:
    """Resource-id access: the brand comes from the stored task; a missing task and a task of another
    brand both give 404, so tasks cannot be discovered by id."""
    task = session.get(Task, task_id)
    access = _member_access(session, current_user, task.brand_id) if task else None
    if task is None or access is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task, access


def get_version_access(
    version_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> tuple[GenerationVersion, BrandAccess]:
    version = session.get(GenerationVersion, version_id)
    access = (
        _member_access(session, current_user, version.brand_id) if version else None
    )
    if version is None or access is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return version, access


TaskAccessDep = Annotated[tuple[Task, BrandAccess], Depends(get_task_access)]
VersionAccessDep = Annotated[
    tuple[GenerationVersion, BrandAccess], Depends(get_version_access)
]


def _task_public(task: Task) -> TaskPublic:
    return TaskPublic(
        id=task.id,
        brand_id=task.brand_id,
        product_id=task.product_id,
        scenario_id=task.scenario_id,
        style=StyleParams.model_validate(task.style),
        brief=task.brief,
        required_terms=task.required_terms,
        flow_status=task.flow_status,
        progress={"stage": task.progress_stage},
        latest_version_id=task.latest_version_id,
        created_at=task.created_at,
    )


@router.get("/scenarios", response_model=ScenariosPublic)
def read_scenarios(session: SessionDep, current_user: CurrentUser) -> ScenariosPublic:
    """Global templates and those of the user's brands."""
    rows = scenario_service.list_scenarios_for_user(
        session=session, user_id=current_user.id
    )
    return ScenariosPublic(
        items=[ScenarioPublic.model_validate(r, from_attributes=True) for r in rows]
    )


@router.get("/brands/{brand_id}/style-presets", response_model=StylePresetsPublic)
def read_style_presets(
    access: BrandAccessDep, session: SessionDep
) -> StylePresetsPublic:
    rows = scenario_service.list_style_presets(
        session=session, brand_id=access.brand_id
    )
    return StylePresetsPublic(
        items=[
            StylePresetPublic(
                id=r.id,
                brand_id=r.brand_id,
                name=r.name,
                params=StyleParams.model_validate(r.params),
            )
            for r in rows
        ]
    )


@router.post(
    "/brands/{brand_id}/style-presets",
    response_model=StylePresetPublic,
    status_code=201,
)
def create_style_preset(
    access: BrandAccessDep, session: SessionDep, body: StylePresetCreate
) -> StylePresetPublic:
    row = scenario_service.create_style_preset(
        session=session, brand_id=access.brand_id, data=body, user_id=access.user_id
    )
    return StylePresetPublic(
        id=row.id,
        brand_id=row.brand_id,
        name=row.name,
        params=StyleParams.model_validate(row.params),
    )


@router.post("/tasks", response_model=TaskCreated, status_code=201)
def create_task(
    session: SessionDep,
    current_user: CurrentUser,
    embedder: EmbedderDep,
    body: TaskCreate,
) -> TaskCreated:
    """The brand comes from the body here, so membership is checked explicitly before anything else."""
    get_brand_access(body.brand_id, session, current_user)
    task = task_service.create_task(
        session=session, embedder=embedder, data=body, user_id=current_user.id
    )
    return TaskCreated(
        id=task.id,
        status=task.flow_status,
        brand_id=task.brand_id,
        created_at=task.created_at,
    )


@router.get("/tasks", response_model=TasksPublic)
def read_tasks(
    session: SessionDep,
    current_user: CurrentUser,
    brand_id: uuid.UUID,
    status: FlowStatus | None = None,
    sort: Annotated[str, Query(pattern="^-?created_at$")] = "-created_at",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> TasksPublic:
    get_brand_access(brand_id, session, current_user)
    rows, total = task_service.list_tasks(
        session=session,
        brand_id=brand_id,
        status=status.value if status else None,
        newest_first=sort.startswith("-"),
        page=page,
        page_size=page_size,
    )
    return TasksPublic(
        items=[_task_public(t) for t in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/tasks/{task_id}", response_model=TaskPublic)
def read_task(access: TaskAccessDep) -> TaskPublic:
    return _task_public(access[0])


@router.get("/tasks/{task_id}/versions", response_model=GenerationVersionsPublic)
def read_task_versions(
    access: TaskAccessDep, session: SessionDep
) -> GenerationVersionsPublic:
    rows = task_service.list_versions(session=session, task_id=access[0].id)
    return GenerationVersionsPublic(
        items=[
            GenerationVersionPublic.model_validate(r, from_attributes=True)
            for r in rows
        ]
    )


@router.get("/generation-versions/{version_id}", response_model=GenerationVersionPublic)
def read_version(access: VersionAccessDep) -> GenerationVersionPublic:
    return GenerationVersionPublic.model_validate(access[0], from_attributes=True)
