"""Cross-module ports (interfaces) shared by the two feature slices.

Member A provides the real implementations (knowledge search, task input snapshots, voice profiles);
member B consumes them. Both sides develop against these Protocols and the in-memory fakes in
``app.fakes`` until the real implementations land. Changing a port is a contract change: open a PR
that both members review.
"""

from app.ports.knowledge import KnowledgeChunk, KnowledgeSearch, SourceLevel
from app.ports.task_input import TaskInputRepository, TaskInputSnapshot, content_hash
from app.ports.voice import VoiceProfile, VoiceProfileProvider

__all__ = [
    "KnowledgeChunk",
    "KnowledgeSearch",
    "SourceLevel",
    "TaskInputRepository",
    "TaskInputSnapshot",
    "VoiceProfile",
    "VoiceProfileProvider",
    "content_hash",
]
