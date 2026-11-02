import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import exists, func, literal
from sqlmodel import Session, col, select

from app.domain import results as rules
from app.models import (
    ConfirmedCopiesPublic,
    ConfirmedCopy,
    ConfirmedCopyPublic,
    ConfirmedCopyUpdate,
    GenerationVersion,
    HotStat,
    HottestPublic,
    MetricCreate,
    MetricPublic,
    PostMetric,
    ResultsSummary,
    Task,
    UsageStat,
)
from app.models.common import get_datetime_utc
from app.services.audit import record_audit
from app.services.errors import InvalidInputError, NotFoundError
from app.services.search import contains_any
from app.services.tasks import task_labels

# A reading may be at most this far ahead of the server's clock (clock drift on the person's device).
FUTURE_TOLERANCE = timedelta(minutes=10)


def add_for_confirmed_version(
    session: Session, *, task: Task, version: GenerationVersion, user_id: uuid.UUID
) -> ConfirmedCopy:
    """Keep a version that was just confirmed on the results list. The caller commits."""
    existing = session.exec(
        select(ConfirmedCopy).where(ConfirmedCopy.version_id == version.id)
    ).first()
    if existing:
        return existing
    product_label, scenario_name, scene, _ = task_labels(session=session, tasks=[task])[
        task.id
    ]
    index = version.selected_title_index or 0
    titles = version.title_candidates
    row = ConfirmedCopy(
        brand_id=task.brand_id,
        task_id=task.id,
        version_id=version.id,
        title=(titles[index] if index < len(titles) else "")[:200],
        scenario_name=scenario_name[:100],
        scene=scene,
        promo_type=task.promo_type,
        promo_label=product_label[:300],
        confirmed_by=user_id,
        confirmed_at=version.confirmed_at,
    )
    session.add(row)
    return row


def get_copy(session: Session, copy_id: uuid.UUID) -> ConfirmedCopy:
    row = session.get(ConfirmedCopy, copy_id)
    if row is None:
        raise NotFoundError("Confirmed copy not found")
    return row


def _due_filter(now: datetime) -> list[Any]:
    """SQL form of ``rules.needs_metrics``: published, three days passed, no reading since then."""
    due = col(ConfirmedCopy.published_at) + timedelta(days=rules.DUE_AFTER_DAYS)
    newer = exists().where(
        col(PostMetric.copy_id) == col(ConfirmedCopy.id),
        col(PostMetric.captured_at) >= due,
    )
    return [col(ConfirmedCopy.published_at).is_not(None), due <= literal(now), ~newer]


def _latest_metrics(
    session: Session, copy_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[PostMetric]]:
    out: dict[uuid.UUID, list[PostMetric]] = {i: [] for i in copy_ids}
    if copy_ids:
        for m in session.exec(
            select(PostMetric)
            .where(col(PostMetric.copy_id).in_(copy_ids))
            .order_by(
                col(PostMetric.captured_at).desc(), col(PostMetric.created_at).desc()
            )
        ).all():
            out[m.copy_id].append(m)
    return out


def to_public(
    rows: list[ConfirmedCopy], metrics: dict[uuid.UUID, list[PostMetric]], now: datetime
) -> list[ConfirmedCopyPublic]:
    items = []
    for r in rows:
        readings = metrics.get(r.id, [])
        item = ConfirmedCopyPublic.model_validate(
            r,
            update={
                "metrics_due_at": rules.due_at(r.published_at),
                "needs_metrics": rules.needs_metrics(
                    published_at=r.published_at,
                    captured_at=[m.captured_at for m in readings],
                    now=now,
                ),
                "latest_metric": MetricPublic.model_validate(readings[0])
                if readings
                else None,
            },
        )
        items.append(item)
    return items


