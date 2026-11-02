import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app.api.brand_deps import BrandAccess, BrandAccessDep
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    BrandMember,
    ConfirmedCopiesPublic,
    ConfirmedCopy,
    ConfirmedCopyPublic,
    ConfirmedCopyUpdate,
    MemberRole,
    MetricCreate,
    MetricPublic,
    MetricsPublic,
    ResultsSummary,
)
from app.models.common import get_datetime_utc
from app.services import results as results_service
from app.services.search import SEARCH_MAX_LENGTH

router = APIRouter(tags=["results"])


def _copy_access(
    copy_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> tuple[ConfirmedCopy, BrandAccess]:
    """Resource-id access: a missing copy and a copy of another brand both give 404."""
    row = session.get(ConfirmedCopy, copy_id)
    member = session.get(BrandMember, (row.brand_id, current_user.id)) if row else None
    if row is None or member is None:
        raise HTTPException(status_code=404, detail="Confirmed copy not found")
    return row, BrandAccess(
        brand_id=row.brand_id, user_id=current_user.id, role=MemberRole(member.role)
    )


def _public(session: SessionDep, row: ConfirmedCopy) -> ConfirmedCopyPublic:
    metrics = {row.id: results_service.list_metrics(session, row.id)}
    return results_service.to_public([row], metrics, get_datetime_utc())[0]


@router.get("/brands/{brand_id}/confirmed-copies", response_model=ConfirmedCopiesPublic)
def read_confirmed_copies(
    access: BrandAccessDep,
    session: SessionDep,
    needs_metrics: bool = False,
    q: Annotated[str | None, Query(max_length=SEARCH_MAX_LENGTH)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ConfirmedCopiesPublic:
    """Confirmed notes, newest first. ``needs_metrics=true`` lists the posts that are three days old
    or more and have no numbers since, oldest first."""
    return results_service.list_copies(
        session=session,
        brand_id=access.brand_id,
        needs_metrics=needs_metrics,
        q=q,
        page=page,
        page_size=page_size,
    )


@router.get("/brands/{brand_id}/results/summary", response_model=ResultsSummary)
def read_results_summary(access: BrandAccessDep, session: SessionDep) -> ResultsSummary:
    return results_service.summary(session=session, brand_id=access.brand_id)


@router.get("/confirmed-copies/{copy_id}", response_model=ConfirmedCopyPublic)
def read_confirmed_copy(
    session: SessionDep,
    current_user: CurrentUser,
    copy_id: uuid.UUID,
) -> ConfirmedCopyPublic:
    row, _ = _copy_access(copy_id, session, current_user)
    return _public(session, row)


@router.patch("/confirmed-copies/{copy_id}", response_model=ConfirmedCopyPublic)
def update_confirmed_copy(
    session: SessionDep,
    current_user: CurrentUser,
    copy_id: uuid.UUID,
    body: ConfirmedCopyUpdate,
) -> ConfirmedCopyPublic:
    """Record where and when it was published. The link is only stored, never opened."""
    row, access = _copy_access(copy_id, session, current_user)
    row = results_service.update_copy(
        session=session, row=row, data=body, user_id=access.user_id
    )
    return _public(session, row)


@router.get("/confirmed-copies/{copy_id}/metrics", response_model=MetricsPublic)
def read_metrics(
    session: SessionDep, current_user: CurrentUser, copy_id: uuid.UUID
) -> MetricsPublic:
    row, _ = _copy_access(copy_id, session, current_user)
    return MetricsPublic(
        items=[
            MetricPublic.model_validate(m)
            for m in results_service.list_metrics(session, row.id)
        ]
    )


@router.post(
    "/confirmed-copies/{copy_id}/metrics", response_model=MetricPublic, status_code=201
)
def add_metric(
    session: SessionDep,
    current_user: CurrentUser,
    copy_id: uuid.UUID,
    body: MetricCreate,
) -> MetricPublic:
    """Add one reading of the post's numbers. Readings are only added; the newest counts."""
    row, access = _copy_access(copy_id, session, current_user)
    metric = results_service.add_metric(
        session=session, row=row, data=body, user_id=access.user_id
    )
    return MetricPublic.model_validate(metric)
