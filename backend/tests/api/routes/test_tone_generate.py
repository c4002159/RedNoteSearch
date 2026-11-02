import json
import uuid
from collections.abc import Generator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.api.routes.tone import get_tone_llm_factory
from app.core.config import settings
from app.fakes.demo_llm import DemoLlmClient
from app.infra.openai_compat import OpenAICompatibleClient
from app.main import app
from app.models import AuditLog, BrandVoiceProfile, Product
from app.ports.llm import LlmRequest, LlmResponse, LlmUsage
from app.services import tone_generate
from app.services.errors import ModelUnavailableError
from tests.api.routes.test_brands import _add_member, _make_user
from tests.api.routes.test_tone import API, _context, _pattern, _reading, _task

GOOD = '{"suggestions":[{"tone":"平实叙述","reason":"采用清楚的句式"}]}'


class ScriptedToneLlm:
    def __init__(self, *answers: str | Exception) -> None:
        self.answers = list(answers)
        self.requests: list[LlmRequest] = []

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return LlmResponse(
            text=answer,
            provider="fake",
            model="scripted-fake",
            usage=LlmUsage(),
            latency_ms=1,
        )


@pytest.fixture(autouse=True)
def fake_mode(monkeypatch: pytest.MonkeyPatch) -> Generator[None]:
    monkeypatch.setattr(settings, "LLM_MODE", "demo_fake")
    yield
    app.dependency_overrides.pop(get_tone_llm_factory, None)


def _use(llm: Any) -> None:
    app.dependency_overrides[get_tone_llm_factory] = lambda: lambda _brand: llm


def _url(brand: str) -> str:
    return f"{API}/brands/{brand}/tone-suggestions/generate"


def _voice(db: Session, brand: str, *, active: bool = True, version: int = 1) -> None:
    db.add(
        BrandVoiceProfile(
            brand_id=uuid.UUID(brand),
            version=version,
            is_active=active,
            persona="品牌人设",
            tone_keywords=["温柔", "克制"],
            preferred_words=["从容"],
            forbidden_words=["狂野"],
            sample_refs=["不得发送的手册原文"],
        )
    )
    db.commit()


