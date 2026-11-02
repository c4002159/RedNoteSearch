"""Notes, immutable text versions and two-step similarity review (PostgreSQL, fake only)."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.fakes.embedding import FakeEmbeddingProvider
from app.models import KbChunk, KbDocument
from app.services import knowledge as kb
from app.services import knowledge_similarity as sim
from app.services.errors import InvalidStateError
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user
from tests.api.routes.test_knowledge import _ingest, _search
from tests.api.routes.test_knowledge import embedder as embedder

API = settings.API_V1_STR


def note(
    client: TestClient, headers: dict[str, str], brand: str, *, title: str = "口述说明"
) -> dict[str, Any]:
    response = client.post(
        f"{API}/brands/{brand}/knowledge-notes",
        headers=headers,
        json={
            "title": title,
            "source_description": "产品负责人，会议记录",
            "text": "独立香调设计说明，供后续审核参考。",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_notes_and_metadata_versions_stay_pending_until_approval(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    headers = superuser_token_headers
    brand = _create_brand(client, headers)["id"]
    editor, editor_headers = _make_user(client, db)
    _add_member(client, headers, brand, editor, "editor")
    first = note(client, editor_headers, brand)
    assert (
        first["source_kind"],
        first["status"],
        first["index_status"],
        first["is_current"],
    ) == ("note", "pending_review", "pending", False)
    assert embedder.calls == []
    assert _search(db, embedder, brand, "香调设计") == []
    approved = client.post(
        f"{API}/knowledge-documents/{first['id']}/reviews",
        headers=headers,
        json={"action": "approve"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["is_current"] is True
    changed = client.post(
        f"{API}/knowledge-documents/{first['id']}/text-versions",
        headers=editor_headers,
        json={"title": "会议说明修订"},
    )
    assert changed.status_code == 201, changed.text
    second = changed.json()
    assert second["group_id"] == first["group_id"] and second["version"] == 2
    assert second["status"] == "pending_review" and not second["is_current"]
    db.expire_all()
    old = db.get(KbDocument, uuid.UUID(first["id"]))
    new = db.get(KbDocument, uuid.UUID(second["id"]))
    assert old is not None and old.is_current and new is not None
    assert new.checksum == old.checksum
    assert [c.content for c in kb._chunks_of(db, new)] == [
        c.content for c in kb._chunks_of(db, old)
    ]
    assert all(c.embedding is None for c in kb._chunks_of(db, new))
    accepted = client.post(
        f"{API}/knowledge-documents/{second['id']}/reviews",
        headers=headers,
        json={"action": "approve"},
    )
    assert accepted.status_code == 200, (
        accepted.text
    )  # own group is excluded from similarity
    db.expire_all()
    assert not db.get(KbDocument, uuid.UUID(first["id"])).is_current
    filtered = client.get(
        f"{API}/brands/{brand}/knowledge-documents?source_kind=note",
        headers=editor_headers,
    ).json()
    assert filtered["total"] == 2 and all(
        row["source_kind"] == "note" for row in filtered["items"]
    )
    assert (
        client.get(
            f"{API}/brands/{brand}/knowledge-documents?source_kind=file",
            headers=headers,
        ).json()["total"]
        == 0
    )
    assert (
        client.post(
            f"{API}/knowledge-documents/{second['id']}/text-versions",
            headers=editor_headers,
            json={"source_description": None},
        ).status_code
        == 422
    )


def test_similarity_recomputed_and_coexist_uses_one_embedding_call_per_attempt(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    headers = superuser_token_headers
    brand = _create_brand(client, headers)["id"]
    old = _ingest(client, headers, brand, "第一份独立的资料内容。")
    pending = note(client, headers, brand, title="品牌故事")
    url = f"{API}/knowledge-documents/{pending['id']}/reviews"
    embedder.calls.clear()
    first = client.post(url, headers=headers, json={"action": "approve"})
    assert first.status_code == 409, first.text
    assert first.json()["error"]["code"] == "KB_SIMILAR_CONTENT"
    report = first.json()["error"]["details"]
    assert old["id"] in [row["id"] for row in report["items"]]
    assert len(embedder.calls) == 1
    db.expire_all()
    row = db.get(KbDocument, uuid.UUID(pending["id"]))
    assert (
        row is not None
        and row.status == "pending_review"
        and row.index_status == "pending"
        and not row.is_current
    )
    assert all(c.embedding is None for c in kb._chunks_of(db, row))
    assert [
        r["action"]
        for r in client.get(
            f"{API}/knowledge-documents/{pending['id']}", headers=headers
        ).json()["reviews"]
    ] == ["submit"]
    extra = _ingest(client, headers, brand, "第二份完全不同的资料。")
    payload = {
        "action": "approve",
        "reason": "两份资料保留",
        "similar_decision": "coexist",
        "similarity_token": report["token"],
    }
    embedder.calls.clear()
    changed = client.post(url, headers=headers, json=payload)
    assert changed.status_code == 409, changed.text
    assert extra["id"] in [
        row["id"] for row in changed.json()["error"]["details"]["items"]
    ]
    assert len(embedder.calls) == 1
    payload["similarity_token"] = changed.json()["error"]["details"]["token"]
    embedder.calls.clear()
    done = client.post(url, headers=headers, json=payload)
    assert done.status_code == 200 and done.json()["status"] == "approved", done.text
    assert len(embedder.calls) == 1
    for id_ in (old["id"], extra["id"]):
        assert (
            client.get(f"{API}/knowledge-documents/{id_}", headers=headers).json()[
                "status"
            ]
            == "approved"
        )
    review = client.get(
        f"{API}/knowledge-documents/{pending['id']}", headers=headers
    ).json()["reviews"][-1]
    assert (
        review["similar_decision"] == "coexist"
        and review["reason"] == payload["reason"]
    )


def test_new_wins_atomic_rollback_and_foreign_targets(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = superuser_token_headers
    brand = _create_brand(client, headers)["id"]
    old = _ingest(client, headers, brand, "原有资料")
    pending = note(client, headers, brand, title="品牌故事")
    url = f"{API}/knowledge-documents/{pending['id']}/reviews"
    initial = client.post(url, headers=headers, json={"action": "approve"})
    assert initial.status_code == 409, initial.text
    token = initial.json()["error"]["details"]["token"]
    foreign = _ingest(
        client, headers, _create_brand(client, headers)["id"], "另一品牌资料"
    )
    embedder.calls.clear()
    payload = {
        "action": "approve",
        "similar_decision": "new_wins",
        "related_document_ids": [foreign["id"]],
        "reason": "替换资料",
        "similarity_token": token,
    }
    assert client.post(url, headers=headers, json=payload).status_code == 404
    assert embedder.calls == []
    payload["related_document_ids"] = [old["id"]]
    original = kb.deactivate_document

    def fail_after_change(**kwargs: Any) -> None:
        original(**kwargs)
        raise InvalidStateError("测试停用失败")

    monkeypatch.setattr(kb, "deactivate_document", fail_after_change)
    failed = client.post(url, headers=headers, json=payload)
    assert failed.status_code == 409, failed.text
    assert (
        client.get(f"{API}/knowledge-documents/{old['id']}", headers=headers).json()[
            "status"
        ]
        == "approved"
    )
    detail = client.get(
        f"{API}/knowledge-documents/{pending['id']}", headers=headers
    ).json()
    assert detail["status"] == "pending_review" and [
        r["action"] for r in detail["reviews"]
    ] == ["submit"]
    monkeypatch.setattr(kb, "deactivate_document", original)
    success = client.post(url, headers=headers, json=payload)
    assert success.status_code == 200, success.text
    assert (
        client.get(f"{API}/knowledge-documents/{old['id']}", headers=headers).json()[
            "status"
        ]
        == "deactivated"
    )
    review = client.get(
        f"{API}/knowledge-documents/{pending['id']}", headers=headers
    ).json()["reviews"][-1]
    assert review["similar_decision"] == "new_wins" and review[
        "related_document_ids"
    ] == [old["id"]]


def test_cancel_preview_failure_and_original_embedding_failure(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = superuser_token_headers
    brand = _create_brand(client, headers)["id"]
    pending = note(client, headers, brand)
    base = f"{API}/knowledge-documents/{pending['id']}"
    embedder.fail = True
    before = len(embedder.calls)
    preview = client.post(f"{base}/similarity-preview", headers=headers)
    assert preview.status_code == 200 and preview.json()["status"] == "unavailable"
    assert (
        client.post(
            f"{base}/reviews", headers=headers, json={"action": "approve"}
        ).status_code
        == 503
    )
    assert (
        len(embedder.calls) == before
    )  # failed provider calls do not enter Fake.calls
    canceled = client.post(
        f"{base}/reviews",
        headers=headers,
        json={"action": "cancel", "reason": "稍后再检查"},
    )
    assert canceled.status_code == 200 and canceled.json()["status"] == "pending_review"
    assert len(embedder.calls) == before  # cancel does not call the provider
    detail = client.get(base, headers=headers).json()
    assert [r["action"] for r in detail["reviews"]] == ["submit", "cancel"]
    assert detail["reviews"][-1]["reason"] == "稍后再检查"
    embedder.fail = False
    monkeypatch.setattr(
        "app.services.knowledge_review.compare_vectors", lambda *_: sim.unavailable()
    )
    approved = client.post(
        f"{base}/reviews", headers=headers, json={"action": "approve"}
    )
    assert approved.status_code == 200 and approved.json()["index_status"] == "ready"
    assert approved.json()["similarity"]["status"] == "unavailable"
    assert len(embedder.calls) == before + 1
    db.expire_all()
    chunks = db.exec(
        select(KbChunk).where(KbChunk.document_id == uuid.UUID(pending["id"]))
    ).all()
    assert chunks and all(c.embedding is not None for c in chunks)


def test_note_permissions_resource_hiding_and_validation(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    headers = superuser_token_headers
    brand = _create_brand(client, headers)["id"]
    editor, editor_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, headers, brand, editor, "editor")
    pending = note(client, headers, brand)
    create = f"{API}/brands/{brand}/knowledge-notes"
    body = {"title": "x", "source_description": "负责人会议说明", "text": "正文"}
    assert client.post(create, json=body).status_code == 401
    assert client.post(create, headers=outsider_headers, json=body).status_code == 403
    for invalid in (
        {**body, "source_description": " "},
        {**body, "text": "x" * 50001},
        {**body, "brand_id": brand},
    ):
        assert client.post(create, headers=headers, json=invalid).status_code == 422
    assert (
        client.get(
            f"{API}/brands/{brand}/knowledge-documents?source_kind=unknown",
            headers=headers,
        ).status_code
        == 422
    )
    for suffix, payload in (
        ("similarity-preview", None),
        ("reviews", {"action": "approve"}),
        ("text-versions", {"title": "修订"}),
    ):
        url = f"{API}/knowledge-documents/{pending['id']}/{suffix}"
        assert client.post(url, json=payload).status_code == 401
        assert (
            client.post(url, headers=outsider_headers, json=payload).status_code == 404
        )
        assert (
            client.post(
                url.replace(pending["id"], str(uuid.uuid4())),
                headers=headers,
                json=payload,
            ).status_code
            == 404
        )
        if suffix != "text-versions":
            assert (
                client.post(url, headers=editor_headers, json=payload).status_code
                == 403
            )
    assert embedder.calls == []


def test_preview_scope_excludes_foreign_unapproved_and_previous_versions(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    headers = superuser_token_headers
    brand = _create_brand(client, headers)["id"]
    visible = _ingest(client, headers, brand, "可用资料")
    inactive = _ingest(client, headers, brand, "已经停用")
    assert (
        client.post(
            f"{API}/knowledge-documents/{inactive['id']}/deactivate",
            headers=headers,
            json={"reason": "暂不使用"},
        ).status_code
        == 200
    )
    pending = note(client, headers, brand, title="品牌故事")
    rejected = note(client, headers, brand, title="品牌故事")
    assert (
        client.post(
            f"{API}/knowledge-documents/{rejected['id']}/reviews",
            headers=headers,
            json={"action": "reject", "reason": "来源待补充"},
        ).status_code
        == 200
    )
    foreign = _ingest(
        client, headers, _create_brand(client, headers)["id"], "另一个品牌"
    )
    target = note(client, headers, brand, title="品牌故事")
    url = f"{API}/knowledge-documents/{target['id']}/similarity-preview"
    report = client.post(url, headers=headers)
    assert report.status_code == 200, report.text
    assert {item["id"] for item in report.json()["items"]} == {visible["id"]}
    assert not {pending["id"], rejected["id"], inactive["id"], foreign["id"]} & {
        item["id"] for item in report.json()["items"]
    }
    db.expire_all()
    row = db.get(KbDocument, uuid.UUID(target["id"]))
    assert row is not None and all(
        chunk.embedding is None for chunk in kb._chunks_of(db, row)
    )
    assert (
        client.get(f"{API}/knowledge-documents/{target['id']}", headers=headers).json()[
            "status"
        ]
        == "pending_review"
    )
    assert embedder.calls  # fake used; no real model