def list_copies(
    *,
    session: Session,
    brand_id: uuid.UUID,
    needs_metrics: bool,
    q: str | None,
    page: int,
    page_size: int,
) -> ConfirmedCopiesPublic:
    now = get_datetime_utc()
    where: list[Any] = [ConfirmedCopy.brand_id == brand_id]
    if needs_metrics:
        where += _due_filter(now)
    match = contains_any(
        q,
        col(ConfirmedCopy.title),
        col(ConfirmedCopy.promo_label),
        col(ConfirmedCopy.scenario_name),
    )
    if match is not None:
        where.append(match)
    total = session.exec(
        select(func.count()).select_from(ConfirmedCopy).where(*where)
    ).one()
    order = (
        col(ConfirmedCopy.published_at).asc()
        if needs_metrics
        else col(ConfirmedCopy.confirmed_at).desc()
    )
    rows = list(
        session.exec(
            select(ConfirmedCopy)
            .where(*where)
            .order_by(order, col(ConfirmedCopy.id))
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    metrics = _latest_metrics(session, [r.id for r in rows])
    return ConfirmedCopiesPublic(
        items=to_public(rows, metrics, now), total=total, page=page, page_size=page_size
    )


def update_copy(
    *,
    session: Session,
    row: ConfirmedCopy,
    data: ConfirmedCopyUpdate,
    user_id: uuid.UUID,
) -> ConfirmedCopy:
    sent = data.model_fields_set
    now = get_datetime_utc()
    if data.published_at and data.published_at > now + FUTURE_TOLERANCE:
        raise InvalidInputError("published_at cannot be in the future")
    if "title" in sent and data.title:
        row.title = data.title
    if "post_url" in sent:
        row.post_url = data.post_url
    if "published_at" in sent:
        row.published_at = data.published_at
    row.updated_at = now
    session.add(row)
    record_audit(
        session,
        action="results.update",
        entity_type="confirmed_copy",
        actor_id=user_id,
        brand_id=row.brand_id,
        entity_id=row.id,
        detail={"fields": sorted(sent)},
    )
    session.commit()
    session.refresh(row)
    return row


def add_metric(
    *,
    session: Session,
    row: ConfirmedCopy,
    data: MetricCreate,
    user_id: uuid.UUID,
) -> PostMetric:
    now = get_datetime_utc()
    captured = data.captured_at or now
    if captured > now + FUTURE_TOLERANCE:
        raise InvalidInputError("captured_at cannot be in the future")
    metric = PostMetric(
        copy_id=row.id,
        brand_id=row.brand_id,
        captured_at=captured,
        likes=data.likes,
        collects=data.collects,
        comments=data.comments,
        approximate=data.approximate,
        source=data.source,
        created_by=user_id,
    )
    session.add(metric)
    record_audit(
        session,
        action="results.metric",
        entity_type="confirmed_copy",
        actor_id=user_id,
        brand_id=row.brand_id,
        entity_id=row.id,
        detail={"source": data.source, "approximate": data.approximate},
    )
    session.commit()
    session.refresh(metric)
    return metric


def list_metrics(session: Session, copy_id: uuid.UUID) -> list[PostMetric]:
    return list(
        session.exec(
            select(PostMetric)
            .where(PostMetric.copy_id == copy_id)
            .order_by(
                col(PostMetric.captured_at).desc(), col(PostMetric.created_at).desc()
            )
        ).all()
    )


def summary(*, session: Session, brand_id: uuid.UUID) -> ResultsSummary:
    now = get_datetime_utc()
    copies = list(
        session.exec(
            select(ConfirmedCopy).where(ConfirmedCopy.brand_id == brand_id)
        ).all()
    )
    pending = session.exec(
        select(func.count())
        .select_from(ConfirmedCopy)
        .where(ConfirmedCopy.brand_id == brand_id, *_due_filter(now))
    ).one()
    used = rules.most_used([(c.scenario_name, c.scene) for c in copies])
    metrics = _latest_metrics(session, [c.id for c in copies])
    rows = [
        (
            (c.scenario_name, c.scene),
            rules.engagement(m[0].likes, m[0].collects, m[0].comments),
            m[0].approximate,
        )
        for c in copies
        if (m := metrics.get(c.id))
    ]
    enough, stats = rules.hottest(rows)
    return ResultsSummary(
        total_copies=len(copies),
        pending_count=pending,
        most_used=[UsageStat(scenario_name=k[0], scene=k[1], count=n) for k, n in used],
        hottest=HottestPublic(
            enough_data=enough,
            min_notes=rules.MIN_NOTES_FOR_RANKING,
            notes_with_metrics=len(rows),
            items=[
                HotStat(
                    scenario_name=s.key[0],
                    scene=s.key[1],
                    note_count=s.count,
                    average_engagement=round(s.average, 1),
                    approximate=s.approximate,
                )
                for s in stats
            ],
        ),
    )
