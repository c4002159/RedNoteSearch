from fastapi import APIRouter

from app.api.brand_deps import BrandAccessDep, BrandAdminDep
from app.api.deps import SessionDep
from app.models import (
    BrandVoiceProfile,
    VoiceProfileCreate,
    VoiceProfilePublic,
    VoiceProfilesPublic,
)
from app.services import voice_profiles as voice_service
from app.services.errors import NotFoundError

router = APIRouter(prefix="/brands/{brand_id}/voice-profile", tags=["voice-profile"])


def _public(row: BrandVoiceProfile) -> VoiceProfilePublic:
    return VoiceProfilePublic.model_validate(row, from_attributes=True)


@router.get("", response_model=VoiceProfilePublic)
def read_active_profile(
    access: BrandAccessDep, session: SessionDep
) -> VoiceProfilePublic:
    """The active voice profile; 404 when the brand has none yet."""
    row = voice_service.get_active(session=session, brand_id=access.brand_id)
    if row is None:
        raise NotFoundError("The brand has no active voice profile")
    return _public(row)


@router.get("/versions", response_model=VoiceProfilesPublic)
def read_versions(access: BrandAccessDep, session: SessionDep) -> VoiceProfilesPublic:
    rows = voice_service.list_versions(session=session, brand_id=access.brand_id)
    return VoiceProfilesPublic(items=[_public(r) for r in rows])


@router.post("/versions", response_model=VoiceProfilePublic, status_code=201)
def create_version(
    access: BrandAdminDep, session: SessionDep, body: VoiceProfileCreate
) -> VoiceProfilePublic:
    row = voice_service.create_version(
        session=session,
        brand_id=access.brand_id,
        data=body,
        created_by=access.user_id,
    )
    return _public(row)


@router.post("/versions/{version}/activate", response_model=VoiceProfilePublic)
def activate_version(
    access: BrandAdminDep, session: SessionDep, version: int
) -> VoiceProfilePublic:
    row = voice_service.activate_version(
        session=session, brand_id=access.brand_id, version=version
    )
    return _public(row)
