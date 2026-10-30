import re
import uuid

from sqlmodel import Session, col, func, select

from app.models import (
    Brand,
    BrandCreate,
    BrandMember,
    BrandUpdate,
    MemberRole,
    Tenant,
    User,
)
from app.services.errors import ConflictError, NotFoundError

DEFAULT_TENANT_NAME = "Default"


def get_default_tenant(session: Session) -> Tenant:
    """Single-tenant demo: use the oldest tenant, creating one when none exists yet."""
    tenant = session.exec(select(Tenant).order_by(col(Tenant.created_at))).first()
    if tenant is None:
        tenant = Tenant(name=DEFAULT_TENANT_NAME)
        session.add(tenant)
        session.flush()
    return tenant


def _slug_base(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:50]
    # Names without ASCII letters (for example Chinese names) fall back to a random slug.
    return base if len(base) >= 2 else f"brand-{uuid.uuid4().hex[:8]}"


def _unique_slug(session: Session, base: str) -> str:
    slug, n = base, 1
    while session.exec(select(Brand.id).where(Brand.slug == slug)).first() is not None:
        n += 1
        slug = f"{base[:55]}-{n}"
    return slug


def create_brand(*, session: Session, data: BrandCreate, creator: User) -> Brand:
    """Create a brand and make its creator a brand admin so the creator can see and manage it."""
    tenant = get_default_tenant(session)
    if data.slug is not None:
        if session.exec(select(Brand.id).where(Brand.slug == data.slug)).first():
            raise ConflictError("Brand slug already exists")
        slug = data.slug
    else:
        slug = _unique_slug(session, _slug_base(data.name))
    brand = Brand(
        tenant_id=tenant.id,
        name=data.name,
        slug=slug,
        category=data.category.value,
        description=data.description,
    )
    session.add(brand)
    session.flush()
    session.add(
        BrandMember(brand_id=brand.id, user_id=creator.id, role=MemberRole.ADMIN.value)
    )
    session.commit()
    session.refresh(brand)
    return brand


def list_brands_for_user(
    *, session: Session, user_id: uuid.UUID
) -> list[tuple[Brand, str]]:
    statement = (
        select(Brand, BrandMember.role)
        .join(BrandMember, col(BrandMember.brand_id) == col(Brand.id))
        .where(BrandMember.user_id == user_id)
        .order_by(col(Brand.name))
    )
    return [(brand, role) for brand, role in session.exec(statement).all()]


def get_brand(*, session: Session, brand_id: uuid.UUID) -> Brand:
    brand = session.get(Brand, brand_id)
    if brand is None:
        raise NotFoundError("Brand not found")
    return brand


def update_brand(*, session: Session, brand: Brand, data: BrandUpdate) -> Brand:
    changes = data.model_dump(exclude_unset=True)
    if changes.get("category") is not None:
        changes["category"] = changes["category"].value
    brand.sqlmodel_update(changes)
    session.add(brand)
    session.commit()
    session.refresh(brand)
    return brand


def list_members(
    *, session: Session, brand_id: uuid.UUID
) -> list[tuple[BrandMember, User]]:
    statement = (
        select(BrandMember, User)
        .join(User, col(User.id) == col(BrandMember.user_id))
        .where(BrandMember.brand_id == brand_id)
        .order_by(col(User.email))
    )
    return [(m, u) for m, u in session.exec(statement).all()]


def _admin_count(session: Session, brand_id: uuid.UUID) -> int:
    return session.exec(
        select(func.count())
        .select_from(BrandMember)
        .where(
            BrandMember.brand_id == brand_id,
            BrandMember.role == MemberRole.ADMIN.value,
        )
    ).one()


def _get_member(
    session: Session, brand_id: uuid.UUID, user_id: uuid.UUID
) -> BrandMember:
    member = session.get(BrandMember, (brand_id, user_id))
    if member is None:
        raise NotFoundError("Member not found")
    return member


def add_member(
    *, session: Session, brand_id: uuid.UUID, user_id: uuid.UUID, role: MemberRole
) -> tuple[BrandMember, User]:
    user = session.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")
    if session.get(BrandMember, (brand_id, user_id)) is not None:
        raise ConflictError("The user is already a member of this brand")
    member = BrandMember(brand_id=brand_id, user_id=user_id, role=role.value)
    session.add(member)
    session.commit()
    session.refresh(member)
    return member, user


def update_member_role(
    *, session: Session, brand_id: uuid.UUID, user_id: uuid.UUID, role: MemberRole
) -> tuple[BrandMember, User]:
    member = _get_member(session, brand_id, user_id)
    if (
        member.role == MemberRole.ADMIN.value
        and role != MemberRole.ADMIN
        and _admin_count(session, brand_id) <= 1
    ):
        raise ConflictError("A brand must keep at least one admin")
    member.role = role.value
    session.add(member)
    session.commit()
    session.refresh(member)
    user = session.get(User, user_id)
    assert user is not None  # the membership row references an existing user
    return member, user


def remove_member(*, session: Session, brand_id: uuid.UUID, user_id: uuid.UUID) -> None:
    member = _get_member(session, brand_id, user_id)
    if member.role == MemberRole.ADMIN.value and _admin_count(session, brand_id) <= 1:
        raise ConflictError("A brand must keep at least one admin")
    session.delete(member)
    session.commit()
