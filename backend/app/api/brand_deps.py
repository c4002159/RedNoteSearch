"""Brand-level authorisation dependencies (member A provides them, member B's routes use them).

The brand id always comes from the URL path and is checked against ``brand_member`` on the server;
a ``brand_id`` in a request body never grants access. A user who is not a member of an explicitly
addressed brand gets 403 (docs/API_CONTRACT.md, section 1.2).

* ``BrandAccessDep``  - any member of the brand (editor or admin)
* ``BrandAdminDep``   - a brand admin
* ``BrandManagerDep`` - a platform administrator (``is_superuser``) or a brand admin; used for managing
  brands and their members. Platform administrators get **no** access to brand-scoped data through
  ``BrandAccessDep``: they must be members like everyone else.
"""

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException

from app.api.deps import CurrentUser, SessionDep
from app.models import Brand, BrandMember, MemberRole
from app.services.brands import get_brand


@dataclass(frozen=True)
class BrandAccess:
    brand_id: uuid.UUID
    user_id: uuid.UUID
    role: MemberRole


def get_brand_access(
    brand_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> BrandAccess:
    member = session.get(BrandMember, (brand_id, current_user.id))
    if member is None:
        raise HTTPException(status_code=403, detail="No access to this brand")
    return BrandAccess(
        brand_id=brand_id, user_id=current_user.id, role=MemberRole(member.role)
    )


BrandAccessDep = Annotated[BrandAccess, Depends(get_brand_access)]


def get_brand_admin_access(access: BrandAccessDep) -> BrandAccess:
    if access.role != MemberRole.ADMIN:
        raise HTTPException(status_code=403, detail="Brand admin role required")
    return access


BrandAdminDep = Annotated[BrandAccess, Depends(get_brand_admin_access)]


def get_brand_manager(
    brand_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Brand:
    """Return the brand when the user is a platform administrator or one of its admins."""
    if current_user.is_superuser:
        return get_brand(
            session=session, brand_id=brand_id
        )  # 404 when it does not exist
    member = session.get(BrandMember, (brand_id, current_user.id))
    if member is None or member.role != MemberRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Brand admin role required")
    return get_brand(session=session, brand_id=brand_id)


BrandManagerDep = Annotated[Brand, Depends(get_brand_manager)]
