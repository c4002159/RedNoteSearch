import enum
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.catalog import BrandCategory, _in_list
from app.models.common import get_datetime_utc


class ProductStatus(enum.StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class Product(SQLModel, table=True):
    """A product of a brand. Archived instead of deleted: past tasks may reference it."""

    __tablename__ = "product"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(
            _in_list("category", BrandCategory), name="ck_product_category"
        ),
        CheckConstraint(_in_list("status", ProductStatus), name="ck_product_status"),
        Index("ix_product_brand_status", "brand_id", "status"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    name: str = Field(max_length=100)
    product_line: str | None = Field(default=None, max_length=100)
    category: str = Field(default=BrandCategory.OTHER.value, max_length=30)
    notes: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    selling_points: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    restricted_claims: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    status: str = Field(default=ProductStatus.ACTIVE.value, max_length=20)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class BrandVoiceProfile(SQLModel, table=True):
    """One version of a brand's voice profile; at most one version per brand is active."""

    __tablename__ = "brand_voice_profile"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint("brand_id", "version", name="uq_voice_profile_version"),
        Index(
            "uq_voice_profile_one_active",
            "brand_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    version: int
    persona: str = Field(sa_type=Text)
    tone_keywords: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    preferred_words: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    forbidden_words: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    sample_refs: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    is_active: bool = Field(default=False)
    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# ---- API schemas (not tables) ----
class ProductNotes(BaseModel):
    top: list[str] = []
    middle: list[str] = []
    base: list[str] = []


class SellingPoint(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    source_document_id: uuid.UUID | None = None
    source_chunk_id: uuid.UUID | None = None


class SellingPointPublic(SellingPoint):
    # "linked": has a source in reviewed material; "draft": no source, not usable as evidence.
    evidence_status: str


class ProductCreate(SQLModel):
    name: str = Field(min_length=1, max_length=100)
    product_line: str | None = Field(default=None, max_length=100)
    category: BrandCategory = BrandCategory.OTHER
    notes: ProductNotes = ProductNotes()
    selling_points: list[SellingPoint] = Field(default_factory=list, max_length=30)
    restricted_claims: list[str] = Field(default_factory=list, max_length=50)


class ProductUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    product_line: str | None = Field(default=None, max_length=100)
    category: BrandCategory | None = None
    notes: ProductNotes | None = None
    selling_points: list[SellingPoint] | None = Field(default=None, max_length=30)
    restricted_claims: list[str] | None = Field(default=None, max_length=50)


class ProductPublic(SQLModel):
    id: uuid.UUID
    brand_id: uuid.UUID
    name: str
    product_line: str | None
    category: str
    notes: ProductNotes
    selling_points: list[SellingPointPublic]
    restricted_claims: list[str]
    status: str


class ProductsPublic(SQLModel):
    items: list[ProductPublic]
    total: int
    page: int
    page_size: int


Words = list[str]


class VoiceProfileCreate(SQLModel):
    persona: str = Field(min_length=1, max_length=2000)
    tone_keywords: Words = Field(default_factory=list, max_length=30)
    preferred_words: Words = Field(default_factory=list, max_length=100)
    forbidden_words: Words = Field(default_factory=list, max_length=100)
    sample_refs: Words = Field(default_factory=list, max_length=30)


class VoiceProfilePublic(SQLModel):
    brand_id: uuid.UUID
    version: int
    persona: str
    tone_keywords: Words
    preferred_words: Words
    forbidden_words: Words
    sample_refs: Words
    is_active: bool
    created_at: datetime | None


class VoiceProfilesPublic(SQLModel):
    items: list[VoiceProfilePublic]
