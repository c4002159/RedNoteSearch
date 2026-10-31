from typing import Protocol, runtime_checkable


@runtime_checkable
class EmbeddingProvider(Protocol):
    """Turns texts into embedding vectors (``EMBEDDING_DIMENSIONS`` long, ADR-006).

    Implementations raise ``app.services.errors.ModelUnavailableError`` when the model cannot be
    reached or answers with an error, so callers can mark indexing as failed instead of crashing.
    """

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one vector per text, in the same order."""
        ...
