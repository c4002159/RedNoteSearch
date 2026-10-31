import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import CheckConstraint, Column, DateTime, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.domain.compliance.engine import Layer, RuleType, Severity
from app.models.catalog import _in_list
from app.models.common import get_datetime_utc


class ComplianceRule(SQLModel, table=True):
    """A risk-hint rule. ``brand_id`` is empty for global rules. Every edit raises ``rule_version``, and
    each hit stores the version it was produced by."""

    __tablename__ = "compliance_rule"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(_in_list("layer", Layer), name="ck_compliance_rule_layer"),
        CheckConstraint(
            _in_list("rule_type", RuleType), name="ck_compliance_rule_type"
        ),
        CheckConstraint(
            _in_list("severity", Severity), name="ck_compliance_rule_severity"
        ),
        Index("ix_compliance_rule_brand_id", "brand_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID | None = Field(
        default=None, foreign_key="brand.id", ondelete="CASCADE"
    )
    layer: str = Field(max_length=20)
    rule_type: str = Field(max_length=20)
    pattern: str = Field(max_length=200)
    is_regex: bool = Field(default=False)
    severity: str = Field(max_length=10)
    suggestion: str = Field(default="", max_length=500)
    source_name: str = Field(default="", max_length=200)
    source_url: str | None = Field(default=None, max_length=500)
    source_clause: str | None = Field(default=None, max_length=300)
    region_scope: str | None = Field(default=None, max_length=50)
    effective_from: date | None = None
    effective_to: date | None = None
    rule_version: int = Field(default=1)
    enabled: bool = Field(default=True)
    # True for the starter rules shipped with the project: they have not been checked against a source.
    is_sample: bool = Field(default=False)
    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class ComplianceCheck(SQLModel, table=True):
    """One risk hint on one version: where, which rule (and its version), how severe, and whether a
    person has dealt with it. The rule's wording is copied so later edits do not rewrite history."""

    __tablename__ = "compliance_check"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(_in_list("layer", Layer), name="ck_compliance_check_layer"),
        CheckConstraint(
            _in_list("severity", Severity), name="ck_compliance_check_severity"
        ),
        Index("ix_compliance_check_version_id", "version_id"),
        Index("ix_compliance_check_brand_id", "brand_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    version_id: uuid.UUID = Field(
        foreign_key="generation_version.id", nullable=False, ondelete="CASCADE"
    )
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    # No foreign key: a rule may be deleted or changed later; the copied fields keep the history.
    rule_id: uuid.UUID | None = None
    rule_version: int | None = None
    layer: str = Field(max_length=20)
    rule_type: str | None = Field(default=None, max_length=20)
    severity: str = Field(max_length=10)
    field: str = Field(max_length=40)
    span_start: int
    span_end: int
    matched_text: str = Field(sa_type=Text)
    suggestion: str = Field(default="", sa_type=Text)
    source_name: str = Field(default="", max_length=200)
    source_clause: str | None = Field(default=None, max_length=300)
    region_scope: str | None = Field(default=None, max_length=50)
    basis: str | None = Field(default=None, max_length=10)
    detail: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="{}"),
    )
    resolved: bool = Field(default=False)
    resolved_note: str | None = Field(default=None, max_length=500)
    resolved_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    resolved_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# ---- API schemas (not tables) ----
class RuleCreate(SQLModel):
    layer: Layer
    rule_type: RuleType
    pattern: str = Field(min_length=1, max_length=200)
    is_regex: bool = False
    severity: Severity
    suggestion: str = Field(default="", max_length=500)
    source_name: str = Field(min_length=1, max_length=200)
    source_url: str | None = Field(default=None, max_length=500)
    source_clause: str | None = Field(default=None, max_length=300)
    region_scope: str | None = Field(default=None, max_length=50)
    effective_from: date | None = None
    effective_to: date | None = None
    enabled: bool = True


class RuleUpdate(SQLModel):
    layer: Layer | None = None
    rule_type: RuleType | None = None
    pattern: str | None = Field(default=None, min_length=1, max_length=200)
    is_regex: bool | None = None
    severity: Severity | None = None
    suggestion: str | None = Field(default=None, max_length=500)
    source_name: str | None = Field(default=None, min_length=1, max_length=200)
    source_url: str | None = Field(default=None, max_length=500)
    source_clause: str | None = Field(default=None, max_length=300)
    region_scope: str | None = Field(default=None, max_length=50)
    effective_from: date | None = None
    effective_to: date | None = None
    enabled: bool | None = None


class RulePublic(SQLModel):
    id: uuid.UUID
    brand_id: uuid.UUID | None
    layer: str
    rule_type: str
    pattern: str
    is_regex: bool
    severity: str
    suggestion: str
    source_name: str
    source_url: str | None
    source_clause: str | None
    region_scope: str | None
    effective_from: date | None
    effective_to: date | None
    rule_version: int
    enabled: bool
    is_sample: bool


class RulesPublic(SQLModel):
    items: list[RulePublic]
    total: int
    page: int
    page_size: int


class ComplianceCheckPublic(SQLModel):
    id: uuid.UUID
    version_id: uuid.UUID
    rule_id: uuid.UUID | None
    rule_version: int | None
    layer: str
    rule_type: str | None
    severity: str
    field: str
    span: list[int]
    matched_text: str
    suggestion: str
    source_name: str
    source_clause: str | None
    region_scope: str | None
    basis: str | None
    resolved: bool
    resolved_note: str | None


class ComplianceChecksPublic(SQLModel):
    items: list[ComplianceCheckPublic]
    unresolved_block: int


class ResolveCheck(SQLModel):
    note: str = Field(min_length=1, max_length=500)
