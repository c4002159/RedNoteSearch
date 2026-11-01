import enum
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import StringConstraints, model_validator
from sqlalchemy import CheckConstraint, DateTime, Index
from sqlmodel import Field, SQLModel

from app.models.common import get_datetime_utc


class BrandCategory(enum.StrEnum):
    PERFUME = "perfume"
    SKINCARE = "skincare"
    MAKEUP = "makeup"
    HOME_FRAGRANCE = "home_fragrance"
    OTHER = "other"


class MemberRole(enum.StrEnum):
    ADMIN = "admin"
    EDITOR = "editor"


def _in_list(column: str, values: type[enum.StrEnum]) -> str:
    quoted = ", ".join(f"'{v.value}'" for v in values)
    return f"{column} IN ({quoted})"


# Organisation boundary (ADR / technical document 5.5): one tenant owns several brands.
class Tenant(SQLModel, table=True):
    __tablename__ = "tenant"  # type: ignore[assignment]

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# Brand boundary: every brand-scoped table carries brand_id.
class Brand(SQLModel, table=True):
    __tablename__ = "brand"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(_in_list("category", BrandCategory), name="ck_brand_category"),
        Index("ix_brand_tenant_id", "tenant_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(
        foreign_key="tenant.id", nullable=False, ondelete="CASCADE"
    )
    name: str = Field(max_length=100)
    slug: str = Field(unique=True, index=True, max_length=60)
    category: str = Field(default=BrandCategory.OTHER.value, max_length=30)
    description: str | None = Field(default=None, max_length=1000)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# Which users may act on a brand, and in which role (brand-level authorisation).
class BrandMember(SQLModel, table=True):
    __tablename__ = "brand_member"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(_in_list("role", MemberRole), name="ck_brand_member_role"),
        Index("ix_brand_member_user_id", "user_id"),
    )

    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", primary_key=True, ondelete="CASCADE"
    )
    user_id: uuid.UUID = Field(
        foreign_key="user.id", primary_key=True, ondelete="CASCADE"
    )
    role: str = Field(default=MemberRole.EDITOR.value, max_length=20)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# ---- API schemas (not tables) ----
Slug = Annotated[
    str, StringConstraints(min_length=2, max_length=60, pattern=r"^[a-z0-9][a-z0-9-]*$")
]


class BrandCreate(SQLModel):
    name: str = Field(min_length=1, max_length=100)
    category: BrandCategory = BrandCategory.OTHER
    description: str | None = Field(default=None, max_length=1000)
    # Optional: derived from the name when omitted.
    slug: Slug | None = None


class BrandUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    category: BrandCategory | None = None
    description: str | None = Field(default=None, max_length=1000)


class BrandPublic(SQLModel):
    id: uuid.UUID
    name: str
    slug: str
    category: str
    description: str | None = None


class BrandListItem(SQLModel):
    id: uuid.UUID
    name: str
    category: str
    role: str


class BrandsPublic(SQLModel):
    items: list[BrandListItem]


class MemberCreate(SQLModel):
    """Identify the user by `user_id` or by `email` (exactly one of them)."""

    user_id: uuid.UUID | None = None
    email: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None
    ) = None
    role: MemberRole

    @model_validator(mode="after")
    def _exactly_one_identifier(self) -> MemberCreate:
        if (self.user_id is None) == (self.email is None or self.email == ""):
            raise ValueError("Provide exactly one of user_id or email")
        return self


class MemberUpdate(SQLModel):
    role: MemberRole


class MemberPublic(SQLModel):
    user_id: uuid.UUID
    email: str
    full_name: str | None = None
    role: str


class MembersPublic(SQLModel):
    items: list[MemberPublic]
