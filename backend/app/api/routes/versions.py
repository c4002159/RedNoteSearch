import logging
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from sqlmodel import Session

from app.api.deps import SessionDep
from app.api.routes.knowledge import EmbedderDep
from app.api.routes.tasks import LlmFactory, LlmFactoryDep, VersionAccessDep
from app.core.db import engine
from app.domain.generation.rewrite import target_problem
from app.domain.generation.schema import GeneratedNote
from app.models import (
    ConfirmVersion,
    GenerationVersion,
    GenerationVersionPublic,
    MarkdownExport,
    RewriteRequest,
    Task,
    XhsPartsExport,
)
from app.ports.embedding import EmbeddingProvider
from app.services import versions as version_service
from app.services.knowledge_search import DbKnowledgeSearch
from app.services.pipeline import PipelineDeps, rewrite_version
from app.services.voice_profiles import DbVoiceProfileProvider

logger = logging.getLogger(__name__)
router = APIRouter(tags=["versions"])


def _task_of(session: Session, version: GenerationVersion) -> Task:
    task = session.get(Task, version.task_id)
    if task is None:  # cannot happen: versions are deleted with their task
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _public(version: GenerationVersion) -> GenerationVersionPublic:
    return GenerationVersionPublic.model_validate(version, from_attributes=True)


def _check_in_background(
    task_id: uuid.UUID,
    version_id: uuid.UUID,
    brand_id: uuid.UUID,
    llm_factory: LlmFactory,
    embedder: EmbeddingProvider,
) -> None:
    """Runs after the response. Failures are stored on the task, not raised."""
    with Session(engine) as session:
        deps = PipelineDeps(
            llm=llm_factory(brand_id, task_id),
            search=DbKnowledgeSearch(session, embedder),
            voices=DbVoiceProfileProvider(session),
        )
        version_service.run_checks_safely(
            session=session, task_id=task_id, version_id=version_id, deps=deps
        )


@router.post(
    "/generation-versions/{version_id}/edit",
    response_model=GenerationVersionPublic,
    status_code=201,
)
def edit_version(
    access: VersionAccessDep, session: SessionDep, body: GeneratedNote
) -> GenerationVersionPublic:
    """Save the operator's edited text as a new version (the old one is untouched). It must be
    rechecked before it can be confirmed."""
    version, brand_access = access
    new = version_service.edit_version(
        session=session,
        task=_task_of(session, version),
        parent=version,
        note=body,
        user_id=brand_access.user_id,
    )
    return _public(new)


@router.post(
    "/generation-versions/{version_id}/recheck",
    response_model=GenerationVersionPublic,
    status_code=202,
)
def recheck_version(
    access: VersionAccessDep,
    session: SessionDep,
    background: BackgroundTasks,
    llm_factory: LlmFactoryDep,
    embedder: EmbedderDep,
) -> GenerationVersionPublic:
    """Run the constraint, evidence and compliance checks again on this version's current text."""
    version, _ = access
    task = _task_of(session, version)
    version_service.begin_recheck(session=session, task=task, version=version)
    background.add_task(
        _check_in_background, task.id, version.id, task.brand_id, llm_factory, embedder
    )
    session.refresh(version)
    return _public(version)


@router.post(
    "/generation-versions/{version_id}/rewrite",
    response_model=GenerationVersionPublic,
    status_code=202,
)
def rewrite_part(
    access: VersionAccessDep,
    session: SessionDep,
    background: BackgroundTasks,
    llm_factory: LlmFactoryDep,
    embedder: EmbedderDep,
    body: RewriteRequest,
) -> GenerationVersionPublic:
    """Rewrite one part (titles, opening, body or cover) as a new version, then check it automatically."""
    version, brand_access = access
    task = _task_of(session, version)
    version_service.begin_rewrite(task=task, version=version)
    new = rewrite_version(
        session=session,
        task=task,
        version=version,
        problems=[target_problem(body.target)],
        llm=llm_factory(task.brand_id, task.id),
        instruction=body.instruction,
    )
    version_service.record_rewrite(
        session=session,
        task=task,
        version=new,
        user_id=brand_access.user_id,
        target=body.target,
    )
    background.add_task(
        _check_in_background, task.id, new.id, task.brand_id, llm_factory, embedder
    )
    session.refresh(new)
    return _public(new)


@router.post(
    "/generation-versions/{version_id}/confirm", response_model=GenerationVersionPublic
)
def confirm_version(
    access: VersionAccessDep, session: SessionDep, body: ConfirmVersion
) -> GenerationVersionPublic:
    """Mark the text as confirmed by an operator (``ready_to_copy``). This is not a compliance verdict."""
    version, brand_access = access
    confirmed = version_service.confirm_version(
        session=session,
        task=_task_of(session, version),
        version=version,
        selected_title_index=body.selected_title_index,
        selected_cover_index=body.selected_cover_index,
        user_id=brand_access.user_id,
    )
    return _public(confirmed)


@router.get(
    "/generation-versions/{version_id}/export",
    response_model=XhsPartsExport | MarkdownExport,
)
def export_version(
    access: VersionAccessDep,
    session: SessionDep,
    format: Annotated[Literal["xhs_parts", "markdown"], Query()],  # noqa: A002 - the contract's name
) -> XhsPartsExport | MarkdownExport:
    data = version_service.export_version(session, access[0], format)
    if format == "markdown":
        return MarkdownExport(**data)
    return XhsPartsExport(**data)
