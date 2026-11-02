"""Keyword search for list endpoints: a case-insensitive "contains" match, with the user's text escaped
so ``%`` and ``_`` are ordinary characters."""

from typing import Any

from sqlalchemy import or_

SEARCH_MAX_LENGTH = 100


def contains_any(q: str | None, *columns: Any) -> Any | None:
    """A condition matching rows where any of ``columns`` contains ``q``, or ``None`` for an empty ``q``."""
    text = (q or "").strip()
    if not text:
        return None
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return or_(*(c.ilike(f"%{escaped}%", escape="\\") for c in columns))
