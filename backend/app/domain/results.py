"""Rules for tracking how published notes did. Pure functions over plain values.

Numbers come from people (or the person's own browser extension); nothing here reads the platform.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

# A post is due for numbers this many days after it was published.
DUE_AFTER_DAYS = 3
# Below this many notes with numbers, "hottest" is not shown: a ranking of one or two notes is luck.
MIN_NOTES_FOR_RANKING = 3


def due_at(published_at: datetime | None) -> datetime | None:
    return published_at + timedelta(days=DUE_AFTER_DAYS) if published_at else None


def needs_metrics(
    *,
    published_at: datetime | None,
    captured_at: Sequence[datetime],
    now: datetime,
) -> bool:
    """True when the post is at least three days old and nobody has recorded numbers since then."""
    due = due_at(published_at)
    if due is None or now < due:
        return False
    return not any(c >= due for c in captured_at)


def engagement(likes: int, collects: int, comments: int) -> int:
    return likes + collects + comments


@dataclass(frozen=True)
class GroupStat:
    key: tuple[str, str]
    count: int
    average: float
    approximate: bool


def most_used(
    keys: Sequence[tuple[str, str]], limit: int = 5
) -> list[tuple[tuple[str, str], int]]:
    """Keys by how often they appear, most first; ties keep their first-seen order."""
    counts: dict[tuple[str, str], int] = {}
    for key in keys:
        counts[key] = counts.get(key, 0) + 1
    return sorted(counts.items(), key=lambda kv: -kv[1])[:limit]


def hottest(
    rows: Sequence[tuple[tuple[str, str], int, bool]], limit: int = 5
) -> tuple[bool, list[GroupStat]]:
    """``(enough, groups)``: groups by average engagement, best first. With fewer than
    ``MIN_NOTES_FOR_RANKING`` notes the answer is ``(False, [])``. Each row is
    ``(group key, engagement, numbers were approximate)``."""
    if len(rows) < MIN_NOTES_FOR_RANKING:
        return False, []
    grouped: dict[tuple[str, str], list[tuple[int, bool]]] = {}
    for key, value, approx in rows:
        grouped.setdefault(key, []).append((value, approx))
    stats = [
        GroupStat(
            key=key,
            count=len(values),
            average=sum(v for v, _ in values) / len(values),
            approximate=any(a for _, a in values),
        )
        for key, values in grouped.items()
    ]
    stats.sort(key=lambda s: (-s.average, -s.count))
    return True, stats[:limit]
