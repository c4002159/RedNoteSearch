"""Read-only, brand-scoped inputs for the three independent tone groups."""

import uuid

from sqlmodel import Session, col, select

from app.domain import tone as rules
from app.models import ConfirmedCopy, PostMetric, ScenarioTemplate, StylePreset, Task
from app.models.viral import ViralPattern


def suggestions(
    *, session: Session, brand_id: uuid.UUID, scene: str | None = None, limit: int = 10
) -> rules.ToneSuggestions:
    tasks_query = select(Task).where(Task.brand_id == brand_id)
    if scene is not None:
        tasks_query = tasks_query.join(ScenarioTemplate).where(
            ScenarioTemplate.scene == scene
        )
    tasks = session.exec(
        tasks_query.order_by(col(Task.created_at).desc(), col(Task.id))
    ).all()
    # Presets and extracted structures have no scene: always brand-wide.
    presets = session.exec(
        select(StylePreset)
        .where(StylePreset.brand_id == brand_id)
        .order_by(col(StylePreset.created_at).desc(), col(StylePreset.id))
    ).all()
    patterns = session.exec(
        select(ViralPattern)
        .where(ViralPattern.brand_id == brand_id)
        .order_by(col(ViralPattern.created_at), col(ViralPattern.id))
    ).all()

    copies_query = (
        select(ConfirmedCopy, Task)
        .join(Task, col(ConfirmedCopy.task_id) == col(Task.id))
        .where(ConfirmedCopy.brand_id == brand_id, Task.brand_id == brand_id)
    )
    if scene is not None:
        copies_query = copies_query.where(ConfirmedCopy.scene == scene)
    copies = session.exec(
        copies_query.order_by(
            col(ConfirmedCopy.confirmed_at).desc(), col(ConfirmedCopy.id)
        )
    ).all()
    # Scope both sides of the join; only each copy's latest captured reading counts.
    latest: dict[uuid.UUID, PostMetric] = {}
    if copies:
        for metric in session.exec(
            select(PostMetric)
            .where(
                PostMetric.brand_id == brand_id,
                col(PostMetric.copy_id).in_([copy.id for copy, _ in copies]),
            )
            .order_by(
                col(PostMetric.captured_at).desc(),
                col(PostMetric.created_at).desc(),
                col(PostMetric.id),
            )
        ).all():
            latest.setdefault(metric.copy_id, metric)
    readings = [
        (
            task.style.get("tone"),
            reading.likes,
            reading.collects,
            reading.comments,
            reading.approximate,
        )
        for copy, task in copies
        if (reading := latest.get(copy.id)) is not None
    ]
    return rules.ToneSuggestions(
        history=rules.history_tones(
            [(task.style.get("tone"), task.created_at) for task in tasks],
            [(preset.params.get("tone"), preset.created_at) for preset in presets],
            limit,
        ),
        template=rules.template_tones(
            [(pattern.tone, str(pattern.sample_id)) for pattern in patterns], limit
        ),
        results=rules.result_tones(readings, limit),
    )
