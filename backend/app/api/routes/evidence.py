import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.api.brand_deps import BrandAccess
from app.api.deps import CurrentUser, SessionDep
from app.api.routes.tasks import VersionAccessDep, _member_access
from app.models import (
    ClaimEvidence,
    ClaimEvidenceListPublic,
    ClaimEvidencePublic,
    ConfirmEvidence,
)
from app.services import evidence as evidence_service

router = APIRouter(tags=["evidence"])


def get_evidence_access(
    evidence_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> tuple[ClaimEvidence, BrandAccess]:
    """Resource-id access through the evidence row's own brand; missing and foreign both give 404."""
    row = session.get(ClaimEvidence, evidence_id)
    access = _member_access(session, current_user, row.brand_id) if row else None
    if row is None or access is None:
        raise HTTPException(status_code=404, detail="Evidence not found")
    return row, access


EvidenceAccessDep = Annotated[
    tuple[ClaimEvidence, BrandAccess], Depends(get_evidence_access)
]


@router.get(
    "/generation-versions/{version_id}/evidence",
    response_model=ClaimEvidenceListPublic,
)
def read_version_evidence(
    access: VersionAccessDep, session: SessionDep
) -> ClaimEvidenceListPublic:
    rows = evidence_service.list_evidence(session=session, version_id=access[0].id)
    return ClaimEvidenceListPublic(
        items=evidence_service.to_public(session=session, rows=rows)
    )


@router.post(
    "/claim-evidence/{evidence_id}/confirm", response_model=ClaimEvidencePublic
)
def confirm_evidence(
    access: EvidenceAccessDep, session: SessionDep, body: ConfirmEvidence
) -> ClaimEvidencePublic:
    """A person's decision about the claim. It does not change the system's ``status``."""
    row, brand_access = access
    saved = evidence_service.confirm_evidence(
        session=session,
        evidence=row,
        human_confirmed=body.human_confirmed,
        note=body.note,
        user_id=brand_access.user_id,
    )
    return evidence_service.to_public(session=session, rows=[saved])[0]
