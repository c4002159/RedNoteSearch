"""Generating a version for a task: retrieval, prompt, model call, constraint checks and storage.

Needs the database. The model is a scripted fake; no real model is called.
"""

import json
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.api.routes.knowledge import get_embedder
from app.api.routes.tasks import get_llm_factory
from app.core.config import settings
from app.fakes.embedding import FakeEmbeddingProvider
from app.fakes.llm import FakeLlmClient
from app.main import app
from app.models import (
    AuditLog,
    Brand,
    GenerationVersion,
    LlmCallLog,
    Task,
    Tenant,
)
from app.ports.llm import LlmCallRecord, LlmUsage
from app.services.errors import ModelUnavailableError
from app.services.llm_log import DbLlmCallRecorder
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR

GOOD = json.dumps(
    {
        "title_candidates": ["通勤路上的清爽", "木质香调小记", "今天的香气"],
        "body": "早上出门前喷一下，木质香调很柔和，通勤路上很舒服。",
        "hashtags": ["日常香氛", "通勤好物"],
        "cover_candidates": ["清爽一整天", "通勤香气"],
    },
    ensure_ascii=False,
)
LONG_TITLE = json.dumps(
    {"title_candidates": ["字" * 21], "body": "木质香调", "hashtags": ["日常"]},
    ensure_ascii=False,
)


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


@pytest.fixture
def fake_llm() -> Generator[FakeLlmClient]:
    llm = FakeLlmClient([GOOD])
    embedder = FakeEmbeddingProvider()
    app.dependency_overrides[get_llm_factory] = lambda: lambda _b, _t: llm
    app.dependency_overrides[get_embedder] = lambda: embedder
    yield llm
    app.dependency_overrides.pop(get_llm_factory, None)
    app.dependency_overrides.pop(get_embedder, None)


def _setup(
    client: TestClient, headers: dict[str, str], **task_extra: Any
) -> dict[str, str]:
    brand = _create_brand(client, headers)
    product = client.post(
        f"{API}/brands/{brand['id']}/products",
        headers=headers,
        json={
            "name": "晨雾",
            "category": "perfume",
            "selling_points": [{"text": "无来源卖点"}],
            "restricted_claims": ["提升魅力"],
        },
    ).json()
    scenario = client.get(f"{API}/scenarios", headers=headers).json()["items"][0]
    task = client.post(
        f"{API}/tasks",
        headers=headers,
        json={
            "brand_id": brand["id"],
            "product_id": product["id"],
            "scenario_id": scenario["id"],
            "required_terms": ["木质香调"],
            **task_extra,
        },
    )
    assert task.status_code == 201, task.text
    return {"brand": brand["id"], "task": task.json()["id"], "scenario": scenario["id"]}


def _gen_calls(llm: FakeLlmClient) -> list[Any]:
    return [r for r in llm.requests if r.purpose == "generate"]


def _task(client: TestClient, headers: dict[str, str], task_id: str) -> dict[str, Any]:
    return client.get(f"{API}/tasks/{task_id}", headers=headers).json()  # type: ignore[no-any-return]


def test_generate_stores_a_checked_version(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    fake_llm: FakeLlmClient,
) -> None:
    ids = _setup(client, superuser_token_headers)
    voice = client.post(
        f"{API}/brands/{ids['brand']}/voice-profile/versions",
        headers=superuser_token_headers,
        json={"persona": "亲切克制", "forbidden_words": ["最好"]},
    ).json()
    client.post(
        f"{API}/brands/{ids['brand']}/voice-profile/versions/{voice['version']}/activate",
        headers=superuser_token_headers,
    )

    r = client.post(
        f"{API}/tasks/{ids['task']}/generate", headers=superuser_token_headers
    )
    assert r.status_code == 202, r.text
    assert (
        r.json()["flow_status"] == "generating"
    )  # the 202 reports the state at acceptance

    task = _task(client, superuser_token_headers, ids["task"])
    assert task["flow_status"] == "checks_completed"
    assert task["progress"] == {"stage": "done"}
    assert task["last_error"] is None and task["latest_version_id"]

    version = client.get(
        f"{API}/generation-versions/{task['latest_version_id']}",
        headers=superuser_token_headers,
    ).json()
    assert version["version_no"] == 1 and version["origin"] == "generated"
    assert version["title_candidates"] == [
        "通勤路上的清爽",
        "木质香调小记",
        "今天的香气",
    ]
    assert version["hashtags"] == ["日常香氛", "通勤好物"]
    assert version["constraint_checks"]["passed"] is True
    assert (version["prompt_version"], version["checker_version"]) == (
        "gen-v3",
        "constraints-v1",
    )
    assert (
        version["voice_version"] == voice["version"]
        and version["template_version"] == 1
    )
    assert version["model"] == "fake-model"

    prompt = _gen_calls(fake_llm)[0].messages[1].content
    assert "亲切克制" in prompt and "未核实的卖点" in prompt and "无来源卖点" in prompt
    assert (
        "提升魅力" in prompt and "木质香调" in prompt
    )  # restricted claim and required term

    db.expire_all()
    actions = [
        a.action
        for a in db.exec(
            select(AuditLog).where(AuditLog.brand_id == uuid.UUID(ids["brand"]))
        ).all()
    ]
    assert "task.generate" in actions


