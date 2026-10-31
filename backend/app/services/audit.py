import uuid
from typing import Any

from sqlmodel import Session

from app.models import AuditLog


def record_audit(
    session: Session,
    *,
    action: str,
    entity_type: str,
    actor_id: uuid.UUID | None,
    brand_id: uuid.UUID | None = None,
    entity_id: uuid.UUID | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    """Add an audit row to the caller's transaction (it is committed or rolled back with it).

    ``action`` is a dotted name such as ``knowledge.approve``. Keep ``detail`` small and free of
    secrets and of full document text.
    """
    session.add(
        AuditLog(
            brand_id=brand_id,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail=detail or {},
        )
    )
