"""The revise endpoint is atomic, member-scoped and checks only its final child."""

import json
import uuid
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.routes.tasks import get_version_access
from app.core.config import settings
from app.fakes.llm import FakeLlmClient
from app.main import app
from app.models import AuditLog, ClaimEvidence, GenerationVersion, Task
from app.services.errors import ModelUnavailableError
from tests.api.routes.test_brands import _add_member, _make_user
from tests.api.routes.test_versions import _generated, _note, _version
from tests.api.routes.test_versions import cleanup as cleanup
from tests.api.routes.test_versions import llm as llm

API = settings.API_V1_STR
PARTS = {
    "parts": [
        {"target": "titles", "instruction": "短标题"},
        {"target": "body", "instruction": "语气温和"},
    ],
    "note": "只使用现有来源",
}


def count_versions(
    client: TestClient, headers: dict[str, str], task_id: str
) -> list[dict[str, Any]]:
    return client.get(f"{API}/tasks/{task_id}/versions", headers=headers).json()[
        "items"
    ]  # type: ignore[no-any-return]


def test_revise_creates_one_version_and_checks_once(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    old = _version(client, h, ids["version"])
    llm.requests.clear()
    response = client.post(
        f"{API}/generation-versions/{ids['version']}/revise", headers=h, json=PARTS
    )
    assert response.status_code == 202, response.text
    child = response.json()
    assert child["parent_version_id"] == ids["version"]
    assert (child["version_no"], child["origin"], child["flow_status"]) == (
        2,
        "rewritten",
        "checking",
    )
    assert len(count_versions(client, h, ids["task"])) == 2
    assert [request.purpose for request in llm.requests] == [
        "rewrite",
        "rewrite",
        "claim_extraction",
        "compliance_context",
    ]
    assert _version(client, h, child["id"])["flow_status"] == "checks_completed"
    assert _version(client, h, ids["version"])["body"] == old["body"]
    db.expire_all()
    assert db.get(Task, uuid.UUID(ids["task"])).latest_version_id == uuid.UUID(
        child["id"]
    )  # type: ignore[union-attr]


def test_note_only_explicitly_rewrites_body_once(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    llm.requests.clear()
    response = client.post(
        f"{API}/generation-versions/{ids['version']}/revise",
        headers=h,
        json={"note": "正文更简洁"},
    )
    assert response.status_code == 202, response.text
    assert len(count_versions(client, h, ids["task"])) == 2
    assert [request.purpose for request in llm.requests] == [
        "rewrite",
        "claim_extraction",
        "compliance_context",
    ]
    assert "只重写“正文”" in llm.requests[0].messages[1].content
    assert "正文更简洁" in llm.requests[0].messages[1].content


@pytest.mark.parametrize("with_parts", [False, True])
def test_edited_note_creates_one_rewritten_child_and_private_audit(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
    with_parts: bool,
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    manual = {
        "title_candidates": [" 手写标题 ", " "],
        "body": "手写正文，木质香调清爽。",
        "hashtags": [" 日常 ", " "],
        "cover_candidates": [" 封面 ", " "],
    }
    llm.requests.clear()
    response = client.post(
        f"{API}/generation-versions/{ids['version']}/revise",
        headers=h,
        json={
            "edited_note": manual,
            "parts": [{"target": "titles"}] if with_parts else [],
        },
    )
    assert response.status_code == 202, response.text
    child = response.json()
    assert (
        child["origin"] == "rewritten" and child["parent_version_id"] == ids["version"]
    )
    assert len(count_versions(client, h, ids["task"])) == 2
    purposes = [request.purpose for request in llm.requests]
    assert purposes == (["rewrite"] if with_parts else []) + [
        "claim_extraction",
        "compliance_context",
    ]
    if with_parts:
        assert manual["body"] in llm.requests[0].messages[1].content
    else:
        assert child["body"] == manual["body"]
        assert child["title_candidates"] == ["手写标题"] and child["hashtags"] == [
            "日常"
        ]
        assert child["cover_candidates"] == ["封面"] and child["model"] is None
    db.expire_all()
    events = db.exec(
        select(AuditLog).where(AuditLog.entity_id == uuid.UUID(child["id"]))
    ).all()
    assert {event.action for event in events} == {
        "version.revise",
        "version.revise.manual_edit",
    }
    assert manual["body"] not in str([event.detail for event in events])


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"parts": []},
        {"note": " "},
        {"parts": [{"target": "body"}] * 2},
        {"edited_note": {"title_candidates": ["t"], "body": " "}},
        {"edited_note": {"title_candidates": [" "], "body": "b"}},
    ],
)
def test_revision_validation_is_atomic(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
    payload: dict[str, Any],
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    llm.requests.clear()
    response = client.post(
        f"{API}/generation-versions/{ids['version']}/revise", headers=h, json=payload
    )
    assert response.status_code == 422
    assert not llm.requests and len(count_versions(client, h, ids["task"])) == 1


@pytest.mark.parametrize(
    "failure,status,code",
    [
        (ModelUnavailableError("down"), 503, "MODEL_UNAVAILABLE"),
        ("{}", 422, "INVALID_MODEL_OUTPUT"),
    ],
)
def test_later_part_failure_leaves_no_child_or_audit(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
    failure: Exception | str,
    status: int,
    code: str,
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    llm.requests.clear()
    answers: list[str | Exception] = [_note(), failure]

    def responder(_: Any) -> str | Exception:
        return answers.pop(0) if len(answers) > 1 else answers[0]

    llm._responder = responder
    response = client.post(
        f"{API}/generation-versions/{ids['version']}/revise", headers=h, json=PARTS
    )
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert "title_candidates" not in response.text
    assert len(count_versions(client, h, ids["task"])) == 1
    task = client.get(f"{API}/tasks/{ids['task']}", headers=h).json()
    assert task["latest_version_id"] == ids["version"]
    assert all(request.purpose == "rewrite" for request in llm.requests)
    db.expire_all()
    assert not db.exec(
        select(AuditLog).where(
            AuditLog.action == "version.revise",
            AuditLog.brand_id == uuid.UUID(ids["brand"]),
        )
    ).all()


@pytest.mark.parametrize("resource", ["task", "version"])
def test_generating_returns_409_before_rewrite(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
    resource: str,
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    row = (
        db.get(Task, uuid.UUID(ids["task"]))
        if resource == "task"
        else db.get(GenerationVersion, uuid.UUID(ids["version"]))
    )
    assert row is not None
    row.flow_status = "generating"
    db.add(row)
    db.commit()
    llm.requests.clear()
    response = client.post(
        f"{API}/generation-versions/{ids['version']}/revise", headers=h, json=PARTS
    )
    assert response.status_code == 409
    assert not llm.requests and len(count_versions(client, h, ids["task"])) == 1


def test_revision_reuses_member_scope_and_hides_other_brands(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
) -> None:
    assert llm.requests == []
    h = superuser_token_headers
    ids = _generated(client, h)
    member, member_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, h, ids["brand"], member, "editor")
    url = f"{API}/generation-versions/{ids['version']}/revise"
    assert client.post(url, json=PARTS).status_code == 401
    assert client.post(url, headers=outsider_headers, json=PARTS).status_code == 404
    assert (
        client.post(
            f"{API}/generation-versions/{uuid.uuid4()}/revise",
            headers=member_headers,
            json=PARTS,
        ).status_code
        == 404
    )
    assert client.post(url, headers=member_headers, json=PARTS).status_code == 202


def test_dependency_403_is_preserved_without_running_models(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    ids = _generated(client, superuser_token_headers)
    llm.requests.clear()

    def forbidden() -> None:
        raise HTTPException(status_code=403, detail="Access denied")

    app.dependency_overrides[get_version_access] = forbidden
    try:
        response = client.post(
            f"{API}/generation-versions/{ids['version']}/revise",
            headers=superuser_token_headers,
            json=PARTS,
        )
        assert response.status_code == 403 and response.json()["error"]["request_id"]
        assert not llm.requests
    finally:
        app.dependency_overrides.pop(get_version_access, None)


@pytest.mark.parametrize("decision", [True, False])
def test_revision_keeps_identical_claim_decisions_only(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
    decision: bool,
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    for text in ["木质香调", "已经删除的句子"]:
        db.add(
            ClaimEvidence(
                version_id=uuid.UUID(ids["version"]),
                brand_id=uuid.UUID(ids["brand"]),
                claim_text=text,
                status="evidence_missing",
                human_confirmed=decision,
                confirm_note="原版本的人工判断",
            )
        )
    db.commit()
    llm.answers["claim_extraction"] = json.dumps({"claims": ["木质香调"]})  # type: ignore[attr-defined]
    response = client.post(
        f"{API}/generation-versions/{ids['version']}/revise",
        headers=h,
        json={"parts": [{"target": "titles"}]},
    )
    assert response.status_code == 202, response.text
    rows = client.get(
        f"{API}/generation-versions/{response.json()['id']}/evidence", headers=h
    ).json()["items"]
    assert [
        (row["claim_text"], row["human_confirmed"], row["confirm_note"]) for row in rows
    ] == [("木质香调", decision, "原版本的人工判断")]