def test_generation_retries_failed_constraints_a_bounded_number_of_times(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    fake_llm: FakeLlmClient,
) -> None:
    ids = _setup(client, superuser_token_headers)
    fake_llm._script = [LONG_TITLE, GOOD]  # noqa: SLF001 - scripted answers: bad, then good
    client.post(f"{API}/tasks/{ids['task']}/generate", headers=superuser_token_headers)
    calls = _gen_calls(fake_llm)
    assert len(calls) == 2
    assert "上一版有这些问题" in calls[1].messages[1].content
    assert "标题" in calls[1].messages[1].content
    assert (
        _task(client, superuser_token_headers, ids["task"])["flow_status"]
        == "checks_completed"
    )

    other = _setup(client, superuser_token_headers)
    fake_llm._script = [LONG_TITLE]  # noqa: SLF001 - always bad
    fake_llm.requests.clear()
    client.post(
        f"{API}/tasks/{other['task']}/generate", headers=superuser_token_headers
    )
    assert (
        len(_gen_calls(fake_llm)) == 3
    )  # one try and two corrections, never more (TC-018)
    task = _task(client, superuser_token_headers, other["task"])
    assert task["flow_status"] == "constraint_failed"
    version = client.get(
        f"{API}/generation-versions/{task['latest_version_id']}",
        headers=superuser_token_headers,
    ).json()
    assert version["flow_status"] == "constraint_failed"
    assert version["constraint_checks"]["passed"] is False
    assert (
        version["constraint_checks"]["titles"][0]["issues"][0]["code"]
        == "title_too_long"
    )

    # A failed run can be generated again; the new version gets the next number.
    fake_llm._script = [GOOD]  # noqa: SLF001
    again = client.post(
        f"{API}/tasks/{other['task']}/generate", headers=superuser_token_headers
    )
    assert again.status_code == 202
    versions = client.get(
        f"{API}/tasks/{other['task']}/versions", headers=superuser_token_headers
    ).json()["items"]
    assert [(v["version_no"], v["flow_status"]) for v in versions] == [
        (1, "constraint_failed"),
        (2, "checks_completed"),
    ]


def test_unusable_model_output_marks_the_task_failed(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    fake_llm: FakeLlmClient,
) -> None:
    ids = _setup(client, superuser_token_headers)
    fake_llm._script = ["not json at all"]  # noqa: SLF001
    client.post(f"{API}/tasks/{ids['task']}/generate", headers=superuser_token_headers)
    assert (
        len(fake_llm.requests) == 2
    )  # two structured attempts in the single round, then it gives up
    task = _task(client, superuser_token_headers, ids["task"])
    assert (task["flow_status"], task["last_error"]) == (
        "constraint_failed",
        "invalid_model_output",
    )
    assert task["latest_version_id"] is None


def test_an_unreachable_model_leaves_the_task_startable(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    fake_llm: FakeLlmClient,
) -> None:
    ids = _setup(client, superuser_token_headers)
    fake_llm._script = [ModelUnavailableError("down")]  # noqa: SLF001
    client.post(f"{API}/tasks/{ids['task']}/generate", headers=superuser_token_headers)
    task = _task(client, superuser_token_headers, ids["task"])
    assert (task["flow_status"], task["last_error"]) == ("queued", "model_unavailable")

    fake_llm._script = [GOOD]  # noqa: SLF001
    ok = client.post(
        f"{API}/tasks/{ids['task']}/generate", headers=superuser_token_headers
    )
    assert ok.status_code == 202
    task = _task(client, superuser_token_headers, ids["task"])
    assert task["flow_status"] == "checks_completed"
    assert task["last_error"] is None


