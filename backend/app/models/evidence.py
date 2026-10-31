import enum
import uuid
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import CheckConstraint, DateTime, Index, Text
from sqlmodel import Field, SQLModel

from app.domain.evidence.judge import EvidenceStatus
from app.models.catalog import _in_list
from app.models.common import get_datetime_utc


class SourceLevel(enum.StrEnum):
    APPROVED_KB = "approved_kb"
    TASK_MATERIAL = "task_material"


class ClaimEvidence(SQLModel, table=True):
    """One factual claim found in a version and what the sources say about it.

    ``status`` is the system's judgement and is never rewritten; a person's decision is stored apart in
    ``human_confirmed`` (contract section 5).
    """

    __tablename__ = "claim_evidence"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(
            _in_list("status", EvidenceStatus), name="ck_claim_evidence_status"
        ),
        CheckConstraint(
            _in_list("source_level", SourceLevel), name="ck_claim_evidence_source_level"
        ),
        Index("ix_claim_evidence_version_id", "version_id"),
        Index("ix_claim_evidence_brand_id", "brand_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    version_id: uuid.UUID = Field(
        foreign_key="generation_version.id", nullable=False, ondelete="CASCADE"
    )
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    claim_text: str = Field(sa_type=Text)
    status: str = Field(max_length=30)
    # The source the judgement points at; empty when nothing was found.
    source_level: str | None = Field(default=None, max_length=20)
    document_id: uuid.UUID | None = None
    document_version: int | None = None
    chunk_id: uuid.UUID | None = None
    snapshot_id: uuid.UUID | None = None
    quote: str | None = Field(default=None, sa_type=Text)
    rationale: str = Field(default="", sa_type=Text)
    prompt_version: str | None = Field(default=None, max_length=30)
    human_confirmed: bool | None = None
    confirm_note: str | None = Field(default=None, max_length=500)
    confirmed_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    confirmed_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# ---- API schemas (not tables) ----
class ClaimEvidencePublic(SQLModel):
    id: uuid.UUID
    version_id: uuid.UUID
    claim_text: str
    status: str
    source_level: str | None
    document_id: uuid.UUID | None
    document_version: int | None
    chunk_id: uuid.UUID | None
    snapshot_id: uuid.UUID | None
    quote: str | None
    rationale: str
    human_confirmed: bool | None
    confirm_note: str | None
    confirmed_at: datetime | None


class ClaimEvidenceListPublic(SQLModel):
    items: list[ClaimEvidencePublic]


class ConfirmEvidence(BaseModel):
    human_confirmed: bool
    note: str | None = Field(default=None, max_length=500)
