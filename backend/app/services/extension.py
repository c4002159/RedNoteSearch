import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.domain.results import note_id
from app.models import (
    ConfirmedCopy,
    ExtensionKey,
    ExtensionMetric,
    ExtensionRecorded,
    PostMetric,
)
from app.models.common import get_datetime_utc
from app.services.audit import record_audit
from app.services.errors import InvalidInputError, NotFoundError

KEY_PREFIX = "rnk_"
MAX_KEYS_PER_BRAND = 10
# Readings the extension may add to one note in an hour; a leaked key cannot flood a note.
MAX_READINGS_PER_HOUR = 12
FUTURE_TOLERANCE = timedelta(minutes=10)


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create_key(
    session: Session, *, brand_id: uuid.UUID, label: str, actor_id: uuid.UUID
) -> tuple[ExtensionKey, str]:
    active = session.exec(
        select(func.count())
        .select_from(ExtensionKey)
        .where(
            ExtensionKey.brand_id == brand_id, col(ExtensionKey.revoked_at).is_(None)
        )
    ).one()
    if active >= MAX_KEYS_PER_BRAND:
        raise InvalidInputError(f"At most {MAX_KEYS_PER_BRAND} active keys per brand")
    key = KEY_PREFIX + secrets.token_urlsafe(32)
    row = ExtensionKey(
        brand_id=brand_id,
        label=label,
        prefix=key[: len(KEY_PREFIX) + 4],
        key_hash=_hash(key),
        created_by=actor_id,
    )
    session.add(row)
    session.flush()
    record_audit(
        session,
        action="extension_key.create",
        entity_type="extension_key",
        actor_id=actor_id,
        brand_id=brand_id,
        entity_id=row.id,
        detail={},
    )
    session.commit()
    session.refresh(row)
    return row, key


def list_keys(session: Session, brand_id: uuid.UUID) -> list[ExtensionKey]:
    return list(
        session.exec(
            select(ExtensionKey)
            .where(ExtensionKey.brand_id == brand_id)
            .order_by(col(ExtensionKey.created_at).desc())
        ).all()
    )


def revoke_key(
    session: Session, *, brand_id: uuid.UUID, key_id: uuid.UUID, actor_id: uuid.UUID
) -> ExtensionKey:
    row = session.get(ExtensionKey, key_id)
    if row is None or row.brand_id != brand_id:
        raise NotFoundError("Key not found")
    if row.revoked_at is None:
        row.revoked_at = get_datetime_utc()
        session.add(row)
        record_audit(
            session,
            action="extension_key.revoke",
            entity_type="extension_key",
            actor_id=actor_id,
            brand_id=brand_id,
            entity_id=row.id,
            detail={},
        )
        session.commit()
        session.refresh(row)
    return row


def authenticate(session: Session, key: str | None) -> ExtensionKey:
    """The active key that matches, or 401. Every failure looks the same."""
    row = (
        session.exec(
            select(ExtensionKey).where(ExtensionKey.key_hash == _hash(key))
        ).first()
        if key
        else None
    )
    if (
        row is None
        or row.revoked_at is not None
        or not hmac.compare_digest(row.key_hash, _hash(key or ""))
    ):
        raise HTTPException(status_code=401, detail="Invalid extension key")
    return row


def record_reading(
    session: Session, *, key: ExtensionKey, data: ExtensionMetric
) -> ExtensionRecorded:
    nid = note_id(data.note_url)
    if nid is None:
        raise InvalidInputError("This is not the address of a Xiaohongshu note page")
    copy = session.exec(
        select(ConfirmedCopy)
        .where(
            ConfirmedCopy.brand_id == key.brand_id, ConfirmedCopy.post_note_id == nid
        )
        .order_by(col(ConfirmedCopy.confirmed_at).desc())
    ).first()
    if copy is None:
        raise NotFoundError(
            "No confirmed note of this brand has this link; save the post link on the note first"
        )
    now = get_datetime_utc()
    captured = data.captured_at or now
    if captured > now + FUTURE_TOLERANCE:
        raise InvalidInputError("captured_at cannot be in the future")
    recent = session.exec(
        select(func.count())
        .select_from(PostMetric)
        .where(
            PostMetric.copy_id == copy.id,
            PostMetric.source == "extension",
            col(PostMetric.created_at) >= now - timedelta(hours=1),
        )
    ).one()
    if recent >= MAX_READINGS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many readings for this note")
    session.add(
        PostMetric(
            copy_id=copy.id,
            brand_id=copy.brand_id,
            captured_at=captured,
            likes=data.likes,
            collects=data.collects,
            comments=data.comments,
            approximate=data.approximate,
            source="extension",
            created_by=None,
        )
    )
    key.last_used_at = now
    session.add(key)
    record_audit(
        session,
        action="results.metric",
        entity_type="confirmed_copy",
        actor_id=None,
        brand_id=copy.brand_id,
        entity_id=copy.id,
        detail={"source": "extension", "approximate": data.approximate},
    )
    session.commit()
    return ExtensionRecorded(recorded=True, approximate=data.approximate)
