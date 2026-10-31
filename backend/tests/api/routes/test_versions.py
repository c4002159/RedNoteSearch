"""Editing, rechecking, rewriting, confirming and exporting versions. Needs the database."""

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
from app.models import AuditLog, Brand, ComplianceCheck, Task, Tenant
from app.services.compliance import ensure_sample_rules
from app.services.errors import ModelUnavailableError
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR


def _note(
    body: str = "早上出门前喷一下，木质香调很柔和。", title: str = "通勤路上的清爽"
) -> str:
    return json.dumps(
        {
            "title_candidates": [title, "木质香调小记"],
            "body": body,
            "hashtags": ["日常香氛", "通勤好物"],
            "cover_candidates": ["清爽一整天", "通勤香气"],
        },
        ensure_ascii=False,
    )


ANSWERS: dict[str, Any] = {
    "generate": _note(),
    "rewrite": _note("改写后的正文，木质香调更柔和。"),
    "claim_extraction": json.dumps({"claims": []}),
    "compliance_context": json.dumps({"findings": []}),
}


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    ensure_sample_rules(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


@pytest.fixture
def llm() -> Generator[FakeLlmClient]:
    answers = dict(ANSWERS)
    fake = FakeLlmClient(responder=lambda request: answers[request.purpose])
    fake.answers = answers  # type: ignore[attr-defined]
    embedder = FakeEmbeddingProvider()
    app.dependency_overrides[get_llm_factory] = lambda: lambda _b, _t: fake
    app.dependency_overrides[get_embedder] = lambda: embedder
    yield fake
    app.dependency_overrides.pop(get_llm_factory, None)
    app.dependency_overrides.pop(get_embedder, None)


def _generated(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    brand = _create_brand(client, headers)
    product = client.post(
        f"{API}/brands/{brand['id']}/products", headers=headers, json={"name": "晨雾"}
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
        },
    ).json()
    assert (
        client.post(f"{API}/tasks/{task['id']}/generate", headers=headers).status_code
        == 202
    )
    detail = client.get(f"{API}/tasks/{task['id']}", headers=headers).json()
    return {
        "brand": brand["id"],
        "task": task["id"],
        "version": detail["latest_version_id"],
        "status": detail["flow_status"],
    }


def _version(
    client: TestClient, headers: dict[str, str], version_id: str
) -> dict[str, Any]:
    return client.get(f"{API}/generation-versions/{version_id}", headers=headers).json()  # type: ignore[no-any-return]


@pytest.mark.usefixtures("llm")
def test_edit_creates_a_new_version_that_must_be_rechecked(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    assert ids["status"] == "checks_completed"
    edit = {
        "title_candidates": ["我改过的标题"],
        "body": "我自己改的正文，木质香调很温柔。",
        "hashtags": ["日常香氛"],
        "cover_candidates": ["我的封面"],
    }
    r = client.post(
        f"{API}/generation-versions/{ids['version']}/edit", headers=h, json=edit
    )
    assert r.status_code == 201, r.text
    new = r.json()
    assert (new["version_no"], new["origin"], new["flow_status"]) == (
        2,
        "edited",
        "edited_pending_recheck",
    )
    assert new["parent_version_id"] == ids["version"] and new["model"] is None
    assert new["title_candidates"] == ["我改过的标题"]
    old = _version(client, h, ids["version"])
    assert (
        old["flow_status"] == "checks_completed"
        and old["title_candidates"][0] == "通勤路上的清爽"
    )  # untouched
    task = client.get(f"{API}/tasks/{ids['task']}", headers=h).json()
    assert (task["flow_status"], task["latest_version_id"]) == (
        "edited_pending_recheck",
        new["id"],
    )

    # An edited text cannot be confirmed until it was checked.
    blocked = client.post(
        f"{API}/generation-versions/{new['id']}/confirm",
        headers=h,
        json={"selected_title_index": 0},
    )
    assert blocked.status_code == 409

    for bad in (
        {**edit, "title_candidates": []},
        {**edit, "body": "  "},
        {"body": "x"},
        {**edit, "hashtags": ["t"] * 21},
    ):
        assert (
            client.post(
                f"{API}/generation-versions/{new['id']}/edit", headers=h, json=bad
            ).status_code
            == 422
        )
    db.expire_all()
    assert "version.edit" in [
        a.action
        for a in db.exec(
            select(AuditLog).where(AuditLog.entity_id == uuid.UUID(new["id"]))
        ).all()
    ]


@pytest.mark.usefixtures("llm")
def test_recheck_runs_all_checks_on_the_edited_text(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    edited = client.post(
        f"{API}/generation-versions/{ids['version']}/edit",
        headers=h,
        json={
            "title_candidates": ["新标题"],
            "body": "改后的正文，木质香调清爽。",
            "hashtags": ["日常"],
        },
    ).json()
    llm.requests.clear()

    r = client.post(f"{API}/generation-versions/{edited['id']}/recheck", headers=h)
    assert r.status_code == 202 and r.json()["flow_status"] == "checking"
    assert [x.purpose for x in llm.requests] == [
        "claim_extraction",
        "compliance_context",
    ]
    assert _version(client, h, edited["id"])["flow_status"] == "checks_completed"
    assert (
        client.get(f"{API}/tasks/{ids['task']}", headers=h).json()["flow_status"]
        == "checks_completed"
    )

    # Required words and forbidden words are enforced on the edit too.
    bad = client.post(
        f"{API}/generation-versions/{edited['id']}/edit",
        headers=h,
        json={
            "title_candidates": ["新标题"],
            "body": "这里没有必含词",
            "hashtags": ["日常"],
        },
    ).json()
    client.post(f"{API}/generation-versions/{bad['id']}/recheck", headers=h)
    failed = _version(client, h, bad["id"])
    assert (
        failed["flow_status"] == "constraint_failed"
        and failed["constraint_checks"]["passed"] is False
    )


@pytest.mark.usefixtures("llm")
def test_recheck_states_and_model_outage(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    llm.answers["claim_extraction"] = ModelUnavailableError("down")  # type: ignore[attr-defined]
    r = client.post(f"{API}/generation-versions/{ids['version']}/recheck", headers=h)
    assert r.status_code == 202
    assert (
        _version(client, h, ids["version"])["flow_status"] == "checking"
    )  # kept, not lost
    task = client.get(f"{API}/tasks/{ids['task']}", headers=h).json()
    assert (task["flow_status"], task["last_error"]) == (
        "checking",
        "model_unavailable",
    )

    llm.answers["claim_extraction"] = json.dumps({"claims": []})  # type: ignore[attr-defined]
    assert (
        client.post(
            f"{API}/generation-versions/{ids['version']}/recheck", headers=h
        ).status_code
        == 202
    )
    task = client.get(f"{API}/tasks/{ids['task']}", headers=h).json()
    assert (task["flow_status"], task["last_error"]) == ("checks_completed", None)

    ok = client.post(
        f"{API}/generation-versions/{ids['version']}/confirm",
        headers=h,
        json={"selected_title_index": 0},
    )
    assert ok.status_code == 200
    final = client.post(
        f"{API}/generation-versions/{ids['version']}/recheck", headers=h
    )
    assert final.status_code == 409  # a confirmed version is final


@pytest.mark.usefixtures("llm")
def test_confirm_requires_the_contract_conditions(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    url = f"{API}/generation-versions/{ids['version']}/confirm"

    assert (
        client.post(url, headers=h, json={"selected_title_index": 5}).status_code == 422
    )  # out of range
    assert (
        client.post(
            url, headers=h, json={"selected_title_index": 0, "selected_cover_index": 9}
        ).status_code
        == 422
    )
    assert (
        client.post(url, headers=h, json={"selected_title_index": -1}).status_code
        == 422
    )
    assert client.post(url, headers=h, json={}).status_code == 422

    # An open block-level hint stops the confirmation until a person has dealt with it.
    db.add(
        ComplianceCheck(
            version_id=uuid.UUID(ids["version"]),
            brand_id=uuid.UUID(ids["brand"]),
            layer="lexicon",
            severity="block",
            field="body",
            span_start=0,
            span_end=2,
            matched_text="最好",
            suggestion="改掉",
        )
    )
    db.commit()
    blocked = client.post(url, headers=h, json={"selected_title_index": 0})
    assert blocked.status_code == 409 and "高风险" in blocked.json()["error"]["message"]
    check = client.get(
        f"{API}/generation-versions/{ids['version']}/compliance", headers=h
    ).json()["items"][0]
    client.post(
        f"{API}/compliance-checks/{check['id']}/resolve",
        headers=h,
        json={"note": "品牌方确认"},
    )

    done = client.post(
        url, headers=h, json={"selected_title_index": 1, "selected_cover_index": 0}
    )
    assert done.status_code == 200
    body = done.json()
    assert (
        body["flow_status"],
        body["selected_title_index"],
        body["selected_cover_index"],
    ) == ("ready_to_copy", 1, 0)
    assert body["confirmed_at"]
    assert (
        client.get(f"{API}/tasks/{ids['task']}", headers=h).json()["flow_status"]
        == "ready_to_copy"
    )
    assert (
        client.post(url, headers=h, json={"selected_title_index": 0}).status_code == 409
    )  # already confirmed
    db.expire_all()
    assert "version.confirm" in [
        a.action
        for a in db.exec(
            select(AuditLog).where(AuditLog.entity_id == uuid.UUID(ids["version"]))
        ).all()
    ]


@pytest.mark.usefixtures("llm")
@pytest.mark.usefixtures("llm")
def test_only_the_latest_version_can_be_confirmed(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    client.post(
        f"{API}/generation-versions/{ids['version']}/edit",
        headers=h,
        json={"title_candidates": ["t"], "body": "木质香调", "hashtags": ["a"]},
    )
    old = client.post(
        f"{API}/generation-versions/{ids['version']}/confirm",
        headers=h,
        json={"selected_title_index": 0},
    )
    assert old.status_code == 409 and "latest" in old.json()["error"]["message"]


@pytest.mark.usefixtures("llm")
def test_export_formats_and_state_limit(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    h = superuser_token_headers
    llm.answers["generate"] = _note("**早上**出门喷一下  \n木质香调很柔和 😀")  # type: ignore[attr-defined]
    ids = _generated(client, h)
    export = f"{API}/generation-versions/{ids['version']}/export"

    assert (
        client.get(f"{export}?format=xhs_parts", headers=h).status_code == 409
    )  # not confirmed yet
    client.post(
        f"{API}/generation-versions/{ids['version']}/confirm",
        headers=h,
        json={"selected_title_index": 1},
    )

    parts = client.get(f"{export}?format=xhs_parts", headers=h).json()
    assert parts["format"] == "xhs_parts" and parts["title"] == "木质香调小记"
    assert (
        parts["body"] == "早上出门喷一下\n木质香调很柔和 😀"
    )  # LF, no trailing spaces, no markdown
    assert parts["tags"] == ["日常香氛", "通勤好物"]  # no leading '#'
    counts = parts["counts"]
    assert (
        counts["tags_count"] == 2
        and counts["tags_visible_units"] == 12
        and counts["body_units"] > 10
    )
    assert counts["title_weight"] == 6
    assert "封面" not in json.dumps(
        parts, ensure_ascii=False
    )  # covers are not part of the three parts

    md = client.get(f"{export}?format=markdown", headers=h).json()
    assert md["format"] == "markdown"
    assert md["content"].startswith("# 木质香调小记\n\n早上出门喷一下")
    assert "#日常香氛 #通勤好物" in md["content"] and "- 清爽一整天" in md["content"]
    assert client.get(f"{export}?format=pdf", headers=h).status_code == 422
    assert client.get(export, headers=h).status_code == 422


@pytest.mark.usefixtures("llm")
def test_rewriting_one_part_creates_a_checked_new_version(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    llm.requests.clear()
    r = client.post(
        f"{API}/generation-versions/{ids['version']}/rewrite",
        headers=h,
        json={"target": "body", "instruction": "语气再轻松一点"},
    )
    assert r.status_code == 202, r.text
    new = r.json()
    assert (new["version_no"], new["origin"]) == (2, "rewritten") and new[
        "parent_version_id"
    ] == ids["version"]
    asked = [x for x in llm.requests if x.purpose == "rewrite"][0].messages[1].content
    assert "只重写“正文”" in asked and "语气再轻松一点" in asked
    assert [x.purpose for x in llm.requests] == [
        "rewrite",
        "claim_extraction",
        "compliance_context",
    ]
    after = _version(client, h, new["id"])
    assert (
        after["flow_status"] == "checks_completed"
        and after["body"] == "改写后的正文，木质香调更柔和。"
    )
    assert _version(client, h, ids["version"])["body"].startswith(
        "早上出门"
    )  # the old version is untouched
    db.expire_all()
    assert db.get(Task, uuid.UUID(ids["task"])).latest_version_id == uuid.UUID(
        new["id"]
    )  # type: ignore[union-attr]

    for bad in (
        {"target": "everything"},
        {"target": "body", "instruction": "x" * 501},
        {},
    ):
        assert (
            client.post(
                f"{API}/generation-versions/{ids['version']}/rewrite",
                headers=h,
                json=bad,
            ).status_code
            == 422
        )


@pytest.mark.usefixtures("llm")
def test_a_failed_rewrite_stores_nothing(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    llm.answers["rewrite"] = ModelUnavailableError("down")  # type: ignore[attr-defined]
    r = client.post(
        f"{API}/generation-versions/{ids['version']}/rewrite",
        headers=h,
        json={"target": "titles"},
    )
    assert r.status_code == 503
    versions = client.get(f"{API}/tasks/{ids['task']}/versions", headers=h).json()[
        "items"
    ]
    assert [v["version_no"] for v in versions] == [1]
    assert (
        client.get(f"{API}/tasks/{ids['task']}", headers=h).json()["latest_version_id"]
        == ids["version"]
    )


@pytest.mark.usefixtures("llm")
def test_version_actions_are_isolated_between_brands(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    member, member_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, h, ids["brand"], member, "editor")
    base = f"{API}/generation-versions/{ids['version']}"
    payloads = {
        "edit": {"title_candidates": ["t"], "body": "b", "hashtags": []},
        "recheck": None,
        "rewrite": {"target": "body"},
        "confirm": {"selected_title_index": 0},
    }
    for action, payload in payloads.items():
        assert (
            client.post(
                f"{base}/{action}", headers=outsider_headers, json=payload
            ).status_code
            == 404
        ), action
        assert client.post(f"{base}/{action}", json=payload).status_code == 401, action
        assert (
            client.post(
                f"{API}/generation-versions/{uuid.uuid4()}/{action}",
                headers=member_headers,
                json=payload,
            ).status_code
            == 404
        )
    assert (
        client.get(
            f"{base}/export?format=markdown", headers=outsider_headers
        ).status_code
        == 404
    )
    # An editor of the brand may confirm (any member can; the audit trail records who).
    assert (
        client.post(
            f"{base}/confirm", headers=member_headers, json={"selected_title_index": 0}
        ).status_code
        == 200
    )
