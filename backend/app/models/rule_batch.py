import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RuleBatchState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    enabled: bool = Field(strict=True)
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("ids")
    @classmethod
    def distinct_ids(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(value) != len(set(value)):
            raise ValueError("规则不能重复选择")
        return value

    @field_validator("reason")
    @classmethod
    def nonblank_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("请输入操作原因")
        return value


class RuleBatchItem(BaseModel):
    id: uuid.UUID
    success: bool
    changed: bool = False
    rule_version: int | None = None
    status_code: int = 200
    error_code: str | None = None
    message: str | None = None


class RuleBatchResult(BaseModel):
    items: list[RuleBatchItem]
