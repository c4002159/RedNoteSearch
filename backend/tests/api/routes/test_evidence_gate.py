"""Confirming a version whose claims lack system support needs a person's decision on every one of them.

A person who vouches for a claim lets it through and the text is labelled accordingly; a rejected or
undecided claim blocks the confirmation. Needs the database.
"""

import json
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.api.routes.knowledge import get_embedder
from app.api.routes.tasks import get_llm_factory
from app.core.config import settings
from app.fakes.embedding import FakeEmbeddingProvider
from app.fakes.llm import FakeLlmClient
from app.main import app
from app.models import Brand, Tenant
from app.services.compliance import ensure_sample_rules
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _create_brand

API = settings.API_V1_STR
NOTE = json.dumps(
    {
        "title_candidates": ["通勤路上的清爽"],
        "body": "木质香调很柔和，据说获得过大奖，产自法国。",
        "hashtags": ["日常"],
        "cover_candidates": ["清爽"],
    },
    ensure_ascii=False,
)
CLAIMS = [
    "获得过大奖",
    "产自法国",
]  # no source in the knowledge base: the system cannot support them


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
    answers = {
        "generate": NOTE,
        "claim_extraction": json.dumps({"claims": CLAIMS}, ensure_ascii=False),
        "compliance_context": json.dumps({"findings": []}),
    }
    fake = FakeLlmClient(responder=lambda request: answers[request.purpose])
    embedder = FakeEmbeddingProvider()
    app.dependency_overrides[get_llm_factory] = lambda: lambda _b, _t: fake
    app.dependency_overrides[get_embedder] = lambda: embedder
    yield fake
    app.dependency_overrides.pop(get_llm_factory, None)
    app.dependency_overrides.pop(get_embedder, None)


def _generated(client: TestClient, h: dict[str, str]) -> dict[str, Any]:
    brand = _create_brand(client, h)
    product = client.post(
        f"{API}/brands/{brand['id']}/products", headers=h, json={"name": "晨雾"}
    ).json()
    scenario = client.get(f"{API}/scenarios", headers=h).json()["items"][0]
    task = client.post(
        f"{API}/tasks",
        headers=h,
        json={
            "brand_id": brand["id"],
            "product_id": product["id"],
            "scenario_id": scenario["id"],
        },
    ).json()
    client.post(f"{API}/tasks/{task['id']}/generate", headers=h)
    version = client.get(f"{API}/tasks/{task['id']}", headers=h).json()[
        "latest_version_id"
    ]
    evidence = client.get(
        f"{API}/generation-versions/{version}/evidence", headers=h
    ).json()["items"]
    return {"task": task["id"], "version": version, "evidence": evidence}


def _confirm(client: TestClient, h: dict[str, str], version: str) -> Any:
    return client.post(
        f"{API}/generation-versions/{version}/confirm",
        headers=h,
        json={"selected_title_index": 0},
    )


def _decide(
    client: TestClient,
    h: dict[str, str],
    evidence_id: str,
    confirmed: bool,
    note: str | None = None,
) -> None:
    r = client.post(
        f"{API}/claim-evidence/{evidence_id}/confirm",
        headers=h,
        json={"human_confirmed": confirmed, "note": note},
    )
    assert r.status_code == 200


