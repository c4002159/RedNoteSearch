"""Local-only provider failures: never issue a network request or read a real key."""

import httpx

from app.infra.openai_compat import OpenAICompatibleClient


def failure_transport(mode: str) -> httpx.MockTransport:
    def respond(request: httpx.Request) -> httpx.Response:
        if mode == "missing":
            raise AssertionError("An unconfigured provider must not call the network")
        if mode == "timeout":
            raise httpx.ReadTimeout("simulated timeout", request=request)
        return httpx.Response(500, json={"error": "simulated outage"})

    return httpx.MockTransport(respond)


def failing_llm(mode: str, client: httpx.Client) -> OpenAICompatibleClient:
    return OpenAICompatibleClient(
        provider="test",
        model="test-model",
        base_url="https://provider.invalid",
        api_key="" if mode == "missing" else "test-only",
        max_retries=0,
        client=client,
    )
