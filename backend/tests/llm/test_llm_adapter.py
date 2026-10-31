"""Model adapter: OpenAI-compatible client, structured output and call records (TC-018, TC-030).

No test here calls a real model: HTTP is mocked and the key is a dummy.
"""

import json
from decimal import Decimal

import httpx
import pytest
from pydantic import BaseModel

from app.fakes.llm import FakeLlmClient, ListCallRecorder
from app.infra.openai_compat import OpenAICompatibleClient, Price
from app.ports.llm import LlmClient, LlmMessage, LlmRequest, LlmUsage
from app.services.errors import ModelUnavailableError
from app.services.llm_structured import (
    LlmOutputError,
    extract_json_text,
    generate_structured,
)

REQUEST = LlmRequest(
    messages=(LlmMessage("user", "写一条标题"),), purpose="generate", json_mode=True
)
PRICE = Price("v1", Decimal("2"), Decimal("8"))  # per million tokens


def _ok_body(text: str = "你好", prompt: int = 1000, completion: int = 500) -> dict[str, object]:
    return {
        "choices": [{"message": {"content": text}}],
        "usage": {"prompt_tokens": prompt, "completion_tokens": completion},
    }


def _client(
    handler: httpx.MockTransport,
    *,
    recorder: ListCallRecorder | None = None,
    key: str = "dummy-key",
    retries: int = 2,
    sleeps: list[float] | None = None,
) -> OpenAICompatibleClient:
    return OpenAICompatibleClient(
        provider="deepseek",
        model="deepseek-flash",
        base_url="https://llm.test/v1/",
        api_key=key,
        price=PRICE,
        recorder=recorder,
        max_retries=retries,
        client=httpx.Client(transport=handler),
        sleep=(sleeps.append if sleeps is not None else lambda _: None),
    )


def test_success_returns_text_usage_cost_and_records_the_call() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_ok_body())

    recorder = ListCallRecorder()
    response = _client(httpx.MockTransport(handler), recorder=recorder).complete(REQUEST)

    assert response.text == "你好" and response.provider == "deepseek"
    assert response.usage == LlmUsage(1000, 500) and response.usage.total_tokens == 1500
    assert response.cost == Decimal("0.006") and response.price_version == "v1"
    (call,) = recorder.records
    assert (call.status, call.purpose, call.attempt, call.error) == ("ok", "generate", 1, "")
    assert call.cost == Decimal("0.006") and call.usage.prompt_tokens == 1000

    request = seen[0]
    assert request.url == "https://llm.test/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer dummy-key"
    body = json.loads(request.content)
    assert body["model"] == "deepseek-flash" and body["messages"][0]["role"] == "user"
    assert body["response_format"] == {"type": "json_object"}
    assert "max_tokens" not in body
    without_json = LlmRequest(messages=REQUEST.messages, max_tokens=50)
    seen.clear()
    _client(httpx.MockTransport(handler)).complete(without_json)
    plain = json.loads(seen[0].content)
    assert plain["max_tokens"] == 50 and "response_format" not in plain


def test_transient_failures_are_retried_with_backoff_then_succeed() -> None:
    statuses = iter([429, 503])
    sleeps: list[float] = []

    def handler(_: httpx.Request) -> httpx.Response:
        status = next(statuses, 200)
        return httpx.Response(status, json=_ok_body() if status == 200 else {})

    recorder = ListCallRecorder()
    response = _client(httpx.MockTransport(handler), recorder=recorder, sleeps=sleeps).complete(REQUEST)

    assert response.text == "你好"
    assert [(c.status, c.error, c.attempt) for c in recorder.records] == [
        ("error", "http_429", 1),
        ("error", "http_503", 2),
        ("ok", "", 3),
    ]
    assert sleeps == [1.0, 2.0]  # exponential backoff


def test_retries_are_bounded_and_failures_stay_traceable() -> None:
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(500, text="secret echoed")

    recorder = ListCallRecorder()
    with pytest.raises(ModelUnavailableError) as error:
        _client(httpx.MockTransport(handler), recorder=recorder).complete(REQUEST)
    assert len(calls) == 3  # 1 call + 2 retries, never more
    assert "secret" not in error.value.message and "http_500" in error.value.message
    assert [c.status for c in recorder.records] == ["error"] * 3
    assert all(c.error == "http_500" for c in recorder.records)


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_client_errors_are_not_retried(status: int) -> None:
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(status, json={})

    with pytest.raises(ModelUnavailableError):
        _client(httpx.MockTransport(handler)).complete(REQUEST)
    assert len(calls) == 1


