import json
import uuid
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.api.routes.viral import get_viral_llm_factory
from app.core.config import settings
from app.fakes.llm import FakeLlmClient
from app.main import app
from app.models import AuditLog, Brand, KbDocument, LlmCallLog, Tenant
from app.models.viral import ViralPattern, ViralSample
from app.services.errors import ModelUnavailableError
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user
from tests.domain.test_viral import ANALYSIS

API = settings.API_V1_STR
SAMPLE = "  这是一段仅供结构分析的自编演示笔记。\n木质香调连接通勤场景，最后提问。  "


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


@pytest.fixture(autouse=True)
def llm() -> Generator[FakeLlmClient]:
    fake = FakeLlmClient([json.dumps(ANALYSIS, ensure_ascii=False)])
    app.dependency_overrides[get_viral_llm_factory] = lambda: (
        lambda _brand, _model: fake
    )
    yield fake
    app.dependency_overrides.pop(get_viral_llm_factory, None)


def sample(
    client: TestClient, headers: dict[str, str], brand_id: str, **extra: Any
) -> dict[str, Any]:
    r = client.post(
        f"{API}/brands/{brand_id}/viral-samples",
        headers=headers,
        json={"text": SAMPLE, **extra},
    )
    assert r.status_code == 201, r.text
    return r.json()


