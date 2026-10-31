"""Evidence for a version: claims, judgement against real sources, and human confirmation.

Needs the database. The model is a scripted fake and embeddings are the deterministic fake.
"""

import json
import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.api.routes.knowledge import get_embedder
from app.core.config import settings
from app.fakes.embedding import FakeEmbeddingProvider
from app.fakes.llm import FakeLlmClient
from app.main import app
from app.models import AuditLog, Brand, ClaimEvidence, GenerationVersion, Task, Tenant
from app.services.errors import ModelUnavailableError
from app.services.evidence import (
    EvidenceDeps,
    check_evidence,
    summarize,
)
from app.services.knowledge_search import DbKnowledgeSearch
from app.services.llm_structured import LlmOutputError
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR
SOURCE_TEXT = "晨雾淡香水的前调为柑橘与佛手柑，香调清新。"


def _json(**data: object) -> str:
    return json.dumps(data, ensure_ascii=False)


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


@pytest.fixture
def embedder() -> Generator[FakeEmbeddingProvider]:
    fake = FakeEmbeddingProvider()
    app.dependency_overrides[get_embedder] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_embedder, None)


def _version(
    client: TestClient, db: Session, headers: dict[str, str], *, ingest: bool = True
) -> tuple[GenerationVersion, str]:
    brand = _create_brand(client, headers)
    if ingest:
        r = client.post(
            f"{API}/brands/{brand['id']}/knowledge-documents",
            headers=headers,
            data={"title": "商品资料", "doc_type": "product_spec"},
            files={"file": ("spec.md", SOURCE_TEXT.encode(), "text/markdown")},
        )
        assert r.status_code == 201, r.text
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
        },
    ).json()
    version = GenerationVersion(
        task_id=uuid.UUID(task["id"]),
        brand_id=uuid.UUID(brand["id"]),
        version_no=1,
        title_candidates=["晨雾的前调"],
        body="前调是柑橘与佛手柑，据说获得过大奖。",
        hashtags=["日常"],
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version, task["id"]


def _deps(
    db: Session, embedder: FakeEmbeddingProvider, script: list[str | Exception]
) -> EvidenceDeps:
    return EvidenceDeps(
        llm=FakeLlmClient(script), search=DbKnowledgeSearch(db, embedder)
    )


def test_supported_missing_and_unverifiable_claims_get_the_right_status(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    version, task_id = _version(client, db, superuser_token_headers)
    claims = ["前调为柑橘与佛手柑", "获得过大奖", "含有天然玫瑰精油"]
    script: list[str | Exception] = [
        _json(claims=claims),
        _json(
            verdict="supported",
            source_ref="C1",
            quote="前调为柑橘与佛手柑",
            rationale="一致",
        ),
        _json(
            verdict="insufficient",
            source_ref=None,
            quote=None,
            rationale="没有获奖信息",
        ),
        # The model claims support but quotes text that is not in any source: it must be downgraded.
        _json(
            verdict="supported",
            source_ref="C1",
            quote="含有天然玫瑰精油",
            rationale="我觉得有",
        ),
    ]
    rows = check_evidence(
        session=db,
        version=version,
        task_id=uuid.UUID(task_id),
        deps=_deps(db, embedder, script),
    )
    db.commit()

    by_claim = {r.claim_text: r for r in rows}
    supported = by_claim["前调为柑橘与佛手柑"]
    assert (
        supported.status == "system_supported"
        and supported.source_level == "approved_kb"
    )
    assert (
        supported.document_id and supported.chunk_id and supported.document_version == 1
    )
    assert supported.quote == "前调为柑橘与佛手柑" and supported.snapshot_id is None
    assert by_claim["获得过大奖"].status == "evidence_missing"
    forged = by_claim["含有天然玫瑰精油"]
    assert forged.status == "needs_human_review" and "无法核实" in forged.rationale
    summary = summarize(rows)
    assert (
        summary.total,
        summary.supported,
        summary.missing,
        summary.needs_review,
    ) == (3, 1, 1, 1)
    assert not summary.all_supported
    assert {r.prompt_version for r in rows} == {"evidence-v1"}


def test_a_claim_without_any_candidate_source_needs_no_judgement_call(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    version, task_id = _version(client, db, superuser_token_headers, ingest=False)
    deps = _deps(db, embedder, [_json(claims=["任何说法"])])
    rows = check_evidence(
        session=db, version=version, task_id=uuid.UUID(task_id), deps=deps
    )
    assert [(r.status, r.rationale) for r in rows] == [
        ("evidence_missing", "没有检索到相关资料")
    ]
    assert len(deps.llm.requests) == 1  # type: ignore[attr-defined]  # only the extraction call
    assert summarize(
        []
    ).all_supported  # a note without checkable claims has nothing unsupported


def test_rechecking_replaces_the_old_rows_and_failures_leave_them_alone(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    version, task_id = _version(client, db, superuser_token_headers)
    tid = uuid.UUID(task_id)
    first = _json(claims=["前调为柑橘与佛手柑"])
    judged = _json(
        verdict="supported", source_ref="C1", quote="前调为柑橘与佛手柑", rationale=""
    )
    check_evidence(
        session=db,
        version=version,
        task_id=tid,
        deps=_deps(db, embedder, [first, judged]),
    )
    db.commit()
    old_ids = {
        r.id
        for r in db.exec(
            select(ClaimEvidence).where(ClaimEvidence.version_id == version.id)
        ).all()
    }
    assert len(old_ids) == 1

    for failure in (ModelUnavailableError("down"), "not json"):
        with pytest.raises((ModelUnavailableError, LlmOutputError)):
            check_evidence(
                session=db,
                version=version,
                task_id=tid,
                deps=_deps(db, embedder, [failure]),
            )
        db.rollback()
        now = {
            r.id
            for r in db.exec(
                select(ClaimEvidence).where(ClaimEvidence.version_id == version.id)
            ).all()
        }
        assert now == old_ids  # a failed recheck changes nothing

    check_evidence(
        session=db,
        version=version,
        task_id=tid,
        deps=_deps(db, embedder, [first, judged]),
    )
    db.commit()
    new_ids = {
        r.id
        for r in db.exec(
            select(ClaimEvidence).where(ClaimEvidence.version_id == version.id)
        ).all()
    }
    assert len(new_ids) == 1 and new_ids != old_ids


def test_task_material_is_used_as_unreviewed_evidence(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    version, task_id = _version(client, db, superuser_token_headers, ingest=False)
    from app.services.task_input import DbTaskInputRepository

    DbTaskInputRepository(db, embedder).create_snapshot(
        brand_id=version.brand_id,
        task_id=uuid.UUID(task_id),
        filename="b.txt",
        text="运营说明：本品由天然木材提炼。",
    )
    script: list[str | Exception] = [
        _json(claims=["本品由天然木材提炼"]),
        _json(
            verdict="supported",
            source_ref="C1",
            quote="本品由天然木材提炼",
            rationale="任务资料里有",
        ),
    ]
    (row,) = check_evidence(
        session=db,
        version=version,
        task_id=uuid.UUID(task_id),
        deps=_deps(db, embedder, script),
    )
    assert row.status == "system_supported" and row.source_level == "task_material"
    assert (
        row.snapshot_id and row.document_id is None
    )  # unreviewed material is marked as such


def test_endpoints_list_and_confirm_without_changing_the_system_status(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    version, task_id = _version(client, db, superuser_token_headers)
    script: list[str | Exception] = [_json(claims=["获得过大奖"])]
    (row,) = check_evidence(
        session=db,
        version=version,
        task_id=uuid.UUID(task_id),
        deps=_deps(db, embedder, script + [_json(verdict="insufficient")]),
    )
    db.commit()
    member, member_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(
        client, superuser_token_headers, str(version.brand_id), member, "editor"
    )

    listed = client.get(
        f"{API}/generation-versions/{version.id}/evidence", headers=member_headers
    ).json()
    assert [
        (i["claim_text"], i["status"], i["human_confirmed"]) for i in listed["items"]
    ] == [("获得过大奖", "evidence_missing", None)]
    detail = client.get(
        f"{API}/generation-versions/{version.id}", headers=member_headers
    ).json()
    assert detail["claim_evidence"][0]["id"] == str(row.id)

    url = f"{API}/claim-evidence/{row.id}/confirm"
    confirmed = client.post(
        url,
        headers=member_headers,
        json={"human_confirmed": True, "note": "已与品牌方核实"},
    )
    assert confirmed.status_code == 200
    body = confirmed.json()
    assert body["human_confirmed"] is True and body["confirm_note"] == "已与品牌方核实"
    assert (
        body["status"] == "evidence_missing"
    )  # the system's judgement is not rewritten
    assert body["confirmed_at"]
    db.expire_all()
    saved = db.get(ClaimEvidence, row.id)
    assert (
        saved is not None
        and saved.confirmed_by == member.id
        and saved.status == "evidence_missing"
    )
    assert [
        a.action
        for a in db.exec(select(AuditLog).where(AuditLog.entity_id == row.id)).all()
    ] == ["evidence.confirm"]
    assert (
        client.post(
            url, headers=member_headers, json={"human_confirmed": False}
        ).json()["human_confirmed"]
        is False
    )
    assert client.post(url, headers=member_headers, json={}).status_code == 422
    assert (
        client.post(
            url,
            headers=member_headers,
            json={"human_confirmed": True, "note": "x" * 501},
        ).status_code
        == 422
    )

    # Outsiders and strangers cannot tell the evidence exists.
    for path in (
        f"/claim-evidence/{row.id}/confirm",
        f"/claim-evidence/{uuid.uuid4()}/confirm",
    ):
        assert (
            client.post(
                f"{API}{path}", headers=outsider_headers, json={"human_confirmed": True}
            ).status_code
            == 404
        )
    assert (
        client.get(
            f"{API}/generation-versions/{version.id}/evidence", headers=outsider_headers
        ).status_code
        == 404
    )
    assert client.post(url, json={"human_confirmed": True}).status_code == 401
    assert db.get(Task, uuid.UUID(task_id)) is not None
