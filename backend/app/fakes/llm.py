from collections.abc import Callable
from decimal import Decimal

from app.ports.llm import (
    LlmCallRecord,
    LlmRequest,
    LlmResponse,
    LlmUsage,
)


class ListCallRecorder:
    """In-memory ``LlmCallRecorder`` that keeps every record."""

    def __init__(self) -> None:
        self.records: list[LlmCallRecord] = []

    def record(self, call: LlmCallRecord) -> None:
        self.records.append(call)


class FakeLlmClient:
    """Scripted ``LlmClient``: returns the given answers in order, or raises the given exceptions.

    The last script entry repeats when the script runs out, so a test can say "always answer X".
    Every request is kept in ``requests``. With ``responder`` the answer is chosen from the request
    itself (for example by its ``purpose``) instead of by call order.
    """

    def __init__(
        self,
        script: list[str | Exception] | None = None,
        *,
        provider: str = "fake",
        model: str = "fake-model",
        responder: Callable[[LlmRequest], str | Exception] | None = None,
    ) -> None:
        self._script: list[str | Exception] = script or ["{}"]
        self._responder = responder
        self.provider = provider
        self.model = model
        self.requests: list[LlmRequest] = []

    def complete(self, request: LlmRequest) -> LlmResponse:
        index = min(len(self.requests), len(self._script) - 1)
        self.requests.append(request)
        item = self._responder(request) if self._responder else self._script[index]
        if isinstance(item, Exception):
            raise item
        return LlmResponse(
            text=item,
            provider=self.provider,
            model=self.model,
            usage=LlmUsage(prompt_tokens=10, completion_tokens=5),
            latency_ms=1,
            cost=Decimal("0.0001"),
            price_version="fake",
        )
