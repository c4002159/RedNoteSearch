import enum
import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, Column, DateTime, Index, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.catalog import _in_list
from app.models.common import get_datetime_utc

# text-embedding-v4 at 1024 dimensions (ADR-006). Changing it means rebuilding every embedding.
EMBEDDING_DIMENSIONS = 1024


class DocumentType(enum.StrEnum):
    BRAND_STORY = "brand_story"
    PRODUCT_SPEC = "product_spec"
    INGREDIENT = "ingredient"
    AWARD_CLAIM = "award_claim"
    COMPLIANCE_POLICY = "compliance_policy"
    SAMPLE_NOTE = "sample_note"


class DocumentStatus(enum.StrEnum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    DEACTIVATED = "deactivated"


class IndexStatus(enum.StrEnum):
    PENDING = "pending"
    READY = "ready"
    FAILED = "failed"


class ReviewAction(enum.StrEnum):
    SUBMIT = "submit"
    APPROVE = "approve"
    REJECT = "reject"
    DEACTIVATE = "deactivate"


# One row per document VERSION. ``group_id`` identifies the logical document across versions;
# ``is_current`` marks the version that retrieval may use (only approved and current rows are searchable).
class KbDocument(SQLModel, table=True):
    __tablename__ = "kb_document"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint("group_id", "version", name="uq_kb_document_group_version"),
        CheckConstraint(_in_list("doc_type", DocumentType), name="ck_kb_document_type"),
        CheckConstraint(
            _in_list("status", DocumentStatus), name="ck_kb_document_status"
        ),
        CheckConstraint(
            _in_list("index_status", IndexStatus), name="ck_kb_document_index_status"
        ),
        Index("ix_kb_document_brand_status", "brand_id", "status"),
        Index("ix_kb_document_group_current", "group_id", "is_current"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    group_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    title: str = Field(max_length=200)
    doc_type: str = Field(max_length=30)
    status: str = Field(default=DocumentStatus.PENDING_REVIEW.value, max_length=20)
    version: int = Field(default=1)
    is_current: bool = Field(default=False)
    supersedes_id: uuid.UUID | None = Field(
        default=None, foreign_key="kb_document.id", ondelete="SET NULL"
    )
    source_filename: str | None = Field(default=None, max_length=300)
    checksum: str | None = Field(default=None, max_length=64)
    index_status: str = Field(default=IndexStatus.PENDING.value, max_length=20)
    submitted_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# Append-only review history of a document version: rows are inserted, never updated or deleted by the app.
class KbReview(SQLModel, table=True):
    __tablename__ = "kb_review"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(_in_list("action", ReviewAction), name="ck_kb_review_action"),
        Index("ix_kb_review_document_id", "document_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(
        foreign_key="kb_document.id", nullable=False, ondelete="CASCADE"
    )
    action: str = Field(max_length=20)
    actor_id: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    reason: str | None = Field(default=None, max_length=500)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# Retrievable text pieces. ``brand_id`` is repeated here so every search can filter by brand directly.
# A full-text (tsvector) column is deliberately not added yet: Chinese needs word segmentation first,
# and hybrid retrieval is a progressive item (see ADR-010).
class KbChunk(SQLModel, table=True):
    __tablename__ = "kb_chunk"  # type: ignore[assignment]
    __table_args__ = (
        Index("ix_kb_chunk_brand_id", "brand_id"),
        Index("ix_kb_chunk_document_id", "document_id"),
        Index(
            "ix_kb_chunk_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    document_id: uuid.UUID = Field(
        foreign_key="kb_document.id", nullable=False, ondelete="CASCADE"
    )
    chunk_index: int
    content: str = Field(sa_type=Text)
    embedding: list[float] | None = Field(
        default=None, sa_column=Column(Vector(EMBEDDING_DIMENSIONS))
    )
    # Named ``meta`` because ``metadata`` is reserved by SQLAlchemy's declarative base.
    meta: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="{}"),
    )
    token_count: int | None = Field(default=None)
