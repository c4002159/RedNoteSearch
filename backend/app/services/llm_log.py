import uuid
from collections.abc import Callable

from sqlmodel import Session

from app.models import LlmCallLog
from app.ports.llm import LlmCallRecord


class DbLlmCallRecorder:
    """``LlmCallRecorder`` that writes ``llm_call_log`` in its own short transaction.

    It uses a separate session so a failing call that rolls back the caller's work still leaves its trace
    (TC-030: failed calls must be traceable too).
    """

    def __init__(
        self,
        session_factory: Callable[[], Session],
        *,
        brand_id: uuid.UUID | None = None,
        task_id: uuid.UUID | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._brand_id = brand_id
        self._task_id = task_id

    def record(self, call: LlmCallRecord) -> None:
        with self._session_factory() as session:
            session.add(
                LlmCallLog(
                    brand_id=self._brand_id,
                    task_id=self._task_id,
                    provider=call.provider,
                    model=call.model,
                    purpose=call.purpose[:50],
                    status=call.status,
                    latency_ms=call.latency_ms,
                    prompt_tokens=call.usage.prompt_tokens,
                    completion_tokens=call.usage.completion_tokens,
                    cost=call.cost,
                    price_version=call.price_version,
                    error=call.error[:60],
                    attempt=call.attempt,
                )
            )
            session.commit()
