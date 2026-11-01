import uuid

from fastapi import APIRouter, Depends

from app.api.brand_deps import BrandManagerDep
from app.api.deps import CurrentUser, SessionDep, get_current_active_superuser
from app.models import (
    BrandCreate,
    BrandListItem,
    BrandPublic,
    BrandsPublic,
    BrandUpdate,
    MemberCreate,
    MemberPublic,
    MembersPublic,
    MemberUpdate,
    Message,
)
from app.services import brands as brand_service

router = APIRouter(prefix="/brands", tags=["brands"])


@router.get("", response_model=BrandsPublic)
def read_brands(session: SessionDep, current_user: CurrentUser) -> BrandsPublic:
    """Brands the current user is a member of, with the user's role in each."""
    rows = brand_service.list_brands_for_user(session=session, user_id=current_user.id)
    return BrandsPublic(
        items=[
            BrandListItem(id=b.id, name=b.name, category=b.category, role=role)
            for b, role in rows
        ]
    )


@router.post(
    "",
    response_model=BrandPublic,
    status_code=201,
    dependencies=[Depends(get_current_active_superuser)],
)
def create_brand(
    session: SessionDep, current_user: CurrentUser, body: BrandCreate
) -> BrandPublic:
    """Platform administrators only. The creator becomes an admin of the new brand."""
    brand = brand_service.create_brand(session=session, data=body, creator=current_user)
    return BrandPublic.model_validate(brand)


@router.patch("/{brand_id}", response_model=BrandPublic)
def update_brand(
    brand: BrandManagerDep, session: SessionDep, body: BrandUpdate
) -> BrandPublic:
    updated = brand_service.update_brand(session=session, brand=brand, data=body)
    return BrandPublic.model_validate(updated)


@router.get("/{brand_id}/members", response_model=MembersPublic)
def read_members(brand: BrandManagerDep, session: SessionDep) -> MembersPublic:
    rows = brand_service.list_members(session=session, brand_id=brand.id)
    return MembersPublic(
        items=[
            MemberPublic(
                user_id=u.id, email=u.email, full_name=u.full_name, role=m.role
            )
            for m, u in rows
        ]
    )


@router.post("/{brand_id}/members", response_model=MemberPublic, status_code=201)
def add_member(
    brand: BrandManagerDep, session: SessionDep, body: MemberCreate
) -> MemberPublic:
    member, user = brand_service.add_member(
        session=session,
        brand_id=brand.id,
        user_id=body.user_id,
        email=body.email,
        role=body.role,
    )
    return MemberPublic(
        user_id=user.id, email=user.email, full_name=user.full_name, role=member.role
    )


@router.patch("/{brand_id}/members/{user_id}", response_model=MemberPublic)
def update_member(
    brand: BrandManagerDep, session: SessionDep, user_id: uuid.UUID, body: MemberUpdate
) -> MemberPublic:
    member, user = brand_service.update_member_role(
        session=session, brand_id=brand.id, user_id=user_id, role=body.role
    )
    return MemberPublic(
        user_id=user.id, email=user.email, full_name=user.full_name, role=member.role
    )


@router.delete("/{brand_id}/members/{user_id}", response_model=Message)
def remove_member(
    brand: BrandManagerDep, session: SessionDep, user_id: uuid.UUID
) -> Message:
    brand_service.remove_member(session=session, brand_id=brand.id, user_id=user_id)
    return Message(message="Member removed successfully")
