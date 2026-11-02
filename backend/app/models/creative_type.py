import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic import Field as PydanticField
from sqlalchemy import DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.common import get_datetime_utc

MAX_CUSTOM_TYPES = 20


class CreativeType(SQLModel, table=True):
    """A brand's own kind of note (for example "探店"), next to the six built-in ones. A template's
    ``scene`` holds the ``key``; renaming a type changes ``name`` only."""

    __tablename__ = "creative_type"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint("brand_id", "key", name="uq_creative_type_key"),
        UniqueConstraint("brand_id", "name", name="uq_creative_type_name"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    key: str = Field(max_length=20)
    name: str = Field(max_length=20)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class CreativeTypeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = PydanticField(min_length=1, max_length=20)

    @field_validator("name", mode="before")
    @classmethod
    def stripped(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class CreativeTypePublic(SQLModel):
    key: str
    name: str
    builtin: bool
    # How many template versions of the brand use this type (global templates count for built-ins).
    template_count: int


class CreativeTypesPublic(SQLModel):
    items: list[CreativeTypePublic]
