"""Fields the frontend asked for (B's review): names on task lists, source titles on evidence, source links on
risk hints, and structured reasons when an action is refused. Needs the database."""

import json
import uuid
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
from app.models import Brand, ComplianceCheck, ComplianceRule, Tenant
from app.services.compliance import ensure_sample_rules
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _create_brand

API = settings.API_V1_STR

pytestmark = pytest.mark.usefixtures("llm")
SPEC = "晨雾淡香水的前调为柑橘与佛手柑，香调清新。"
NOTE = json.dumps(
    {
        "title_candidates": ["通勤路上的清爽"],
        "body": "前调是柑橘与佛手柑，木质香调很柔和。",
        "hashtags": ["日常"],
        "cover_candidates": ["清爽"],
    },
    ensure_ascii=False,
)


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    ensure_sample_rules(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(ComplianceRule).where(ComplianceRule.is_sample.is_(False)))  # type: ignore[attr-defined]
    db.execute(delete(Tenant))
    db.commit()


@pytest.fixture
def llm() -> Generator[FakeLlmClient]:
    answers: dict[str, Any] = {
        "generate": NOTE,
        "claim_extraction": json.dumps(
            {"claims": ["前调是柑橘与佛手柑"]}, ensure_ascii=False
        ),
        "evidence_judgement": json.dumps(
            {
                "verdict": "supported",
                "source_ref": "C1",
                "quote": "前调为柑橘与佛手柑",
                "rationale": "有",
            },
            ensure_ascii=False,
        ),
        "compliance_context": json.dumps({"findings": []}),
    }
    fake = FakeLlmClient(responder=lambda request: answers[request.purpose])
    embedder = FakeEmbeddingProvider()
    app.dependency_overrides[get_llm_factory] = lambda: lambda _b, _t: fake
    app.dependency_overrides[get_embedder] = lambda: embedder
    yield fake
    app.dependency_overrides.pop(get_llm_factory, None)
    app.dependency_overrides.pop(get_embedder, None)


def _generated(client: TestClient, h: dict[str, str], **task: Any) -> dict[str, Any]:
    brand = _create_brand(client, h)
    client.post(
        f"{API}/brands/{brand['id']}/knowledge-documents",
        headers=h,
        data={"title": "晨雾商品资料", "doc_type": "product_spec"},
        files={"file": ("spec.md", SPEC.encode(), "text/markdown")},
    )
    product = client.post(
        f"{API}/brands/{brand['id']}/products", headers=h, json={"name": "晨雾"}
    ).json()
    scenario = next(
        s
        for s in client.get(f"{API}/scenarios", headers=h).json()["items"]
        if s["scene"] == "review"
    )
    created = client.post(
        f"{API}/tasks",
        headers=h,
        json={
            "brand_id": brand["id"],
            "product_id": product["id"],
            "scenario_id": scenario["id"],
            **task,
        },
    ).json()
    client.post(f"{API}/tasks/{created['id']}/generate", headers=h)
    detail = client.get(f"{API}/tasks/{created['id']}", headers=h).json()
    return {
        "brand": brand["id"],
        "task": created["id"],
        "version": detail["latest_version_id"],
        "scenario": scenario,
    }


