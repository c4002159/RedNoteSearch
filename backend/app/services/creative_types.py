import secrets
import uuid

from sqlalchemy import func, or_
from sqlmodel import Session, col, select

from app.models import (
    Brand,
    ConfirmedCopy,
    CreativeType,
    CreativeTypePublic,
    ScenarioTemplate,
    Scene,
)
from app.models.creative_type import MAX_CUSTOM_TYPES
from app.services.audit import record_audit
from app.services.errors import ConflictError, InvalidInputError, NotFoundError

BUILTIN_NAMES: dict[str, str] = {
    Scene.SEEDING.value: "种草",
    Scene.REVIEW.value: "测评",
    Scene.TUTORIAL.value: "教程",
    Scene.LAUNCH.value: "上新",
    Scene.PROMOTION.value: "促销",
    Scene.STORY.value: "故事",
}


def custom_types(session: Session, brand_id: uuid.UUID) -> list[CreativeType]:
    return list(
        session.exec(
            select(CreativeType)
            .where(CreativeType.brand_id == brand_id)
            .order_by(col(CreativeType.created_at), col(CreativeType.key))
        ).all()
    )


def ensure_known_scene(session: Session, brand_id: uuid.UUID, scene: str) -> None:
    """A template's scene is a built-in type or one of the brand's own."""
    if scene in BUILTIN_NAMES:
        return
    known = session.exec(
        select(CreativeType.id).where(
            CreativeType.brand_id == brand_id, CreativeType.key == scene
        )
    ).first()
    if known is None:
        raise InvalidInputError("Unknown creative type")


def _usage(session: Session, brand_id: uuid.UUID) -> dict[str, int]:
    rows = session.exec(
        select(ScenarioTemplate.scene, func.count())
        .where(
            or_(
                col(ScenarioTemplate.brand_id) == brand_id,
                col(ScenarioTemplate.brand_id).is_(None),
            )
        )
        .group_by(ScenarioTemplate.scene)
    ).all()
    return dict(rows)


def list_types(session: Session, brand_id: uuid.UUID) -> list[CreativeTypePublic]:
    usage = _usage(session, brand_id)
    items = [
        CreativeTypePublic(
            key=key, name=name, builtin=True, template_count=usage.get(key, 0)
        )
        for key, name in BUILTIN_NAMES.items()
    ]
    items += [
        CreativeTypePublic(
            key=t.key, name=t.name, builtin=False, template_count=usage.get(t.key, 0)
        )
        for t in custom_types(session, brand_id)
    ]
    return items


def _lock_brand(session: Session, brand_id: uuid.UUID) -> None:
    session.exec(select(Brand.id).where(Brand.id == brand_id).with_for_update()).one()


def _check_name(
    session: Session, brand_id: uuid.UUID, name: str, own_key: str = ""
) -> None:
    taken = {n.casefold() for n in BUILTIN_NAMES.values()} | {
        t.name.casefold() for t in custom_types(session, brand_id) if t.key != own_key
    }
    if name.casefold() in taken:
        raise ConflictError("A creative type with this name already exists")


def create_type(
    session: Session, *, brand_id: uuid.UUID, name: str, actor_id: uuid.UUID
) -> CreativeType:
    try:
        _lock_brand(session, brand_id)
        if len(custom_types(session, brand_id)) >= MAX_CUSTOM_TYPES:
            raise ConflictError(
                f"A brand may have at most {MAX_CUSTOM_TYPES} own types"
            )
        _check_name(session, brand_id, name)
        row = CreativeType(brand_id=brand_id, key="c" + secrets.token_hex(4), name=name)
        session.add(row)
        session.flush()
        record_audit(
            session,
            action="creative_type.create",
            entity_type="creative_type",
            actor_id=actor_id,
            brand_id=brand_id,
            entity_id=row.id,
            detail={"key": row.key},
        )
        session.commit()
        session.refresh(row)
        return row
    except Exception:
        session.rollback()
        raise


def _own_type(session: Session, brand_id: uuid.UUID, key: str) -> CreativeType:
    row = session.exec(
        select(CreativeType).where(
            CreativeType.brand_id == brand_id, CreativeType.key == key
        )
    ).first()
    if row is None:
        if key in BUILTIN_NAMES:
            raise ConflictError("Built-in creative types cannot be changed")
        raise NotFoundError("Creative type not found")
    return row


def rename_type(
    session: Session, *, brand_id: uuid.UUID, key: str, name: str, actor_id: uuid.UUID
) -> CreativeType:
    try:
        _lock_brand(session, brand_id)
        row = _own_type(session, brand_id, key)
        _check_name(session, brand_id, name, own_key=key)
        row.name = name
        session.add(row)
        record_audit(
            session,
            action="creative_type.rename",
            entity_type="creative_type",
            actor_id=actor_id,
            brand_id=brand_id,
            entity_id=row.id,
            detail={"key": key},
        )
        session.commit()
        session.refresh(row)
        return row
    except Exception:
        session.rollback()
        raise


def delete_type(
    session: Session, *, brand_id: uuid.UUID, key: str, actor_id: uuid.UUID
) -> None:
    """Only a type nothing uses: no template version and no confirmed note carries its key."""
    try:
        _lock_brand(session, brand_id)
        row = _own_type(session, brand_id, key)
        templates = session.exec(
            select(func.count())
            .select_from(ScenarioTemplate)
            .where(ScenarioTemplate.brand_id == brand_id, ScenarioTemplate.scene == key)
        ).one()
        notes = session.exec(
            select(func.count())
            .select_from(ConfirmedCopy)
            .where(ConfirmedCopy.brand_id == brand_id, ConfirmedCopy.scene == key)
        ).one()
        if templates or notes:
            raise ConflictError(
                "This creative type is in use",
                {"templates": templates, "confirmed_copies": notes},
            )
        session.delete(row)
        record_audit(
            session,
            action="creative_type.delete",
            entity_type="creative_type",
            actor_id=actor_id,
            brand_id=brand_id,
            entity_id=row.id,
            detail={"key": key},
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
