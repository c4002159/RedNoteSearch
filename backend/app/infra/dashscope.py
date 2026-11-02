import httpx

from app.core.config import settings
from app.models.knowledge import EMBEDDING_DIMENSIONS
from app.services import provider_keys
from app.services.errors import ModelUnavailableError

# text-embedding-v4 accepts at most 10 inputs per request.
BATCH_SIZE = 10


class DashScopeEmbeddingProvider:
    """``EmbeddingProvider`` for Alibaba Bailian text-embedding-v4 (OpenAI-compatible endpoint).

    ``dimensions`` is always sent explicitly so writes and queries agree on 1024 (ADR-006).
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self._api_key = (
            api_key if api_key is not None else provider_keys.resolve_key("dashscope")
        )
        self._base_url = (base_url or settings.EMBEDDING_BASE_URL).rstrip("/")
        self._model = model or settings.EMBEDDING_MODEL
        self._client = client or httpx.Client(timeout=30.0)

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not self._api_key:
            raise ModelUnavailableError("Embedding model is not configured")
        vectors: list[list[float]] = []
        for start in range(0, len(texts), BATCH_SIZE):
            vectors.extend(self._embed_batch(texts[start : start + BATCH_SIZE]))
        return vectors

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        try:
            response = self._client.post(
                f"{self._base_url}/embeddings",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={
                    "model": self._model,
                    "input": batch,
                    "dimensions": EMBEDDING_DIMENSIONS,
                    "encoding_format": "float",
                },
            )
            response.raise_for_status()
            data = sorted(response.json()["data"], key=lambda item: item["index"])
            vectors = [list(map(float, item["embedding"])) for item in data]
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            # Never include the response body or headers: they may echo credentials.
            raise ModelUnavailableError("Embedding model request failed") from exc
        if len(vectors) != len(batch) or any(
            len(v) != EMBEDDING_DIMENSIONS for v in vectors
        ):
            raise ModelUnavailableError("Embedding model returned unexpected vectors")
        return vectors