@pytest.mark.usefixtures("llm")
def test_claims_without_support_block_the_confirmation_until_a_person_decides(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    assert [e["status"] for e in ids["evidence"]] == [
        "evidence_missing",
        "evidence_missing",
    ]
    version = client.get(
        f"{API}/generation-versions/{ids['version']}", headers=h
    ).json()
    assert version["flow_status"] == "needs_human_review"
    assert version["evidence_summary"] == {
        "total": 2,
        "system_supported": 0,
        "human_confirmed": 0,
        "unconfirmed": 2,
        "rejected": 0,
    }

    refused = _confirm(client, h, ids["version"])
    assert refused.status_code == 409
    details = refused.json()["error"]["details"]
    assert (
        details["codes"] == ["unconfirmed_claims"]
        and details["current_state"] == "needs_human_review"
    )
    assert "2 条" in details["reasons"][0]

    _decide(client, h, ids["evidence"][0]["id"], True, "品牌方提供了获奖证书")
    still = _confirm(client, h, ids["version"])
    assert (
        still.status_code == 409
        and "1 条" in still.json()["error"]["details"]["reasons"][0]
    )  # one left

    _decide(client, h, ids["evidence"][1]["id"], True, "产地信息已核实")
    summary = client.get(
        f"{API}/generation-versions/{ids['version']}", headers=h
    ).json()["evidence_summary"]
    assert (
        summary["human_confirmed"],
        summary["unconfirmed"],
        summary["rejected"],
    ) == (2, 0, 0)
    ok = _confirm(client, h, ids["version"])
    assert ok.status_code == 200 and ok.json()["flow_status"] == "ready_to_copy"
    # What the system said is untouched; only the person's decision was added.
    after = client.get(
        f"{API}/generation-versions/{ids['version']}/evidence", headers=h
    ).json()["items"]
    assert {(e["status"], e["human_confirmed"]) for e in after} == {
        ("evidence_missing", True)
    }


def test_a_claim_a_person_rejects_blocks_until_the_text_is_rewritten(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    _decide(client, h, ids["evidence"][0]["id"], True)
    _decide(client, h, ids["evidence"][1]["id"], False, "没有依据，不能写")

    refused = _confirm(client, h, ids["version"])
    assert refused.status_code == 409
    assert refused.json()["error"]["details"]["codes"] == ["rejected_claims"]
    assert (
        client.get(f"{API}/generation-versions/{ids['version']}", headers=h).json()[
            "evidence_summary"
        ]["rejected"]
        == 1
    )

    # The way out is to rewrite the text; the new version is checked from scratch.
    llm_answers_claims = json.dumps({"claims": ["获得过大奖"]}, ensure_ascii=False)
    llm._responder = lambda r: {  # noqa: SLF001
        "claim_extraction": llm_answers_claims,
        "compliance_context": json.dumps({"findings": []}),
    }[r.purpose]
    edited = client.post(
        f"{API}/generation-versions/{ids['version']}/edit",
        headers=h,
        json={
            "title_candidates": ["新标题"],
            "body": "木质香调很柔和，据说获得过大奖。",
            "hashtags": ["日常"],
        },
    ).json()
    client.post(f"{API}/generation-versions/{edited['id']}/recheck", headers=h)
    items = client.get(
        f"{API}/generation-versions/{edited['id']}/evidence", headers=h
    ).json()["items"]
    assert [i["claim_text"] for i in items] == ["获得过大奖"] and items[0][
        "human_confirmed"
    ] is None  # a new text, a new decision
    assert _confirm(client, h, edited["id"]).status_code == 409


@pytest.mark.usefixtures("llm")
def test_human_confirmed_claims_are_labelled_in_the_export(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    _decide(client, h, ids["evidence"][0]["id"], True, "品牌方提供了获奖证书")
    _decide(client, h, ids["evidence"][1]["id"], True)
    assert _confirm(client, h, ids["version"]).status_code == 200
    export = f"{API}/generation-versions/{ids['version']}/export"

    parts = client.get(f"{export}?format=xhs_parts", headers=h).json()
    assert parts["verification"] == {"system_supported": 0, "human_confirmed": 2}
    assert "人工" not in json.dumps(
        {k: parts[k] for k in ("title", "body", "tags")}, ensure_ascii=False
    )  # the copy text stays clean

    markdown = client.get(f"{export}?format=markdown", headers=h).json()["content"]
    assert "## 人工核对记录（资料里没有依据，由人工确认，不是系统验证）" in markdown
    assert "- 获得过大奖（人工确认：品牌方提供了获奖证书）" in markdown
    assert "- 产自法国（人工确认）" in markdown
    assert "已验证" not in markdown and "合规通过" not in markdown
