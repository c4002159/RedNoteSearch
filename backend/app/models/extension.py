import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from pydantic import Field as PydanticField
from sqlalchemy import DateTime, Index
from sqlmodel import Field, SQLModel

from app.models.common import get_datetime_utc
from app.models.results import MAX_COUNT


class ExtensionKey(SQLModel, table=True):
    """A key for the browser extension of one brand. It can only add readings to notes of that brand;
    it reads nothing. Only a hash is stored, and the key itself is shown once, when it is made."""

    __tablename__ = "extension_key"  # type: ignore[assignment]
    __table_args__ = (Index("ix_extension_key_hash", "key_hash", unique=True),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    label: str = Field(max_length=60)
    # First characters of the key, to tell keys apart in a list.
    prefix: str = Field(max_length=12)
    key_hash: str = Field(max_length=64)
    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )
    last_used_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    revoked_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))


class ExtensionKeyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = PydanticField(min_length=1, max_length=60)

    @field_validator("label", mode="before")
    @classmethod
    def stripped(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ExtensionKeyPublic(SQLModel):
    id: uuid.UUID
    label: str
    prefix: str
    created_at: datetime | None
    last_used_at: datetime | None
    revoked_at: datetime | None


class ExtensionKeyCreated(ExtensionKeyPublic):
    # The whole key. It is returned this once and cannot be read again.
    key: str


class ExtensionKeysPublic(SQLModel):
    items: list[ExtensionKeyPublic]


class ExtensionMetric(BaseModel):
    """What the extension read from the page the person had open."""

    model_config = ConfigDict(extra="forbid")
    # The address of the note page; only the path is used, never stored.
    note_url: str = PydanticField(min_length=1, max_length=1000)
    likes: int = PydanticField(ge=0, le=MAX_COUNT)
    collects: int = PydanticField(ge=0, le=MAX_COUNT)
    comments: int = PydanticField(ge=0, le=MAX_COUNT)
    approximate: bool = False
    captured_at: datetime | None = None

    @model_validator(mode="after")
    def aware(self) -> ExtensionMetric:
        if self.captured_at is not None and self.captured_at.tzinfo is None:
            raise ValueError("captured_at needs a time zone")
        return self


class ExtensionRecorded(SQLModel):
    recorded: bool
    approximate: bool
