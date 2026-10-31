"""Working with the versions of a note after generation: edit, recheck, confirm and export.

Edits never change a version: they create a new one (contract section 5). A version becomes
``ready_to_copy`` only when a person confirms it and the checks ran on exactly that text; the state means
"an operator confirmed this text", never "compliant".
"""

import uuid
from typing import Any

from sqlmodel import Session

from app.domain.constraints import plain_body, to_markdown, to_xhs_parts
from app.domain.flow import FlowStatus, confirm_blockers
from app.domain.generation.schema import GeneratedNote
from app.models import ComplianceCheck, GenerationVersion, Task, VersionOrigin
from app.models.common import get_datetime_utc
from app.services import compliance as compliance_service
from app.services.audit import record_audit
from app.services.errors import (
    InvalidInputError,
    InvalidStateError,
    ModelUnavailableError,
)
from app.services.llm_structured import LlmOutputError
from app.services.pipeline import PipelineDeps, new_version_from, run_checks

# A version in one of these states can be checked again. ``ready_to_copy`` is final and
# ``generating`` is still being produced.
RECHECKABLE = frozenset(
    {
        FlowStatus.CHECKING.value,
        FlowStatus.EDITED_PENDING_RECHECK.value,
        FlowStatus.NEEDS_HUMAN_REVIEW.value,
        FlowStatus.CHECKS_COMPLETED.value,
        FlowStatus.CONSTRAINT_FAILED.value,
    }
)


def _mirror(
    session: Session, task: Task, version: GenerationVersion, stage: str | None
) -> None:
    if task.latest_version_id == version.id:
        task.flow_status = version.flow_status
        task.progress_stage = stage
        task.updated_at = get_datetime_utc()
        session.add(task)


def _require_idle(task: Task) -> None:
    if task.flow_status == FlowStatus.GENERATING.value:
        raise InvalidStateError("The task is still being generated")


def edit_version(
    *,
    session: Session,
    task: Task,
    parent: GenerationVersion,
    note: GeneratedNote,
    user_id: uuid.UUID,
) -> GenerationVersion:
    """Store the operator's edited text as a new version waiting for a recheck."""
    _require_idle(task)
    version = new_version_from(
        session=session,
        task=task,
        parent=parent,
        note=note,
        origin=VersionOrigin.EDITED,
        model=None,
    )
    version.flow_status = FlowStatus.EDITED_PENDING_RECHECK.value
    version.model = None  # nothing was generated; a person wrote this text
    session.add(version)
    _mirror(session, task, version, None)
    record_audit(
        session,
        action="version.edit",
        entity_type="generation_version",
        actor_id=user_id,
        brand_id=task.brand_id,
        entity_id=version.id,
        detail={"parent": str(parent.id), "version_no": version.version_no},
    )
    session.commit()
    session.refresh(version)
    return version


def begin_rewrite(*, task: Task, version: GenerationVersion) -> None:
    """A rewrite needs a version whose text exists and that is not being produced right now."""
    _require_idle(task)
    if version.flow_status == FlowStatus.GENERATING.value:
        raise InvalidStateError("The version is still being generated")


def record_rewrite(
    *,
    session: Session,
    task: Task,
    version: GenerationVersion,
    user_id: uuid.UUID,
    target: str,
) -> None:
    """The new rewritten version waits for its checks, which run in the background."""
    version.flow_status = FlowStatus.CHECKING.value
    session.add(version)
    task.last_error = None
    _mirror(session, task, version, "evidence")
    record_audit(
        session,
        action="version.rewrite",
        entity_type="generation_version",
        actor_id=user_id,
        brand_id=task.brand_id,
        entity_id=version.id,
        detail={"target": target, "parent": str(version.parent_version_id)},
    )
    session.commit()


def begin_recheck(*, session: Session, task: Task, version: GenerationVersion) -> None:
    """Mark the version as being checked. The caller then runs ``run_checks_safely`` in the background."""
    _require_idle(task)
    if version.flow_status not in RECHECKABLE:
        raise InvalidStateError(
            f"A version in state {version.flow_status} cannot be rechecked"
        )
    version.flow_status = FlowStatus.CHECKING.value
    session.add(version)
    task.last_error = None
    _mirror(session, task, version, "evidence")
    session.commit()


