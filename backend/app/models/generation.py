import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic import Field as PydanticField
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

from app.domain.flow import FlowStatus
from app.models.catalog import _in_list
from app.models.common import get_datetime_utc
from app.models.evidence import ClaimEvidencePublic


class Scene(enum.StrEnum):
    SEEDING = "seeding"
    REVIEW = "review"
    TUTORIAL = "tutorial"
    LAUNCH = "launch"
    PROMOTION = "promotion"
    STORY = "story"


class VersionOrigin(enum.StrEnum):
    GENERATED = "generated"
    EDITED = "edited"
    REWRITTEN = "rewritten"


class ScenarioTemplate(SQLModel, table=True):
    """A note structure for one scene. ``brand_id`` is empty for global templates."""

    __tablename__ = "scenario_template"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(_in_list("scene", Scene), name="ck_scenario_template_scene"),
        Index("ix_scenario_template_brand_id", "brand_id"),
        UniqueConstraint(
            "brand_id", "scene", "name", "template_version", name="uq_scenario_template"
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID | None = Field(
        default=None, foreign_key="brand.id", ondelete="CASCADE"
    )
    scene: str = Field(max_length=20)
    name: str = Field(max_length=100)
    structure: str = Field(sa_type=Text)
    template_version: int = Field(default=1)
    enabled: bool = Field(default=True)
    # The viral structure this template was made from (set by "convert to template"); null otherwise.
    source_pattern_id: uuid.UUID | None = Field(
        default=None, foreign_key="viral_pattern.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class StylePreset(SQLModel, table=True):
    __tablename__ = "style_preset"  # type: ignore[assignment]
    __table_args__ = (Index("ix_style_preset_brand_id", "brand_id"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    name: str = Field(max_length=100)
    params: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class Task(SQLModel, table=True):
    """One generation job: the inputs the operator chose. Its material snapshots live in ``task_input``."""

    __tablename__ = "task"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(
            _in_list("flow_status", FlowStatus), name="ck_task_flow_status"
        ),
        Index("ix_task_brand_created", "brand_id", "created_at"),
        Index("ix_task_brand_status", "brand_id", "flow_status"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    # No ON DELETE rule: a product that has tasks is archived, never deleted (contract section 3).
    product_id: uuid.UUID = Field(foreign_key="product.id", nullable=False)
    scenario_id: uuid.UUID = Field(foreign_key="scenario_template.id", nullable=False)
    style: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    brief: str = Field(default="", sa_type=Text)
    required_terms: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    flow_status: str = Field(default=FlowStatus.QUEUED.value, max_length=30)
    progress_stage: str | None = Field(default=None, max_length=30)
    # Not a foreign key: tasks and versions reference each other.
    latest_version_id: uuid.UUID | None = None
    # Short, secret-free reason why the last run did not finish, e.g. ``model_unavailable``.
    last_error: str | None = Field(default=None, max_length=60)
    idempotency_key: str | None = Field(default=None, max_length=100)
    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class GenerationVersion(SQLModel, table=True):
    """One version of a note. Edits and rewrites create a new row; old versions are never changed
    (apart from their review state)."""

    __tablename__ = "generation_version"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint("task_id", "version_no", name="uq_generation_version_no"),
        CheckConstraint(
            _in_list("flow_status", FlowStatus), name="ck_generation_version_status"
        ),
        CheckConstraint(
            _in_list("origin", VersionOrigin), name="ck_generation_version_origin"
        ),
        Index("ix_generation_version_task_id", "task_id"),
        Index("ix_generation_version_brand_id", "brand_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    task_id: uuid.UUID = Field(
        foreign_key="task.id", nullable=False, ondelete="CASCADE"
    )
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    version_no: int
    parent_version_id: uuid.UUID | None = Field(
        default=None, foreign_key="generation_version.id", ondelete="SET NULL"
    )
    origin: str = Field(default=VersionOrigin.GENERATED.value, max_length=20)
    flow_status: str = Field(default=FlowStatus.GENERATING.value, max_length=30)
    title_candidates: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    body: str = Field(default="", sa_type=Text)
    hashtags: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    cover_candidates: list[str] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    constraint_checks: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False)
    )
    # What was retrieved for this version (source level, document id and version, chunk id, hash), kept as
    # a snapshot so later changes to the knowledge base do not rewrite history.
    retrieved_sources: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSONB, nullable=False)
    )
    template_version: int | None = None
    prompt_version: str | None = Field(default=None, max_length=50)
    voice_version: int | None = None
    checker_version: str | None = Field(default=None, max_length=50)
    model: str | None = Field(default=None, max_length=100)
    selected_title_index: int | None = None
    selected_cover_index: int | None = None
    confirmed_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    confirmed_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class LlmCallLog(SQLModel, table=True):
    """Every model call, successful or not (TC-030)."""

    __tablename__ = "llm_call_log"  # type: ignore[assignment]
    __table_args__ = (
        Index("ix_llm_call_log_brand_created", "brand_id", "created_at"),
        Index("ix_llm_call_log_task_id", "task_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID | None = Field(
        default=None, foreign_key="brand.id", ondelete="SET NULL"
    )
    task_id: uuid.UUID | None = Field(
        default=None, foreign_key="task.id", ondelete="SET NULL"
    )
    provider: str = Field(max_length=30)
    model: str = Field(max_length=100)
    purpose: str = Field(default="", max_length=50)
    status: str = Field(max_length=10)
    latency_ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost: Decimal | None = Field(default=None, sa_column=Column(Numeric(14, 6)))
    price_version: str | None = Field(default=None, max_length=30)
    error: str = Field(default="", max_length=60)
    attempt: int = 1
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# ---- API schemas (not tables) ----
class StyleParams(BaseModel):
    tone: str | None = None
    length: Literal["short", "medium", "long"] = "medium"
    person: Literal["first", "second", "third"] = "first"
    emoji_density: Literal["low", "medium", "high"] = "low"
    hashtag_count: int = Field(default=5, ge=0, le=10)


class ScenarioPublic(SQLModel):
    id: uuid.UUID
    scene: str
    name: str
    structure: str
    template_version: int
    brand_id: uuid.UUID | None
    enabled: bool = True
    source_pattern_id: uuid.UUID | None = None
    # Name of the viral structure it came from (its hook type), for display only.
    source_pattern_title: str | None = None


class ScenariosPublic(SQLModel):
    items: list[ScenarioPublic]


class ScenarioCreate(BaseModel):
    """A new brand template, or the next version when the scene and name already exist."""

    model_config = ConfigDict(extra="forbid")
    scene: Scene
    name: str = PydanticField(min_length=1, max_length=100)
    structure: str = PydanticField(min_length=1, max_length=2000)

    @field_validator("name", "structure", mode="before")
    @classmethod
    def stripped(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


class ScenarioUpdate(SQLModel):
    enabled: bool


class StylePresetCreate(SQLModel):
    name: str = Field(min_length=1, max_length=100)
    params: StyleParams = Field(default_factory=StyleParams)


class StylePresetPublic(SQLModel):
    id: uuid.UUID
    brand_id: uuid.UUID
    name: str
    params: StyleParams


class StylePresetsPublic(SQLModel):
    items: list[StylePresetPublic]


class TaskMaterial(BaseModel):
    filename: str = Field(min_length=1, max_length=300)
    text: str = Field(min_length=1, max_length=50_000)


class TaskCreate(SQLModel):
    brand_id: uuid.UUID
    product_id: uuid.UUID
    scenario_id: uuid.UUID
    style: StyleParams = Field(default_factory=StyleParams)
    brief: str = Field(default="", max_length=2000)
    required_terms: list[str] = Field(default_factory=list, max_length=20)
    task_materials: list[TaskMaterial] = Field(default_factory=list, max_length=5)


class TaskCreated(SQLModel):
    id: uuid.UUID
    status: str
    brand_id: uuid.UUID
    created_at: datetime | None


class TaskPublic(SQLModel):
    id: uuid.UUID
    brand_id: uuid.UUID
    product_id: uuid.UUID
    scenario_id: uuid.UUID
    product_name: str = ""
    scenario_name: str = ""
    scenario_version: int = 0
    scene: str = ""
    style: StyleParams
    brief: str
    required_terms: list[str]
    flow_status: str
    progress: dict[str, Any]
    latest_version_id: uuid.UUID | None
    last_error: str | None
    created_at: datetime | None


class TasksPublic(SQLModel):
    items: list[TaskPublic]
    total: int
    page: int
    page_size: int


class GenerationVersionPublic(SQLModel):
    id: uuid.UUID
    task_id: uuid.UUID
    version_no: int
    parent_version_id: uuid.UUID | None
    origin: str
    flow_status: str
    title_candidates: list[str]
    body: str
    hashtags: list[str]
    cover_candidates: list[str]
    constraint_checks: dict[str, Any]
    retrieved_sources: list[dict[str, Any]]
    template_version: int | None
    prompt_version: str | None
    voice_version: int | None
    checker_version: str | None
    model: str | None
    selected_title_index: int | None
    selected_cover_index: int | None
    confirmed_at: datetime | None
    created_at: datetime | None
    claim_evidence: list[ClaimEvidencePublic] = Field(default_factory=list)
    evidence_summary: EvidenceSummaryPublic | None = None


class GenerationVersionsPublic(SQLModel):
    items: list[GenerationVersionPublic]


class RewriteRequest(SQLModel):
    target: Literal["titles", "opening", "body", "cover"]
    instruction: str = Field(default="", max_length=500)


class ConfirmVersion(SQLModel):
    selected_title_index: int = Field(ge=0)
    selected_cover_index: int | None = Field(default=None, ge=0)


class EvidenceSummaryPublic(BaseModel):
    total: int
    system_supported: int
    # Claims the system could not support that a person vouched for: always label them as such.
    human_confirmed: int
    unconfirmed: int
    rejected: int


class ExportVerification(BaseModel):
    system_supported: int
    human_confirmed: int


class ExportCounts(BaseModel):
    title_weight: float
    body_units: int
    tags_visible_units: int
    tags_count: int


class XhsPartsExport(BaseModel):
    format: Literal["xhs_parts"] = "xhs_parts"
    title: str
    body: str
    tags: list[str]
    counts: ExportCounts
    verification: ExportVerification


class MarkdownExport(BaseModel):
    format: Literal["markdown"] = "markdown"
    content: str
