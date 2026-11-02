"""Independent tone sources; plain values only, without model calls or combined scores."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from app.domain.results import MIN_NOTES_FOR_RANKING, engagement, hottest


@dataclass(frozen=True)
class HistoryTone:
    tone: str
    source: Literal["task", "preset"]
    count: int | None
    last_used_at: datetime | None


@dataclass(frozen=True)
class TemplateTone:
    tone: str
    count: int
    sample_count: int


@dataclass(frozen=True)
class ResultTone:
    tone: str
    note_count: int
    average_engagement: float
    approximate: bool


@dataclass(frozen=True)
class ToneResults:
    enough_data: bool
    notes_with_metrics: int
    min_notes: int
    items: list[ResultTone]


@dataclass(frozen=True)
class ToneSuggestions:
    history: list[HistoryTone]
    template: list[TemplateTone]
    results: ToneResults


def clean_tone(value: object) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def _time(value: datetime | None) -> datetime:
    if value is None:
        return datetime.min.replace(tzinfo=UTC)
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _check_limit(limit: int) -> None:
    if not 1 <= limit <= 20:
        raise ValueError("limit must be between 1 and 20")


def history_tones(
    tasks: Sequence[tuple[object, datetime | None]],
    presets: Sequence[tuple[object, datetime | None]],
    limit: int = 10,
) -> list[HistoryTone]:
    """Tasks count uses; presets are options, never evidence of a use."""
    _check_limit(limit)
    task_groups: dict[str, list[datetime | None]] = {}
    for value, at in tasks:
        if tone := clean_tone(value):
            task_groups.setdefault(tone, []).append(at)
    counted = [
        HistoryTone(tone, "task", len(times), max(times, key=_time))
        for tone, times in task_groups.items()
    ]
    counted.sort(
        key=lambda row: (row.count or 0, _time(row.last_used_at)), reverse=True
    )
    preset_times: dict[str, datetime | None] = {}
    for value, at in presets:
        if tone := clean_tone(value):
            if tone not in preset_times or _time(at) > _time(preset_times[tone]):
                preset_times[tone] = at
    options = [
        HistoryTone(tone, "preset", None, None)
        for tone in sorted(
            preset_times, key=lambda tone: _time(preset_times[tone]), reverse=True
        )
    ]
    return (counted + options)[:limit]


def template_tones(
    patterns: Sequence[tuple[object, str]], limit: int = 10
) -> list[TemplateTone]:
    _check_limit(limit)
    groups: dict[str, list[str]] = {}
    for value, sample_id in patterns:
        if tone := clean_tone(value):
            groups.setdefault(tone, []).append(sample_id)
    rows = [TemplateTone(tone, len(ids), len(set(ids))) for tone, ids in groups.items()]
    rows.sort(key=lambda row: -row.count)
    return rows[:limit]


def result_tones(
    readings: Sequence[tuple[object, int, int, int, bool]], limit: int = 10
) -> ToneResults:
    """One latest reading per confirmed copy, supplied by the service."""
    _check_limit(limit)
    rows = [
        ((tone, ""), engagement(likes, collects, comments), approximate)
        for value, likes, collects, comments, approximate in readings
        if (tone := clean_tone(value))
    ]
    enough, stats = hottest(rows, limit=limit)
    return ToneResults(
        enough_data=enough,
        notes_with_metrics=len(rows),
        min_notes=MIN_NOTES_FOR_RANKING,
        items=[
            ResultTone(s.key[0], s.count, round(s.average, 1), s.approximate)
            for s in stats
        ],
    )
