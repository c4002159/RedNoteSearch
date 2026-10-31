import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Index,
    Numeric,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.catalog import _in_list
from app.models.common import get_datetime_utc


class EvalKind(enum.StrEnum):
    GENERATION = "generation"
    COMPLIANCE = "compliance"
    FACTCHECK = "factcheck"
    BRAND_LEAK = "brand_leak"


class RunStatus(enum.StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class EvalDataset(SQLModel, table=True):
    """One version of a test set. A version never changes: editing creates the next version of the same
    ``group_id`` so any past run can be reproduced."""

    __tablename__ = "eval_dataset"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint("group_id", "version", name="uq_eval_dataset_version"),
        CheckConstraint(_in_list("kind", EvalKind), name="ck_eval_dataset_kind"),
        Index("ix_eval_dataset_brand_id", "brand_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    group_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    version: int = Field(default=1)
    name: str = Field(max_length=100)
    kind: str = Field(max_length=20)
    brand_id: uuid.UUID | None = Field(
        default=None, foreign_key="brand.id", ondelete="CASCADE"
    )
    content_hash: str = Field(max_length=64)
    case_count: int = 0
    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class EvalCase(SQLModel, table=True):
    __tablename__ = "eval_case"  # type: ignore[assignment]
    __table_args__ = (Index("ix_eval_case_dataset_id", "dataset_id"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    dataset_id: uuid.UUID = Field(
        foreign_key="eval_dataset.id", nullable=False, ondelete="CASCADE"
    )
    case_index: int
    input: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    expected: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    annotators: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )


class EvalRun(SQLModel, table=True):
    __tablename__ = "eval_run"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(_in_list("status", RunStatus), name="ck_eval_run_status"),
        Index("ix_eval_run_dataset_id", "dataset_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    dataset_id: uuid.UUID = Field(
        foreign_key="eval_dataset.id", nullable=False, ondelete="CASCADE"
    )
    status: str = Field(default=RunStatus.QUEUED.value, max_length=20)
    model_ids: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    baselines: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    prompt_version: str | None = Field(default=None, max_length=50)
    checker_version: str | None = Field(default=None, max_length=50)
    rubric_version: str | None = Field(default=None, max_length=30)
    idempotency_key: str | None = Field(default=None, max_length=100)
    sample_count: int = 0
    metrics: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    error: str | None = Field(default=None, max_length=200)
    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )
    finished_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))


class EvalResult(SQLModel, table=True):
    """The outcome of one case under one system (a model, or a named baseline)."""

    __tablename__ = "eval_result"  # type: ignore[assignment]
    __table_args__ = (
        Index("ix_eval_result_run_id", "run_id"),
        Index("ix_eval_result_case_id", "case_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    run_id: uuid.UUID = Field(
        foreign_key="eval_run.id", nullable=False, ondelete="CASCADE"
    )
    case_id: uuid.UUID = Field(
        foreign_key="eval_case.id", nullable=False, ondelete="CASCADE"
    )
    system: str = Field(max_length=80)
    output: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    detail: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    passed: bool | None = None
    error: str | None = Field(default=None, max_length=200)
    latency_ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost: Decimal | None = Field(default=None, sa_column=Column(Numeric(14, 6)))


class EvalRating(SQLModel, table=True):
    """A person's scores for one result, per rubric dimension. One rating per rater and result."""

    __tablename__ = "eval_rating"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint("result_id", "rater_id", name="uq_eval_rating_rater"),
        Index("ix_eval_rating_run_id", "run_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    run_id: uuid.UUID = Field(
        foreign_key="eval_run.id", nullable=False, ondelete="CASCADE"
    )
    result_id: uuid.UUID = Field(
        foreign_key="eval_result.id", nullable=False, ondelete="CASCADE"
    )
    rater_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    scores: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    rubric_version: str = Field(max_length=30)
    note: str | None = Field(default=None, sa_type=Text)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# ---- API schemas (not tables) ----
class CaseIn(BaseModel):
    input: dict[str, Any]
    expected: dict[str, Any] = {}
    annotators: list[str] = []


class DatasetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: EvalKind
    brand_id: uuid.UUID | None = None
    cases: list[CaseIn] = Field(min_length=1, max_length=200)
    # Create the next version of an existing dataset instead of a new one.
    previous_version_id: uuid.UUID | None = None


class DatasetPublic(SQLModel):
    id: uuid.UUID
    group_id: uuid.UUID
    version: int
    name: str
    kind: str
    brand_id: uuid.UUID | None
    case_count: int
    content_hash: str
    created_at: datetime | None


class DatasetsPublic(SQLModel):
    items: list[DatasetPublic]


class CasePublic(SQLModel):
    id: uuid.UUID
    case_index: int
    input: dict[str, Any]
    expected: dict[str, Any]
    annotators: list[str]


class CasesPublic(SQLModel):
    items: list[CasePublic]
    total: int
    page: int
    page_size: int


class RunCreate(BaseModel):
    dataset_id: uuid.UUID
    model_ids: list[str] = Field(default_factory=list, max_length=5)
    prompt_version: str | None = Field(default=None, max_length=50)
    baselines: list[Literal["lexicon_only", "no_verification"]] = Field(
        default_factory=list
    )


class RunVersions(BaseModel):
    dataset_version: int
    prompt_version: str | None
    checker_version: str | None
    rubric_version: str | None
    models: list[str]
    baselines: list[str]


class RunPublic(BaseModel):
    id: uuid.UUID
    dataset_id: uuid.UUID
    kind: str
    status: str
    sample_count: int
    versions: RunVersions
    metrics: dict[str, Any]
    failures: list[dict[str, Any]]
    error: str | None
    created_at: datetime | None
    finished_at: datetime | None


class RunsPublic(BaseModel):
    items: list[RunPublic]
    total: int
    page: int
    page_size: int


class ResultPublic(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    case_index: int
    system: str
    output: dict[str, Any]
    detail: dict[str, Any]
    passed: bool | None
    error: str | None
    latency_ms: int
    cost: float | None


class ResultsPublic(BaseModel):
    items: list[ResultPublic]
    total: int
    page: int
    page_size: int


class RatingCreate(BaseModel):
    result_id: uuid.UUID
    scores: dict[str, int]
    rubric_version: str
    note: str | None = Field(default=None, max_length=1000)


class RatingPublic(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    result_id: uuid.UUID
    rater_id: uuid.UUID
    scores: dict[str, int]
    rubric_version: str
    note: str | None


class DimensionAgreementPublic(BaseModel):
    dimension: str
    rater_pairs: int
    samples: int
    exact_agreement: float | None
    within_one: float | None
    weighted_kappa: float | None


class AgreementPublic(BaseModel):
    run_id: uuid.UUID
    rubric_version: str | None
    raters: int
    rated_results: int
    method: str
    dimensions: list[DimensionAgreementPublic]


class ModelInfo(BaseModel):
    id: str
    provider: str
    model_name: str
    enabled: bool
    price_in_per_1k: float | None
    price_out_per_1k: float | None
    price_version: str | None


class ModelsPublic(BaseModel):
    items: list[ModelInfo]
