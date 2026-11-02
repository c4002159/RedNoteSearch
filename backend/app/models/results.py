import uuid
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from pydantic import Field as PydanticField
from sqlalchemy import CheckConstraint, DateTime, Index
from sqlmodel import Field, SQLModel

from app.models.common import get_datetime_utc

MAX_COUNT = 1_000_000_000
POST_HOSTS = ("xiaohongshu.com", "xhslink.com")


class ConfirmedCopy(SQLModel, table=True):
    """A note an operator confirmed (version reached ``ready_to_copy``), kept so its results can be
    recorded later. Text stays on the version; only labels that must outlive edits are copied here."""

    __tablename__ = "confirmed_copy"  # type: ignore[assignment]
    __table_args__ = (
        Index("ix_confirmed_copy_brand_confirmed", "brand_id", "confirmed_at"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    task_id: uuid.UUID | None = Field(
        default=None, foreign_key="task.id", ondelete="SET NULL"
    )
    version_id: uuid.UUID = Field(
        foreign_key="generation_version.id",
        nullable=False,
        unique=True,
        ondelete="CASCADE",
    )
    title: str = Field(default="", max_length=200)
    scenario_name: str = Field(default="", max_length=100)
    scene: str = Field(default="", max_length=20)
    promo_type: str = Field(default="product", max_length=20)
    promo_label: str = Field(default="", max_length=300)
    # Typed or pasted by a person; the system never opens it.
    post_url: str | None = Field(default=None, max_length=500)
    # The 24-character note id found in ``post_url``, to match readings from the browser extension.
    post_note_id: str | None = Field(default=None, max_length=24, index=True)
    published_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    confirmed_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    confirmed_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class PostMetric(SQLModel, table=True):
    """One reading of a post's numbers. Readings are only added, never changed, so a curve can be drawn."""

    __tablename__ = "post_metric"  # type: ignore[assignment]
    __table_args__ = (
        CheckConstraint(
            "source IN ('manual', 'extension', 'screenshot')",
            name="ck_post_metric_source",
        ),
        CheckConstraint(
            "likes >= 0 AND collects >= 0 AND comments >= 0",
            name="ck_post_metric_counts",
        ),
        Index("ix_post_metric_copy_captured", "copy_id", "captured_at"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    copy_id: uuid.UUID = Field(
        foreign_key="confirmed_copy.id", nullable=False, ondelete="CASCADE"
    )
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    captured_at: datetime = Field(sa_type=DateTime(timezone=True))
    likes: int = 0
    collects: int = 0
    comments: int = 0
    # The platform shows large counts as "1.8万"; such a reading is marked approximate.
    approximate: bool = False
    source: str = Field(default="manual", max_length=20)
    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


def clean_post_url(value: str) -> str:
    """A link to a Xiaohongshu post: https, a known host, no credentials, no spaces."""
    url = value.strip()
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    ok_host = any(host == h or host.endswith("." + h) for h in POST_HOSTS)
    if (
        parsed.scheme != "https"
        or not ok_host
        or parsed.username
        or parsed.password
        or any(c.isspace() for c in url)
    ):
        raise ValueError("Use the https link of a Xiaohongshu post")
    return url


class ConfirmedCopyUpdate(BaseModel):
    """Only the fields sent are changed; ``post_url`` or ``published_at`` as null clear them."""

    model_config = ConfigDict(extra="forbid")
    title: str | None = PydanticField(default=None, min_length=1, max_length=200)
    post_url: str | None = PydanticField(default=None, max_length=500)
    published_at: datetime | None = None

    @field_validator("title")
    @classmethod
    def stripped_title(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Title may not be blank")
        return value.strip() if value else value

    @field_validator("post_url")
    @classmethod
    def valid_url(cls, value: str | None) -> str | None:
        return clean_post_url(value) if value else None

    @model_validator(mode="after")
    def aware(self) -> ConfirmedCopyUpdate:
        if self.published_at is not None and self.published_at.tzinfo is None:
            raise ValueError("published_at needs a time zone")
        return self


class MetricCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    likes: int = PydanticField(ge=0, le=MAX_COUNT)
    collects: int = PydanticField(ge=0, le=MAX_COUNT)
    comments: int = PydanticField(ge=0, le=MAX_COUNT)
    approximate: bool = False
    source: Literal["manual", "extension", "screenshot"] = "manual"
    captured_at: datetime | None = None

    @model_validator(mode="after")
    def aware(self) -> MetricCreate:
        if self.captured_at is not None and self.captured_at.tzinfo is None:
            raise ValueError("captured_at needs a time zone")
        return self


class MetricPublic(SQLModel):
    id: uuid.UUID
    copy_id: uuid.UUID
    captured_at: datetime
    likes: int
    collects: int
    comments: int
    approximate: bool
    source: str
    created_at: datetime | None


class MetricsPublic(SQLModel):
    items: list[MetricPublic]


class ConfirmedCopyPublic(SQLModel):
    id: uuid.UUID
    brand_id: uuid.UUID
    task_id: uuid.UUID | None
    version_id: uuid.UUID
    title: str
    scenario_name: str
    scene: str
    promo_type: str
    promo_label: str
    post_url: str | None
    published_at: datetime | None
    confirmed_at: datetime | None
    # When numbers are due (three days after publishing) and whether they are still missing.
    metrics_due_at: datetime | None
    needs_metrics: bool
    latest_metric: MetricPublic | None


class ConfirmedCopiesPublic(SQLModel):
    items: list[ConfirmedCopyPublic]
    total: int
    page: int
    page_size: int


class UsageStat(SQLModel):
    scenario_name: str
    scene: str
    count: int


class HotStat(SQLModel):
    scenario_name: str
    scene: str
    note_count: int
    average_engagement: float
    # True when at least one reading in the group was an approximate figure such as "1.8万".
    approximate: bool


class HottestPublic(SQLModel):
    # False when fewer than ``min_notes`` notes have numbers; then ``items`` is empty ("not enough data").
    enough_data: bool
    min_notes: int
    notes_with_metrics: int
    items: list[HotStat]


class ResultsSummary(SQLModel):
    total_copies: int
    pending_count: int
    most_used: list[UsageStat]
    hottest: HottestPublic