def test_auth_count_cross_brand_and_editor(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx, other = _context(client, db, h), _context(client, db, h)
    url = _url(ctx["brand"])
    llm = ScriptedToneLlm(GOOD)
    _use(llm)
    assert client.post(url, json={}).status_code == 401
    outsider, headers = _make_user(client, db)
    assert client.post(url, headers=headers, json={}).status_code == 403
    for body in (
        {"count": 0},
        {"count": 6},
        {"count": 1.5},
        {"count": True},
        {"scene": ""},
    ):
        assert client.post(url, headers=h, json=body).status_code == 422
    for product in (other["product"], str(uuid.uuid4())):
        assert (
            client.post(url, headers=h, json={"product_id": product}).status_code == 404
        )
    assert not llm.requests
    _add_member(client, h, ctx["brand"], outsider, "editor")
    r = client.post(
        url, headers=headers, json={"count": 1, "product_id": ctx["product"]}
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == 1


def test_demo_active_profile_fallback_and_count_only_audit(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _context(client, db, h)
    _voice(db, ctx["brand"], active=False)
    url = _url(ctx["brand"])
    r = client.post(url, headers=h, json={})
    assert r.status_code == 200, r.text
    assert r.json()["model"] == "demo-fake" and r.json()["prompt_version"] == "tone-v1"
    assert [item["tone"] for item in r.json()["items"]] == [
        "平实清楚的叙述",
        "简洁自然的表达",
    ]
    _voice(db, ctx["brand"], version=2)
    r = client.post(url, headers=h, json={"count": 5})
    assert r.status_code == 200 and len(r.json()["items"]) == 5
    assert all("温柔" in i["tone"] or "克制" in i["tone"] for i in r.json()["items"])
    rows = db.exec(
        select(AuditLog)
        .where(
            AuditLog.brand_id == uuid.UUID(ctx["brand"]),
            AuditLog.action == "tone.generate",
        )
        .order_by(col(AuditLog.created_at))
    ).all()
    assert [row.detail for row in rows] == [{"count": 2}, {"count": 5}]
    assert all(row.actor_id is not None for row in rows)


def test_context_allowlist_reuses_pr1_and_filters_both_fields(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    h = superuser_token_headers
    ctx = _context(client, db, h)
    other = _context(client, db, h)
    _voice(db, ctx["brand"])
    _voice(db, other["brand"])
    _task(client, h, ctx, "历史语气")
    _pattern(db, ctx["brand"], "结构语气")
    for _ in range(3):
        _reading(db, ctx, _task(client, h, ctx, "历史语气"), 10)
    _task(client, h, other, "其他品牌语气")
    product = db.get(Product, uuid.UUID(ctx["product"]))
    assert product is not None
    product.product_line = "测试产品线"
    product.selling_points = [{"text": "不得发送的卖点"}]
    db.add(product)
    db.commit()
    calls: list[dict[str, Any]] = []
    original = tone_generate.suggestions

    def spy(**kwargs: Any) -> Any:
        calls.append(kwargs)
        return original(**kwargs)

    monkeypatch.setattr(tone_generate, "suggestions", spy)
    output = {
        "suggestions": [
            {"tone": " 历史语气 ", "reason": "已有"},
            {"tone": "结构语气", "reason": "已有"},
            {"tone": "狂野", "reason": "品牌禁用词"},
            {"tone": "自然", "reason": "狂野"},
            {"tone": "淡然", "reason": "第一"},
            {"tone": "轻柔", "reason": "治疗失眠"},
            {"tone": " 温柔\t叙述 ", "reason": "依据品牌调性"},
            {"tone": "温柔 叙述", "reason": "重复"},
        ]
    }
    llm = ScriptedToneLlm(json.dumps(output))
    _use(llm)
    r = client.post(
        _url(ctx["brand"]),
        headers=h,
        json={"scene": "seeding", "product_id": ctx["product"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["items"] == [{"tone": "温柔 叙述", "reason": "依据品牌调性"}]
    assert len(calls) == 1 and calls[0]["brand_id"] == uuid.UUID(ctx["brand"])
    request = llm.requests[0]
    context = json.loads(request.messages[-1].content)
    assert set(context) == {
        "profile",
        "product",
        "scene_name",
        "existing_tones",
        "count",
    }
    assert context["product"] == {"category": "other", "product_line": "测试产品线"}
    assert set(context["profile"]) == {
        "persona",
        "tone_keywords",
        "preferred_words",
        "forbidden_words",
    }
    assert context["existing_tones"] == {
        "history": ["历史语气"],
        "template": ["结构语气"],
        "results": ["历史语气"],
    }
    assert context["scene_name"] != "seeding"
    assert (
        "不得发送" not in request.messages[-1].content
        and "其他品牌" not in request.messages[-1].content
    )
    assert request.json_mode and request.purpose == "tone_suggestions"


@pytest.mark.parametrize(
    "failure,code,status",
    [
        (ModelUnavailableError("模型超时 timeout"), "MODEL_UNAVAILABLE", 503),
        ("", "MODEL_UNAVAILABLE", 503),
        ("not JSON", "TONE_INVALID_MODEL_OUTPUT", 422),
        (
            '{"suggestions":[{"tone":"唯一","reason":"描述"}]}',
            "TONE_NO_VALID_SUGGESTIONS",
            422,
        ),
    ],
)
def test_exhausted_errors_do_not_audit(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    failure: str | Exception,
    code: str,
    status: int,
) -> None:
    ctx = _context(client, db, superuser_token_headers)
    llm = ScriptedToneLlm(failure, failure, failure)
    _use(llm)
    r = client.post(_url(ctx["brand"]), headers=superuser_token_headers, json={})
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert len(llm.requests) == 3
    assert (
        db.exec(
            select(AuditLog).where(
                AuditLog.brand_id == uuid.UUID(ctx["brand"]),
                AuditLog.action == "tone.generate",
            )
        ).all()
        == []
    )
    assert "suggestions" not in r.json()["error"]["message"]


@pytest.mark.parametrize(
    "first", [ModelUnavailableError("http_429"), "", "{", '{"suggestions":[]}']
)
def test_retry_success(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    first: str | Exception,
) -> None:
    ctx = _context(client, db, superuser_token_headers)
    llm = ScriptedToneLlm(first, GOOD)
    _use(llm)
    r = client.post(_url(ctx["brand"]), headers=superuser_token_headers, json={})
    assert r.status_code == 200 and r.json()["model"] == "scripted-fake"
    assert len(llm.requests) == 2


@pytest.mark.parametrize("failure", ["timeout", "rate_limit", "empty"])
@pytest.mark.parametrize("recover", [True, False])
def test_adapter_fake_transport_total_retry_budget(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    failure: str,
    recover: bool,
) -> None:
    calls = 0

    def transport(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 3 or not recover:
            if failure == "timeout":
                raise httpx.ReadTimeout("fake timeout", request=request)
            if failure == "rate_limit":
                return httpx.Response(429)
            return httpx.Response(200, json={"choices": [{"message": {"content": ""}}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": GOOD}}]})

    with httpx.Client(transport=httpx.MockTransport(transport)) as http:
        llm = OpenAICompatibleClient(
            provider="fake",
            model="transport-fake",
            base_url="https://fake.invalid",
            api_key="test-only",
            max_retries=0,
            client=http,
        )
        _use(llm)
        ctx = _context(client, db, superuser_token_headers)
        r = client.post(_url(ctx["brand"]), headers=superuser_token_headers, json={})
        assert calls == 3
        assert r.status_code == (200 if recover else 503)
        if not recover:
            assert r.json()["error"]["code"] == "MODEL_UNAVAILABLE"


def test_factory_caps_adapter_retries_without_real_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routes import tone

    monkeypatch.setattr(settings, "LLM_MODE", "real")
    monkeypatch.setattr(settings, "LLM_MAX_RETRIES", 99)
    monkeypatch.setattr(tone.provider_keys, "resolve_key", lambda _provider: None)
    monkeypatch.setattr(tone.model_catalog, "price_for", lambda _model: None)
    llm = get_tone_llm_factory()(uuid.uuid4())
    assert isinstance(llm, OpenAICompatibleClient) and llm._max_retries == 0
    monkeypatch.setattr(settings, "LLM_MODE", "demo_fake")
    assert isinstance(get_tone_llm_factory()(uuid.uuid4()), DemoLlmClient)
