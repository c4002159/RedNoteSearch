import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, HttpUrl, TypeAdapter, field_validator
from pydantic import Field as PydanticField
from sqlalchemy import Column, DateTime, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.domain.viral import ViralAnalysis
from app.models.common import get_datetime_utc
from app.models.generation import Scene


class ViralSample(SQLModel, table=True):
    __tablename__ = "viral_sample"  # type: ignore[assignment]
    __table_args__ = (Index("ix_viral_sample_brand_created", "brand_id", "created_at"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(foreign_key="brand.id", ondelete="CASCADE")
    text: str = Field(sa_type=Text)
    note: str | None = Field(default=None, sa_type=Text)
    source_url: str | None = Field(default=None, max_length=2000)
    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class ViralPattern(SQLModel, table=True):
    __tablename__ = "viral_pattern"  # type: ignore[assignment]
    __table_args__ = (
        Index("ix_viral_pattern_sample_created", "sample_id", "created_at"),
    )
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    sample_id: uuid.UUID = Field(foreign_key="viral_sample.id", ondelete="CASCADE")
    brand_id: uuid.UUID = Field(foreign_key="brand.id", ondelete="CASCADE")
    title_pattern: str = Field(max_length=200)
    hook_type: str = Field(max_length=200)
    paragraph_structure: list[str] = Field(sa_column=Column(JSONB, nullable=False))
    tone: str = Field(max_length=200)
    emoji_usage: str = Field(max_length=200)
    hashtag_usage: str = Field(max_length=200)
    abstract_template: str = Field(sa_type=Text)
    model_id: str = Field(max_length=80)
    prompt_version: str = Field(max_length=50)
    checker_version: str = Field(max_length=50)
    created_at: datetime = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class ViralSampleCreate(BaseModel):
    text: str = PydanticField(min_length=1, max_length=5000)
    note: str | None = PydanticField(default=None, max_length=1000)
    source_url: str | None = PydanticField(default=None, max_length=2000)

    @field_validator("text")
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Sample text cannot be blank")
        return value

    @field_validator("source_url")
    @classmethod
    def text_url(cls, value: str | None) -> str | None:
        if value is not None:
            TypeAdapter(HttpUrl).validate_python(value)
        return value


class ViralSamplePublic(BaseModel):
    id: uuid.UUID
    brand_id: uuid.UUID
    text: str
    note: str | None
    source_url: str | None
    created_at: datetime


class ViralSampleListItem(BaseModel):
    id: uuid.UUID
    brand_id: uuid.UUID
    note: str | None
    source_url: str | None
    created_at: datetime
    char_count: int
    excerpt: str


class ViralSamplesPublic(BaseModel):
    items: list[ViralSampleListItem]
    total: int
    page: int
    page_size: int


class ViralPatternPublic(ViralAnalysis):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    sample_id: uuid.UUID
    brand_id: uuid.UUID
    model_id: str
    prompt_version: str
    checker_version: str
    created_at: datetime


class ViralPatternsPublic(BaseModel):
    items: list[ViralPatternPublic]
    total: int
    page: int
    page_size: int


class ViralAnalyzeRequest(BaseModel):
    model_id: str = PydanticField(min_length=1, max_length=80)


class ViralToTemplateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = PydanticField(min_length=1, max_length=100)
    scene: Scene

    @field_validator("name", mode="before")
    @classmethod
    def stripped_name(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Name must be text")
        return value.strip()
