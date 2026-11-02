"""Chat client for providers with an OpenAI-compatible ``/chat/completions`` endpoint.

DeepSeek, Alibaba Bailian (Qwen) and OpenAI all speak this protocol, so one thin client covers the three
providers of ADR-006. It retries transient failures a bounded number of times, records every attempt,
computes cost from a configured price (never hard-coded) and never puts keys, headers or response bodies
into errors or records.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx

from app.core.config import settings
from app.ports.llm import (
    LlmCallRecord,
    LlmCallRecorder,
    LlmRequest,
    LlmResponse,
    LlmUsage,
)
from app.services import provider_keys
from app.services.errors import ModelUnavailableError

# Statuses worth retrying; everything else (401, 403, 400, 404...) is a configuration or request error.
RETRYABLE_STATUSES = frozenset({408, 409, 425, 429, 500, 502, 503, 504})
BACKOFF_SECONDS = 1.0


@dataclass(frozen=True)
class Price:
    """Price per million tokens, with a version so old records stay explainable (ADR-006)."""

    version: str
    input_per_million: Decimal
    output_per_million: Decimal

    def cost(self, usage: LlmUsage) -> Decimal:
        million = Decimal(1_000_000)
        return (
            Decimal(usage.prompt_tokens) * self.input_per_million
            + Decimal(usage.completion_tokens) * self.output_per_million
        ) / million


class OpenAICompatibleClient:
    def __init__(
        self,
        *,
        provider: str,
        model: str,
        base_url: str,
        api_key: str | None,
        price: Price | None = None,
        recorder: LlmCallRecorder | None = None,
        max_retries: int | None = None,
        timeout: float | None = None,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.provider = provider
        self.model = model
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._price = price
        self._recorder = recorder
        self._max_retries = (
            settings.LLM_MAX_RETRIES if max_retries is None else max_retries
        )
        self._client = client or httpx.Client(
            timeout=timeout or settings.LLM_TIMEOUT_SECONDS
        )
        self._sleep = sleep

    def complete(self, request: LlmRequest) -> LlmResponse:
        if not self._api_key:
            self._record(request, "error", 0, error="not_configured", attempt=1)
            raise ModelUnavailableError("The language model is not configured")
        last_error = "unknown"
        for attempt in range(1, self._max_retries + 2):
            started = time.monotonic()
            try:
                response = self._client.post(
                    f"{self._base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json=self._payload(request),
                )
            except httpx.TimeoutException:
                last_error, retryable = "timeout", True
            except httpx.HTTPError:
                last_error, retryable = "network_error", True
            else:
                latency = int((time.monotonic() - started) * 1000)
                if response.status_code < 400:
                    return self._success(request, response, latency, attempt)
                last_error = f"http_{response.status_code}"
                retryable = response.status_code in RETRYABLE_STATUSES
            latency = int((time.monotonic() - started) * 1000)
            self._record(request, "error", latency, error=last_error, attempt=attempt)
            if not retryable or attempt > self._max_retries:
                break
            self._sleep(BACKOFF_SECONDS * 2 ** (attempt - 1))
        raise ModelUnavailableError(f"The language model call failed ({last_error})")

    def _payload(self, request: LlmRequest) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": m.role, "content": m.content} for m in request.messages
            ],
            "temperature": request.temperature,
        }
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens
        if request.json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    def _success(
        self,
        request: LlmRequest,
        response: httpx.Response,
        latency: int,
        attempt: int,
    ) -> LlmResponse:
        try:
            body = response.json()
            text = body["choices"][0]["message"]["content"]
            usage_body = body.get("usage") or {}
            usage = LlmUsage(
                prompt_tokens=int(usage_body.get("prompt_tokens", 0)),
                completion_tokens=int(usage_body.get("completion_tokens", 0)),
            )
            if not isinstance(text, str) or not text.strip():
                raise ValueError("empty completion")
        except (KeyError, IndexError, ValueError, TypeError) as exc:
            self._record(
                request, "error", latency, error="bad_response", attempt=attempt
            )
            raise ModelUnavailableError(
                "The language model returned an unusable answer"
            ) from exc
        cost = self._price.cost(usage) if self._price else None
        version = self._price.version if self._price else None
        self._record(
            request,
            "ok",
            latency,
            usage=usage,
            cost=cost,
            version=version,
            attempt=attempt,
        )
        return LlmResponse(
            text=text,
            provider=self.provider,
            model=self.model,
            usage=usage,
            latency_ms=latency,
            cost=cost,
            price_version=version,
        )

    def _record(
        self,
        request: LlmRequest,
        status: str,
        latency: int,
        *,
        usage: LlmUsage | None = None,
        cost: Decimal | None = None,
        version: str | None = None,
        error: str = "",
        attempt: int = 1,
    ) -> None:
        if self._recorder is None:
            return
        self._recorder.record(
            LlmCallRecord(
                provider=self.provider,
                model=self.model,
                purpose=request.purpose,
                status="ok" if status == "ok" else "error",
                latency_ms=latency,
                usage=usage or LlmUsage(),
                cost=cost,
                price_version=version,
                error=error,
                attempt=attempt,
            )
        )


def deepseek_client(
    *,
    price: Price | None = None,
    recorder: LlmCallRecorder | None = None,
    model: str | None = None,
) -> OpenAICompatibleClient:
    """DeepSeek with the model and key from the settings (``deepseek-flash`` by default)."""
    return OpenAICompatibleClient(
        provider="deepseek",
        model=model or settings.DEEPSEEK_MODEL,
        base_url=settings.DEEPSEEK_BASE_URL,
        api_key=provider_keys.resolve_key("deepseek"),
        price=price,
        recorder=recorder,
    )