def run_checks_safely(
    *, session: Session, task_id: uuid.UUID, version_id: uuid.UUID, deps: PipelineDeps
) -> None:
    """Run the checks; a model outage keeps the version in ``checking`` and is recorded on the task."""
    task = session.get(Task, task_id)
    version = session.get(GenerationVersion, version_id)
    if task is None or version is None:
        return
    try:
        run_checks(session=session, task=task, version=version, deps=deps)
    except (ModelUnavailableError, LlmOutputError) as exc:
        session.rollback()
        task = session.get(Task, task_id) or task
        task.last_error = (
            "model_unavailable"
            if isinstance(exc, ModelUnavailableError)
            else "invalid_model_output"
        )
        task.updated_at = get_datetime_utc()
        session.add(task)
        record_audit(
            session,
            action="version.check_interrupted",
            entity_type="generation_version",
            actor_id=None,
            brand_id=task.brand_id,
            entity_id=version_id,
            detail={"error": task.last_error},
        )
        session.commit()


def _open_blocks(session: Session, version: GenerationVersion) -> int:
    rows: list[ComplianceCheck] = compliance_service.list_checks(
        session=session, version_id=version.id
    )
    return compliance_service.summarize(rows).unresolved_block


def confirm_version(
    *,
    session: Session,
    task: Task,
    version: GenerationVersion,
    selected_title_index: int,
    selected_cover_index: int | None,
    user_id: uuid.UUID,
) -> GenerationVersion:
    """An operator confirms the text. Allowed only when the checks ran on this very text, the
    constraints passed and no block-level hint is still open (contract section 5)."""
    if task.latest_version_id != version.id:
        raise InvalidStateError("Only the latest version of a task can be confirmed")
    blockers = confirm_blockers(
        status=FlowStatus(version.flow_status),
        constraints_passed=bool(version.constraint_checks.get("passed")),
        unresolved_block_risks=_open_blocks(session, version),
        checks_run_on_final_text=version.flow_status
        in (FlowStatus.CHECKS_COMPLETED.value, FlowStatus.NEEDS_HUMAN_REVIEW.value),
    )
    if blockers:
        raise InvalidStateError("；".join(blockers))
    if not 0 <= selected_title_index < len(version.title_candidates):
        raise InvalidInputError("selected_title_index is out of range")
    if selected_cover_index is not None and not (
        0 <= selected_cover_index < len(version.cover_candidates)
    ):
        raise InvalidInputError("selected_cover_index is out of range")

    version.flow_status = FlowStatus.READY_TO_COPY.value
    version.selected_title_index = selected_title_index
    version.selected_cover_index = selected_cover_index
    version.confirmed_by = user_id
    version.confirmed_at = get_datetime_utc()
    session.add(version)
    _mirror(session, task, version, "done")
    record_audit(
        session,
        action="version.confirm",
        entity_type="generation_version",
        actor_id=user_id,
        brand_id=task.brand_id,
        entity_id=version.id,
        detail={"version_no": version.version_no},
    )
    session.commit()
    session.refresh(version)
    return version


def export_version(version: GenerationVersion, fmt: str) -> dict[str, Any]:
    """The confirmed text in a pasteable shape. Only ``ready_to_copy`` versions can be exported."""
    if version.flow_status != FlowStatus.READY_TO_COPY.value:
        raise InvalidStateError("Only a confirmed version can be exported")
    index = version.selected_title_index or 0
    title = version.title_candidates[index]
    if fmt == "markdown":
        return {
            "format": "markdown",
            "content": to_markdown(
                title, version.body, version.hashtags, version.cover_candidates
            ),
        }
    parts = to_xhs_parts(title, plain_body(version.body), version.hashtags)
    return {
        "format": "xhs_parts",
        "title": parts.title,
        "body": parts.body,
        "tags": parts.tags,
        "counts": {
            "title_weight": parts.title_weight,
            "body_units": parts.body_units,
            "tags_visible_units": parts.tags_units,
            "tags_count": parts.tag_count,
        },
    }
