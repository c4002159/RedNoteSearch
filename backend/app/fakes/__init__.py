"""In-memory fakes of the ports in ``app.ports``.

They let the two feature slices develop and test in parallel before the real implementations
exist. They follow the same rules as the ports (brand isolation, approved and current documents
only, task-scoped materials) so tests written against them keep their meaning later.
Do not import them from production code paths.
"""

from app.fakes.knowledge import FakeKnowledgeSearch
from app.fakes.task_input import FakeTaskInputRepository
from app.fakes.voice import FakeVoiceProfileProvider

__all__ = [
    "FakeKnowledgeSearch",
    "FakeTaskInputRepository",
    "FakeVoiceProfileProvider",
]
