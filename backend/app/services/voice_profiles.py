import uuid

from sqlmodel import Session, col, func, select

from app.models import BrandVoiceProfile, VoiceProfileCreate
from app.ports.voice import VoiceProfile
from app.services.audit import record_audit
from app.services.errors import NotFoundError


def get_active(*, session: Session, brand_id: uuid.UUID) -> BrandVoiceProfile | None:
    return session.exec(
        select(BrandVoiceProfile).where(
            BrandVoiceProfile.brand_id == brand_id,
            col(BrandVoiceProfile.is_active).is_(True),
        )
    ).first()


def list_versions(*, session: Session, brand_id: uuid.UUID) -> list[BrandVoiceProfile]:
    return list(
        session.exec(
            select(BrandVoiceProfile)
            .where(BrandVoiceProfile.brand_id == brand_id)
            .order_by(col(BrandVoiceProfile.version).desc())
        ).all()
    )


def create_version(
    *,
    session: Session,
    brand_id: uuid.UUID,
    data: VoiceProfileCreate,
    created_by: uuid.UUID,
) -> BrandVoiceProfile:
    """Create the next version as an inactive draft; it only takes effect when activated."""
    latest = session.exec(
        select(func.max(BrandVoiceProfile.version)).where(
            BrandVoiceProfile.brand_id == brand_id
        )
    ).one()
    profile = BrandVoiceProfile(
        brand_id=brand_id,
        version=(latest or 0) + 1,
        created_by=created_by,
        **data.model_dump(),
    )
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile


def activate_version(
    *, session: Session, brand_id: uuid.UUID, version: int, actor_id: uuid.UUID
) -> BrandVoiceProfile:
    target = session.exec(
        select(BrandVoiceProfile).where(
            BrandVoiceProfile.brand_id == brand_id,
            BrandVoiceProfile.version == version,
        )
    ).first()
    if target is None:
        raise NotFoundError("Voice profile version not found")
    current = get_active(session=session, brand_id=brand_id)
    if current is not None and current.id != target.id:
        current.is_active = False
        session.add(current)
        session.flush()  # release the one-active-per-brand index before activating
    target.is_active = True
    session.add(target)
    record_audit(
        session,
        action="voice_profile.activate",
        entity_type="brand_voice_profile",
        actor_id=actor_id,
        brand_id=brand_id,
        entity_id=target.id,
        detail={"version": version},
    )
    session.commit()
    session.refresh(target)
    return target


class DbVoiceProfileProvider:
    """``VoiceProfileProvider`` backed by the database (the port the generation code depends on)."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_active(self, *, brand_id: uuid.UUID) -> VoiceProfile | None:
        row = get_active(session=self._session, brand_id=brand_id)
        if row is None:
            return None
        return VoiceProfile(
            brand_id=row.brand_id,
            version=row.version,
            persona=row.persona,
            tone_keywords=tuple(row.tone_keywords),
            preferred_words=tuple(row.preferred_words),
            forbidden_words=tuple(row.forbidden_words),
            sample_refs=tuple(row.sample_refs),
        )
