"""A saved analysis is current when at least one row used the current sample revision."""

from collections.abc import Sequence


def structures_stale(revision: int, analyzed_revisions: Sequence[int | None]) -> bool:
    return bool(analyzed_revisions) and revision not in analyzed_revisions