def test_timeouts_and_network_errors_are_retried() -> None:
    errors: list[Exception] = [
        httpx.ReadTimeout("slow"),
        httpx.ConnectError("down"),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if errors:
            raise errors.pop(0)
        return httpx.Response(200, json=_ok_body())

    recorder = ListCallRecorder()
    _client(httpx.MockTransport(handler), recorder=recorder).complete(REQUEST)
    assert [c.error for c in recorder.records] == ["timeout", "network_error", ""]


@pytest.mark.parametrize(
    "body",
    [{}, {"choices": []}, {"choices": [{"message": {"content": "  "}}]}, {"choices": [{"message": {}}]}],
)
def test_unusable_answers_are_reported(body: dict[str, object]) -> None:
    recorder = ListCallRecorder()
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=body))
    with pytest.raises(ModelUnavailableError, match="unusable"):
        _client(transport, recorder=recorder).complete(REQUEST)
    assert [c.error for c in recorder.records] == ["bad_response"]


def test_a_missing_key_fails_without_any_request() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise AssertionError("no request may be sent without a key")

    recorder = ListCallRecorder()
    with pytest.raises(ModelUnavailableError, match="not configured"):
        _client(httpx.MockTransport(handler), recorder=recorder, key="").complete(REQUEST)
    assert [c.error for c in recorder.records] == ["not_configured"]


def test_cost_is_empty_without_a_price() -> None:
    client = OpenAICompatibleClient(
        provider="openai",
        model="m",
        base_url="https://llm.test",
        api_key="k",
        client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=_ok_body()))),
    )
    response = client.complete(REQUEST)
    assert response.cost is None and response.price_version is None
    assert isinstance(client, LlmClient)


# ---- structured output ----
class Titles(BaseModel):
    titles: list[str]
    count: int


GOOD = '{"titles": ["a", "b"], "count": 2}'


def test_extract_json_text_handles_fences_and_prose() -> None:
    assert extract_json_text(f"```json\n{GOOD}\n```") == GOOD
    assert extract_json_text(f"好的，结果如下：{GOOD} 希望有帮助") == GOOD
    assert extract_json_text("no json here") == "no json here"


def test_valid_output_is_returned_after_one_call() -> None:
    fake = FakeLlmClient([GOOD])
    result = generate_structured(fake, REQUEST, Titles)
    assert result.value == Titles(titles=["a", "b"], count=2) and result.attempts == 1
    assert fake.requests[0].json_mode is True


def test_invalid_output_is_corrected_with_a_bounded_number_of_retries() -> None:  # TC-018
    fake = FakeLlmClient(["not json", '{"titles": "oops"}', GOOD])
    result = generate_structured(fake, REQUEST, Titles, max_attempts=3)
    assert result.attempts == 3 and result.value.count == 2
    correction = fake.requests[2].messages[-1]
    assert correction.role == "user" and "rejected" in correction.content
    assert fake.requests[1].messages[-2].content == "not json"  # the bad answer is shown back


def test_gives_up_after_max_attempts() -> None:  # TC-018
    fake = FakeLlmClient(["still bad"])
    with pytest.raises(LlmOutputError, match="3 attempts"):
        generate_structured(fake, REQUEST, Titles, max_attempts=3)
    assert len(fake.requests) == 3  # never more than configured
    with pytest.raises(LlmOutputError):
        generate_structured(FakeLlmClient(["bad"]), REQUEST, Titles, max_attempts=0)


def test_an_unreachable_model_is_not_swallowed() -> None:
    fake = FakeLlmClient([ModelUnavailableError("down")])
    with pytest.raises(ModelUnavailableError):
        generate_structured(fake, REQUEST, Titles)
    assert len(fake.requests) == 1


def test_fake_client_repeats_its_last_answer() -> None:
    fake = FakeLlmClient(["a", "b"])
    assert [fake.complete(REQUEST).text for _ in range(3)] == ["a", "b", "b"]
