from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal, Protocol, runtime_checkable

Role = Literal["system", "user", "assistant"]
CallStatus = Literal["ok", "error"]


@dataclass(frozen=True)
class LlmMessage:
    role: Role
    content: str


@dataclass(frozen=True)
class LlmRequest:
    messages: tuple[LlmMessage, ...]
    temperature: float = 0.7
    max_tokens: int | None = None
    # Ask the provider for a JSON object (``response_format = json_object``).
    json_mode: bool = False
    # Free-form label stored with the call record, e.g. ``generate`` or ``claim_extraction``.
    purpose: str = ""


@dataclass(frozen=True)
class LlmUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass(frozen=True)
class LlmResponse:
    text: str
    provider: str
    model: str
    usage: LlmUsage
    latency_ms: int
    cost: Decimal | None = None
    price_version: str | None = None


@dataclass(frozen=True)
class LlmCallRecord:
    """One model call, successful or not, for cost and latency tracking (TC-030)."""

    provider: str
    model: str
    purpose: str
    status: CallStatus
    latency_ms: int
    usage: LlmUsage = field(default_factory=LlmUsage)
    cost: Decimal | None = None
    price_version: str | None = None
    # Short, secret-free reason such as ``timeout`` or ``http_429``; empty on success.
    error: str = ""
    attempt: int = 1


@runtime_checkable
class LlmCallRecorder(Protocol):
    """Receives one record per attempt. The database implementation writes ``llm_call_log``."""

    def record(self, call: LlmCallRecord) -> None: ...


@runtime_checkable
class LlmClient(Protocol):
    """A chat model. Implementations raise ``ModelUnavailableError`` when the call cannot be completed
    (timeout, rate limit, server error, missing key) after their bounded retries."""

    def complete(self, request: LlmRequest) -> LlmResponse: ...