def test_generate_validates_state_idempotency_and_access(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    fake_llm: FakeLlmClient,
) -> None:
    ids = _setup(client, superuser_token_headers)
    _, outsider_headers = _make_user(client, db)
    member, member_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, ids["brand"], member, "editor")
    url = f"{API}/tasks/{ids['task']}/generate"

    assert client.post(url, headers=outsider_headers).status_code == 404
    assert (
        client.post(
            f"{API}/tasks/{uuid.uuid4()}/generate", headers=superuser_token_headers
        ).status_code
        == 404
    )
    assert client.post(url).status_code == 401

    first = client.post(url, headers={**member_headers, "Idempotency-Key": "k-1"})
    assert first.status_code == 202
    after_first = len(fake_llm.requests)
    assert len(_gen_calls(fake_llm)) == 1
    # The same key again does not start a second run, whatever state the task is in now.
    repeat = client.post(url, headers={**member_headers, "Idempotency-Key": "k-1"})
    assert repeat.status_code == 202 and len(fake_llm.requests) == after_first
    # Without the key, a task that is already past `queued` cannot be generated.
    again = client.post(url, headers=member_headers)
    assert again.status_code == 409
    assert (
        client.post(
            url, headers={**member_headers, "Idempotency-Key": "x" * 101}
        ).status_code
        == 422
    )


def test_task_material_reaches_the_prompt(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    fake_llm: FakeLlmClient,
) -> None:
    phrase = f"独家资料{uuid.uuid4().hex[:8]}"
    ids = _setup(
        client,
        superuser_token_headers,
        brief=phrase,
        task_materials=[{"filename": "a.txt", "text": f"运营补充：{phrase}"}],
    )
    client.post(f"{API}/tasks/{ids['task']}/generate", headers=superuser_token_headers)
    prompt = _gen_calls(fake_llm)[0].messages[1].content
    assert f"（任务资料，未审核）运营补充：{phrase}" in prompt
    task = _task(client, superuser_token_headers, ids["task"])
    version = client.get(
        f"{API}/generation-versions/{task['latest_version_id']}",
        headers=superuser_token_headers,
    ).json()
    sources = version["retrieved_sources"]
    assert [s["source_level"] for s in sources] == ["task_material"]
    assert (
        sources[0]["snapshot_id"]
        and sources[0]["content_hash"]
        and sources[0]["ref"] == "S1"
    )


def test_every_model_call_is_logged_even_when_it_fails(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    ids = _setup(client, superuser_token_headers)
    from app.core.db import engine

    recorder = DbLlmCallRecorder(
        lambda: Session(engine),
        brand_id=uuid.UUID(ids["brand"]),
        task_id=uuid.UUID(ids["task"]),
    )
    recorder.record(
        LlmCallRecord(
            provider="deepseek",
            model="deepseek-flash",
            purpose="generate",
            status="error",
            latency_ms=12,
            error="http_429",
            attempt=1,
        )
    )
    recorder.record(
        LlmCallRecord(
            provider="deepseek",
            model="deepseek-flash",
            purpose="generate",
            status="ok",
            latency_ms=900,
            usage=LlmUsage(100, 50),
            attempt=2,
        )
    )
    db.expire_all()
    rows = db.exec(
        select(LlmCallLog).where(LlmCallLog.task_id == uuid.UUID(ids["task"]))
    ).all()
    assert sorted((r.status, r.error, r.attempt, r.prompt_tokens) for r in rows) == [
        ("error", "http_429", 1, 0),
        ("ok", "", 2, 100),
    ]
    assert all(r.brand_id == uuid.UUID(ids["brand"]) for r in rows)
    # Deleting the task keeps the log (it is evidence of cost), only the link is cleared.
    db.execute(delete(Task).where(Task.id == uuid.UUID(ids["task"])))
    db.commit()
    assert (
        len(
            db.exec(
                select(LlmCallLog).where(LlmCallLog.brand_id == uuid.UUID(ids["brand"]))
            ).all()
        )
        == 2
    )
    assert db.exec(select(GenerationVersion)).all() is not None
