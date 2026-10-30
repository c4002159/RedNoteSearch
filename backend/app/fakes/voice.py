from uuid import UUID

from app.ports.voice import VoiceProfile


class FakeVoiceProfileProvider:
    """In-memory ``VoiceProfileProvider``."""

    def __init__(self) -> None:
        self._profiles: dict[UUID, VoiceProfile] = {}

    def set_active(self, profile: VoiceProfile) -> None:
        self._profiles[profile.brand_id] = profile

    def get_active(self, *, brand_id: UUID) -> VoiceProfile | None:
        return self._profiles.get(brand_id)
