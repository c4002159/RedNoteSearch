"""One atomic revision request; all content is validated before a version is stored."""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.generation.schema import GeneratedNote


class RevisePart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: Literal["titles", "opening", "body", "cover", "hashtags"]
    instruction: str = Field(default="", max_length=500)


class ReviseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parts: list[RevisePart] = Field(default_factory=list, max_length=5)
    note: str = Field(default="", max_length=500)
    edited_note: GeneratedNote | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> Self:
        self.note = self.note.strip()
        if len({part.target for part in self.parts}) != len(self.parts):
            raise ValueError("Each target may appear only once")
        if not self.parts and self.edited_note is None and not self.note:
            raise ValueError("At least one change is required")
        if self.edited_note is not None and not self.edited_note.title_candidates:
            raise ValueError("At least one nonblank title is required")
        return self

    def model_parts(self) -> list[RevisePart]:
        """A standalone overall note requests a body rewrite; an edit alone needs no model."""
        return self.parts or ([RevisePart(target="body")] if self.note else [])