def analyze(
    client: TestClient, headers: dict[str, str], sample_id: str
) -> dict[str, Any]:
    r = client.post(
        f"{API}/viral-samples/{sample_id}/analyze",
        headers=headers,
        json={"model_id": "deepseek-flash"},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_sample_analysis_reads_and_audit_do_not_ingest_knowledge(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    source = "https://example.com/untrusted"
    s = sample(client, h, brand["id"], note="自编", source_url=source)
    assert s["text"] == SAMPLE and s["source_url"] == source
    p = analyze(client, h, s["id"])
    assert p["sample_id"] == s["id"] and p["brand_id"] == brand["id"]
    assert p["prompt_version"] == "viral-v2" and p["checker_version"] == "viral-copy-v2"
    assert source not in "".join(m.content for m in llm.requests[0].messages)
    listing = client.get(
        f"{API}/brands/{brand['id']}/viral-samples?page_size=1&sort=created_at",
        headers=h,
    ).json()
    assert listing["total"] == 1 and "text" not in listing["items"][0]
    assert listing["items"][0]["excerpt"] == SAMPLE[:200]
    assert client.get(f"{API}/viral-samples/{s['id']}", headers=h).json() == s
    assert client.get(f"{API}/viral-patterns/{p['id']}", headers=h).json() == p
    patterns = client.get(f"{API}/viral-samples/{s['id']}/patterns", headers=h).json()
    assert patterns["items"][0] == p and patterns["total"] == 1
    assert not db.exec(
        select(KbDocument).where(KbDocument.brand_id == uuid.UUID(brand["id"]))
    ).all()
    events = db.exec(
        select(AuditLog).where(AuditLog.brand_id == uuid.UUID(brand["id"]))
    ).all()
    assert {"viral.sample_create", "viral.analyze"} <= {e.action for e in events}
    assert all(
        SAMPLE not in str(e.detail) and source not in str(e.detail) for e in events
    )


def test_concurrent_conversion_versions_increment_and_old_results_survive(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    s = sample(client, h, brand["id"])
    p = analyze(client, h, s["id"])
    url = f"{API}/viral-patterns/{p['id']}/to-template"

    def convert(_: int) -> dict[str, Any]:
        r = client.post(
            url, headers=h, json={"name": "  场景模板  ", "scene": "seeding"}
        )
        assert r.status_code == 201, r.text
        return r.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(convert, range(2)))
    assert sorted(r["template_version"] for r in rows) == [1, 2]
    third = convert(0)
    assert (
        third["template_version"] == 3 and len({r["id"] for r in [*rows, third]}) == 3
    )
    assert all(
        r["brand_id"] == brand["id"] and r["structure"] == ANALYSIS["abstract_template"]
        for r in rows
    )
    assert client.get(f"{API}/viral-patterns/{p['id']}", headers=h).json() == p
    again = analyze(client, h, s["id"])
    assert again["id"] != p["id"]
    assert (
        client.get(f"{API}/viral-samples/{s['id']}/patterns", headers=h).json()["total"]
        == 2
    )


def test_roles_cross_brand_and_unauthenticated_routes(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    editor, eh = _make_user(client, db)
    _add_member(client, h, brand["id"], editor, "editor")
    outsider, oh = _make_user(client, db)
    outsider.is_superuser = True
    db.add(outsider)
    db.commit()
    s = sample(client, eh, brand["id"])
    p = analyze(client, eh, s["id"])
    assert (
        client.post(
            f"{API}/viral-patterns/{p['id']}/to-template",
            headers=eh,
            json={"name": "x", "scene": "story"},
        ).status_code
        == 403
    )
    routes = [
        ("get", f"/brands/{brand['id']}/viral-samples", None, 403),
        ("post", f"/brands/{brand['id']}/viral-samples", {"text": "x"}, 403),
        ("get", f"/viral-samples/{s['id']}", None, 404),
        ("get", f"/viral-samples/{s['id']}/patterns", None, 404),
        ("get", f"/viral-patterns/{p['id']}", None, 404),
        (
            "post",
            f"/viral-samples/{s['id']}/analyze",
            {"model_id": "deepseek-flash"},
            404,
        ),
        (
            "post",
            f"/viral-patterns/{p['id']}/to-template",
            {"name": "x", "scene": "story"},
            404,
        ),
    ]
    for method, path, body, expected in routes:
        kwargs = {"json": body} if body is not None else {}
        assert (
            client.request(method, f"{API}{path}", headers=oh, **kwargs).status_code
            == expected
        )
        assert client.request(method, f"{API}{path}", **kwargs).status_code == 401
    for path in (f"/viral-samples/{uuid.uuid4()}", f"/viral-patterns/{uuid.uuid4()}"):
        assert client.get(f"{API}{path}", headers=h).status_code == 404


@pytest.mark.parametrize(
    "bad",
    [
        {"text": " "},
        {"text": "a" * 5001},
        {"text": "x", "source_url": "javascript:alert(1)"},
        {"text": "x", "note": "a" * 1001},
    ],
    ids=["blank", "limit", "url", "note"],
)
def test_sample_validation(
    client: TestClient, superuser_token_headers: dict[str, str], bad: dict[str, Any]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    r = client.post(f"{API}/brands/{brand['id']}/viral-samples", headers=h, json=bad)
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("failure", ["schema", "copy", "format", "offline"])
def test_analysis_failure_recovery_and_bounded_calls(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
    failure: str,
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    s = sample(client, h, brand["id"])
    copied = {**ANALYSIS, "hook_type": SAMPLE[:20]}
    llm._script = [
        "not json"
        if failure == "schema"
        else json.dumps(copied)
        if failure == "copy"
        else json.dumps({**ANALYSIS, "abstract_template": "围绕{{scene}}展开"})
        if failure == "format"
        else ModelUnavailableError("offline")
    ]
    r = client.post(
        f"{API}/viral-samples/{s['id']}/analyze",
        headers=h,
        json={"model_id": "deepseek-flash"},
    )
    assert r.status_code == (503 if failure == "offline" else 422)
    assert len(llm.requests) == (1 if failure == "offline" else 2)
    if failure != "offline":
        assert (
            r.json()["error"]["details"]["reason"]
            == (
                {
                    "schema": "schema_invalid",
                    "copy": "copied_text",
                    "format": "format_invalid",
                }[failure]
            )
        )
    assert not db.exec(
        select(ViralPattern).where(ViralPattern.sample_id == uuid.UUID(s["id"]))
    ).all()
    assert db.get(ViralSample, uuid.UUID(s["id"]))
    llm._script = [json.dumps(ANALYSIS)]
    assert analyze(client, h, s["id"])["sample_id"] == s["id"]


def test_model_and_template_request_validation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    s = sample(client, h, brand["id"])
    invalid = client.post(
        f"{API}/viral-samples/{s['id']}/analyze",
        headers=h,
        json={"model_id": "unknown"},
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["details"]["errors"][0]["loc"] == [
        "body",
        "model_id",
    ]
    p = analyze(client, h, s["id"])
    for body in (
        {"name": " ", "scene": "story"},
        {"name": "x", "scene": "invalid"},
        {"name": "x", "scene": "story", "brand_id": brand["id"]},
    ):
        assert (
            client.post(
                f"{API}/viral-patterns/{p['id']}/to-template", headers=h, json=body
            ).status_code
            == 422
        )
    assert (
        client.get(
            f"{API}/brands/{brand['id']}/viral-samples?page_size=101", headers=h
        ).status_code
        == 422
    )
    assert (
        client.get(
            f"{API}/viral-samples/{s['id']}/patterns?page=0", headers=h
        ).status_code
        == 422
    )


def test_provider_attempts_are_recorded_without_real_network(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    s = sample(client, h, brand["id"])
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "fake-only")
    real = get_viral_llm_factory()(uuid.UUID(brand["id"]), "deepseek-flash")
    calls: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) > 2:
            return httpx.Response(503, json={})
        content = "bad" if len(calls) == 1 else json.dumps(ANALYSIS)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": content}}],
                "usage": {"prompt_tokens": 2, "completion_tokens": 3},
            },
        )

    real._client = httpx.Client(transport=httpx.MockTransport(answer))  # type: ignore[attr-defined]
    app.dependency_overrides[get_viral_llm_factory] = lambda: lambda _b, _m: real
    analyze(client, h, s["id"])
    logs = db.exec(
        select(LlmCallLog).where(LlmCallLog.brand_id == uuid.UUID(brand["id"]))
    ).all()
    assert len(logs) == 2 and all(r.purpose == "viral_analyze" for r in logs)
    r = client.post(
        f"{API}/viral-samples/{s['id']}/analyze",
        headers=h,
        json={"model_id": "deepseek-flash"},
    )
    assert r.status_code == 503 and len(calls) == 4  # one transient retry
    logs = db.exec(
        select(LlmCallLog).where(LlmCallLog.brand_id == uuid.UUID(brand["id"]))
    ).all()
    assert len(logs) == 4 and sum(r.status == "error" for r in logs) == 2
