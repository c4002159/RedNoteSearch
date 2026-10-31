"""What the model must return for a note (validated before anything is stored)."""

from pydantic import BaseModel, Field, field_validator


class GeneratedNote(BaseModel):
    title_candidates: list[str] = Field(min_length=1, max_length=8)
    body: str = Field(min_length=1)
    hashtags: list[str] = Field(default_factory=list, max_length=20)
    cover_candidates: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("title_candidates", "hashtags", "cover_candidates")
    @classmethod
    def _strip_and_drop_blanks(cls, values: list[str]) -> list[str]:
        return [v.strip() for v in values if isinstance(v, str) and v.strip()]

    @field_validator("body")
    @classmethod
    def _body_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("body must not be blank")
        return value.strip()
