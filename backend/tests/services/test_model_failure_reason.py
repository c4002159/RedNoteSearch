"""Missing credentials are distinct from mocked upstream failures without a database."""

import httpx
import pytest

from app.infra.dashscope import DashScopeEmbeddingProvider
from app.ports.llm import LlmRequest
from app.services.errors import ModelUnavailableError
from tests.utils.model_failure import failing_llm, failure_transport


@pytest.mark.parametrize("mode", ["missing", "server", "timeout"])
@pytest.mark.parametrize("provider", ["llm", "embedding"])
def test_model_failure_reason(mode: str, provider: str) -> None:
    with httpx.Client(transport=failure_transport(mode)) as client:
        with pytest.raises(ModelUnavailableError) as caught:
            if provider == "llm":
                failing_llm(mode, client).complete(LlmRequest(messages=()))
            else:
                DashScopeEmbeddingProvider(
                    api_key="" if mode == "missing" else "test-only", client=client
                ).embed(["test input"])
    expected = {"reason": "model_not_configured"} if mode == "missing" else {}
    assert caught.value.details == expected
    assert caught.value.task_error_code == (
        "model_not_configured" if mode == "missing" else "model_unavailable"
    )
