import hashlib
import math

from app.models.knowledge import EMBEDDING_DIMENSIONS


class FakeEmbeddingProvider:
    """Deterministic bag-of-character-bigrams embedding: texts sharing words get similar vectors.

    Good enough to test ranking and filtering without calling a model. ``fail`` makes it raise like an
    unreachable model.
    """

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[list[str]] = []

    def embed(self, texts: list[str]) -> list[list[float]]:
        from app.services.errors import ModelUnavailableError

        if self.fail:
            raise ModelUnavailableError("Embedding model is unavailable")
        self.calls.append(list(texts))
        return [self._vector(t) for t in texts]

    @staticmethod
    def _vector(text: str) -> list[float]:
        vector = [0.0] * EMBEDDING_DIMENSIONS
        grams = [text[i : i + 2] for i in range(max(len(text) - 1, 1))] or [""]
        for gram in grams:
            digest = hashlib.sha256(gram.encode("utf-8")).digest()
            vector[int.from_bytes(digest[:4], "big") % EMBEDDING_DIMENSIONS] += 1.0
        norm = math.sqrt(sum(v * v for v in vector)) or 1.0
        return [v / norm for v in vector]
