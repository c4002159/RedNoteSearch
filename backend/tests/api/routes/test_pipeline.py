"""The checking pipeline after generation: states, automatic rewrite and its limits. Needs the database."""

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
from app.domain.flow import FlowStatus
from app.fakes.embedding import FakeEmbeddingProvider
from app.fakes.llm import FakeLlmClient
from app.main import app
from app.models import (
    AuditLog,
    Brand,
    ClaimEvidence,
    ComplianceCheck,
    GenerationVersion,
    Task,
    Tenant,
)
from app.services.compliance import ensure_sample_rules
from app.services.errors import ModelUnavailableError
from app.services.knowledge_search import DbKnowledgeSearch
from app.services.pipeline import PipelineDeps, run_checks
from app.services.scenarios import ensure_default_scenarios
from app.services.voice_profiles import DbVoiceProfileProvider
from tests.api.routes.test_brands import _create_brand

API = settings.API_V1_STR


def _note(body: str, *, title: str = "通勤路上的清爽") -> str:
    return json.dumps(
        {
            "title_candidates": [title, "木质香调小记"],
            "body": body,
            "hashtags": ["日常香氛"],
            "cover_candidates": ["清爽一整天"],
        },
        ensure_ascii=False,
    )


CLEAN = _note("早上出门前喷一下，木质香调很柔和。")
RISKY = _note(
    "这是最好的木质香调，也是第一名的选择。"
)  # sample rules flag both words (block)
NO_CLAIMS = json.dumps({"claims": []})
NO_FINDINGS = json.dumps({"findings": []})
LONG_TITLE = json.dumps(
    {"title_candidates": ["字" * 21], "body": "木质香调", "hashtags": ["日常"]},
    ensure_ascii=False,
)


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    ensure_sample_rules(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


def _llm(script: list[str | Exception]) -> Generator[FakeLlmClient]:
    llm = FakeLlmClient(script)
    embedder = FakeEmbeddingProvider()
    app.dependency_overrides[get_llm_factory] = lambda: lambda _b, _t: llm
    app.dependency_overrides[get_embedder] = lambda: embedder
    yield llm
    app.dependency_overrides.pop(get_llm_factory, None)
    app.dependency_overrides.pop(get_embedder, None)


@pytest.fixture
def llm() -> Generator[FakeLlmClient]:
    yield from _llm([CLEAN])


def _run(
    client: TestClient, headers: dict[str, str]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
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
    versions = client.get(f"{API}/tasks/{task['id']}/versions", headers=headers).json()[
        "items"
    ]
    return detail, versions


def test_a_clean_note_ends_with_checks_completed(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    llm._script = [CLEAN, NO_CLAIMS, NO_FINDINGS]  # noqa: SLF001
    task, versions = _run(client, superuser_token_headers)
    assert (task["flow_status"], task["progress"]) == (
        "checks_completed",
        {"stage": "done"},
    )
    assert [(v["version_no"], v["origin"], v["flow_status"]) for v in versions] == [
        (1, "generated", "checks_completed")
    ]
    assert [r.purpose for r in llm.requests] == [
        "generate",
        "claim_extraction",
        "compliance_context",
    ]
    assert task["latest_version_id"] == versions[0]["id"]


def test_unsupported_claims_need_a_person_and_a_confirmation_clears_them(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
) -> None:
    claims = json.dumps({"claims": ["木质香调很柔和"]}, ensure_ascii=False)
    llm._script = [CLEAN, claims, NO_FINDINGS]  # noqa: SLF001
    task, versions = _run(client, superuser_token_headers)
    assert task["flow_status"] == "needs_human_review"  # no source backs the claim
    version_id = uuid.UUID(versions[0]["id"])
    evidence = db.exec(
        select(ClaimEvidence).where(ClaimEvidence.version_id == version_id)
    ).one()
    assert evidence.status == "evidence_missing"

    confirmed = client.post(
        f"{API}/claim-evidence/{evidence.id}/confirm",
        headers=superuser_token_headers,
        json={"human_confirmed": True, "note": "已核实"},
    )
    assert confirmed.status_code == 200

    # Checking again finds the same claim; the person's decision is kept, so nothing is open any more.
    db.expire_all()
    version = db.get(GenerationVersion, version_id)
    task_row = db.get(Task, uuid.UUID(task["id"]))
    assert version is not None and task_row is not None
    llm.requests.clear()
    llm._script = [claims, NO_FINDINGS]  # noqa: SLF001
    deps = PipelineDeps(
        llm=llm,
        search=DbKnowledgeSearch(db, FakeEmbeddingProvider()),
        voices=DbVoiceProfileProvider(db),
    )
    outcome = run_checks(session=db, task=task_row, version=version, deps=deps)
    assert (outcome.status, outcome.open_evidence) == (FlowStatus.CHECKS_COMPLETED, 0)
    row = db.exec(
        select(ClaimEvidence).where(ClaimEvidence.version_id == version_id)
    ).one()
    assert row.status == "evidence_missing"  # the system's judgement is unchanged
    assert (row.human_confirmed, row.confirm_note) == (True, "已核实")


def test_block_level_hints_trigger_a_bounded_automatic_rewrite(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    llm: FakeLlmClient,
) -> None:
    llm._script = [  # noqa: SLF001
        RISKY,
        NO_CLAIMS,
        NO_FINDINGS,  # version 1 is flagged
        CLEAN,
        NO_CLAIMS,
        NO_FINDINGS,  # the rewrite is clean
    ]
    task, versions = _run(client, superuser_token_headers)
    assert [(v["version_no"], v["origin"], v["flow_status"]) for v in versions] == [
        (1, "generated", "needs_human_review"),
        (2, "rewritten", "checks_completed"),
    ]
    assert versions[1]["parent_version_id"] == versions[0]["id"]
    assert (
        task["flow_status"] == "checks_completed"
        and task["latest_version_id"] == versions[1]["id"]
    )
    rewrite = next(r for r in llm.requests if r.purpose == "rewrite")
    text = rewrite.messages[1].content
    assert "「最好」" in text and "「第一」" in text and "需要处理的问题" in text
    assert versions[1]["prompt_version"] == versions[0]["prompt_version"]
    assert versions[1]["retrieved_sources"] == versions[0]["retrieved_sources"]
    db.expire_all()
    actions = [
        a.action
        for a in db.exec(select(AuditLog).where(AuditLog.entity_id.is_not(None))).all()
    ]  # type: ignore[attr-defined]
    assert "version.auto_rewrite" in actions
    first_hints = db.exec(
        select(ComplianceCheck).where(
            ComplianceCheck.version_id == uuid.UUID(versions[0]["id"])
        )
    ).all()
    assert {c.matched_text for c in first_hints} >= {
        "最好",
        "第一",
    }  # the old version keeps its hints


def test_rewriting_stops_after_two_rounds(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    answers = {
        "generate": RISKY,
        "rewrite": RISKY,  # the model never fixes the problem
        "claim_extraction": NO_CLAIMS,
        "compliance_context": NO_FINDINGS,
    }
    llm._responder = lambda request: answers[request.purpose]  # noqa: SLF001
    task, versions = _run(client, superuser_token_headers)
    assert [v["origin"] for v in versions] == [
        "generated",
        "rewritten",
        "rewritten",
    ]  # 1 + 2 rewrites, no more
    assert len([r for r in llm.requests if r.purpose == "rewrite"]) == 2
    assert task["flow_status"] == "needs_human_review"
    assert versions[-1]["flow_status"] == "needs_human_review"


def test_a_rewrite_that_breaks_the_constraints_ends_as_constraint_failed(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    llm._script = [RISKY, NO_CLAIMS, NO_FINDINGS, LONG_TITLE]  # noqa: SLF001
    task, versions = _run(client, superuser_token_headers)
    assert [(v["origin"], v["flow_status"]) for v in versions] == [
        ("generated", "needs_human_review"),
        ("rewritten", "constraint_failed"),
    ]
    assert task["flow_status"] == "constraint_failed"
    assert versions[1]["constraint_checks"]["passed"] is False


def test_a_model_outage_while_checking_keeps_the_version_in_checking(
    client: TestClient, superuser_token_headers: dict[str, str], llm: FakeLlmClient
) -> None:
    llm._script = [CLEAN, ModelUnavailableError("down")]  # noqa: SLF001
    task, versions = _run(client, superuser_token_headers)
    assert [v["flow_status"] for v in versions] == [
        "checking"
    ]  # stored, waiting to be checked again
    assert (task["flow_status"], task["last_error"]) == (
        "checking",
        "model_unavailable",
    )
    assert task["latest_version_id"] == versions[0]["id"]