def test_task_list_detail_and_generate_responses_name_the_product_and_scenario(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    expected = {
        "product_name": "晨雾",
        "scenario_name": ids["scenario"]["name"],
        "scene": "review",
    }

    listed = client.get(f"{API}/tasks?brand_id={ids['brand']}", headers=h).json()[
        "items"
    ][0]
    assert {k: listed[k] for k in expected} == expected
    assert listed["flow_status"] and listed["latest_version_id"] == ids["version"]
    detail = client.get(f"{API}/tasks/{ids['task']}", headers=h).json()
    assert {k: detail[k] for k in expected} == expected

    again = client.post(
        f"{API}/tasks/{ids['task']}/generate", headers=h
    )  # refused: already checked
    assert again.status_code == 409
    assert again.json()["error"]["details"]["current_state"] == detail["flow_status"]


def test_evidence_names_its_source_document(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    items = client.get(
        f"{API}/generation-versions/{ids['version']}/evidence", headers=h
    ).json()["items"]
    supported = next(i for i in items if i["status"] == "system_supported")
    assert (
        supported["source_title"] == "晨雾商品资料"
        and supported["quote"] == "前调为柑橘与佛手柑"
    )
    detail = client.get(f"{API}/generation-versions/{ids['version']}", headers=h).json()
    assert detail["claim_evidence"][0]["source_title"] == "晨雾商品资料"
    confirmed = client.post(
        f"{API}/claim-evidence/{supported['id']}/confirm",
        headers=h,
        json={"human_confirmed": True},
    ).json()
    assert confirmed["source_title"] == "晨雾商品资料"


def test_task_material_evidence_is_titled_with_the_file_name(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ids = _generated(
        client,
        h,
        task_materials=[
            {"filename": "临时资料.txt", "text": "前调是柑橘与佛手柑，运营补充说明。"}
        ],
    )
    items = client.get(
        f"{API}/generation-versions/{ids['version']}/evidence", headers=h
    ).json()["items"]
    assert items and all(
        i["source_title"] in ("晨雾商品资料", "临时资料.txt", None) for i in items
    )
    assert {i["source_level"] for i in items} <= {"approved_kb", "task_material", None}


def test_risk_hints_carry_the_rules_source_link(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    rule = client.post(
        f"{API}/brands/{ids['brand']}/compliance-rules",
        headers=h,
        json={
            "layer": "lexicon",
            "rule_type": "brand_forbidden",
            "pattern": "柑橘",
            "severity": "warn",
            "source_name": "品牌内部规定",
            "source_url": "https://example.test/rules/1",
        },
    ).json()
    db.add(
        ComplianceCheck(
            version_id=uuid.UUID(ids["version"]),
            brand_id=uuid.UUID(ids["brand"]),
            rule_id=uuid.UUID(rule["id"]),
            layer="lexicon",
            severity="warn",
            field="body",
            span_start=3,
            span_end=5,
            matched_text="柑橘",
            source_name="品牌内部规定",
        )
    )
    db.add(
        ComplianceCheck(
            version_id=uuid.UUID(ids["version"]),
            brand_id=uuid.UUID(ids["brand"]),
            layer="context",
            severity="warn",
            field="body",
            span_start=0,
            span_end=2,
            matched_text="前调",
            source_name="模型语境判断",
        )
    )
    db.commit()

    items = client.get(
        f"{API}/generation-versions/{ids['version']}/compliance", headers=h
    ).json()["items"]
    by_text = {i["matched_text"]: i for i in items}
    assert by_text["柑橘"]["source_url"] == "https://example.test/rules/1"
    assert by_text["前调"]["source_url"] is None  # found by the model: no rule, no link
    resolved = client.post(
        f"{API}/compliance-checks/{by_text['柑橘']['id']}/resolve",
        headers=h,
        json={"note": "已看"},
    )
    assert resolved.json()["source_url"] == "https://example.test/rules/1"


def test_refusals_explain_themselves_with_structured_details(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    h = superuser_token_headers
    ids = _generated(client, h)
    version = f"{API}/generation-versions/{ids['version']}"

    db.add(
        ComplianceCheck(
            version_id=uuid.UUID(ids["version"]),
            brand_id=uuid.UUID(ids["brand"]),
            layer="lexicon",
            severity="block",
            field="body",
            span_start=0,
            span_end=2,
            matched_text="前调",
            suggestion="改",
        )
    )
    db.commit()
    blocked = client.post(
        f"{version}/confirm", headers=h, json={"selected_title_index": 0}
    )
    assert blocked.status_code == 409
    error = blocked.json()["error"]
    assert error["code"] == "INVALID_STATE"
    assert error["details"]["current_state"] == "checks_completed"
    assert (
        isinstance(error["details"]["reasons"], list)
        and len(error["details"]["reasons"]) == 1
    )
    assert error["message"] == "；".join(error["details"]["reasons"])
    assert error["details"]["codes"] == ["open_block_risks"]

    edited = client.post(
        f"{version}/edit",
        headers=h,
        json={"title_candidates": ["t"], "body": "木质香调", "hashtags": ["a"]},
    ).json()
    old = client.post(
        f"{version}/confirm", headers=h, json={"selected_title_index": 0}
    ).json()["error"]["details"]
    assert old["codes"] == ["not_latest_version"]
    pending = client.post(
        f"{API}/generation-versions/{edited['id']}/confirm",
        headers=h,
        json={"selected_title_index": 0},
    )
    assert (
        pending.json()["error"]["details"]["current_state"] == "edited_pending_recheck"
    )
    assert client.get(
        f"{API}/generation-versions/{edited['id']}/export?format=markdown", headers=h
    ).json()["error"]["details"] == {"current_state": "edited_pending_recheck"}
