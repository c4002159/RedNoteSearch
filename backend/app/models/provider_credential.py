import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel
from pydantic import Field as PydanticField
from sqlalchemy import Column, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.common import get_datetime_utc

Provider = Literal["deepseek", "dashscope"]


class ProviderCredential(SQLModel, table=True):
    """The API key and model list a platform administrator set in the web page for one provider.

    The key is stored encrypted (see ``app.services.provider_keys``) and is never returned; only the
    last characters are kept as ``key_hint``. A missing row or empty column means "use the server
    ``.env``".
    """

    __tablename__ = "provider_credential"  # type: ignore[assignment]

    provider: str = Field(primary_key=True, max_length=20)
    encrypted_key: str | None = Field(default=None, sa_column=Column(Text))
    key_hint: str | None = Field(default=None, max_length=8)
    models: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    updated_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


class ProviderUpdate(BaseModel):
    """Both fields are optional; a field left out is not changed."""

    api_key: str | None = PydanticField(default=None, min_length=8, max_length=300)
    models: list[str] | None = PydanticField(default=None, max_length=10)


class ProviderPublic(BaseModel):
    provider: Provider
    label: str
    key_source: Literal["database", "env", "none"]
    key_hint: str | None
    models: list[str]
    models_source: Literal["database", "env", "none"]
    updated_at: datetime | None


class ProvidersPublic(BaseModel):
    items: list[ProviderPublic]
