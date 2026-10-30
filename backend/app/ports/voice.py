from dataclasses import dataclass
from typing import Protocol, runtime_checkable
from uuid import UUID


@dataclass(frozen=True)
class VoiceProfile:
    """The active brand voice profile (versioned)."""

    brand_id: UUID
    version: int
    persona: str
    tone_keywords: tuple[str, ...] = ()
    preferred_words: tuple[str, ...] = ()
    forbidden_words: tuple[str, ...] = ()
    sample_refs: tuple[str, ...] = ()


@runtime_checkable
class VoiceProfileProvider(Protocol):
    """Brand voice lookup, provided by member A."""

    def get_active(self, *, brand_id: UUID) -> VoiceProfile | None:
        """Return the active profile of the brand, or ``None`` if it has none."""
        ...
