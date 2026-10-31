"""Knowledge base API: ingest, review, versions, deactivate, reindex and retrieval visibility.

Needs the database. The embedding model is replaced by a deterministic fake.
"""

import uuid
from collections.abc import Generator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.api.routes.knowledge import get_embedder
from app.core.config import settings
from app.fakes.embedding import FakeEmbeddingProvider
from app.main import app
from app.models import Brand, KbDocument, KbReview, Tenant
from app.ports.knowledge import KnowledgeChunk
from app.services.errors import ModelUnavailableError
from app.services.knowledge_search import DbKnowledgeSearch
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR


@pytest.fixture(scope="module", autouse=True)
def cleanup_brands(db: Session) -> Generator[None]:
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


def _upload(
    client: TestClient,
    headers: dict[str, str],
    url: str,
    text: str,
    *,
    title: str = "品牌故事",
    doc_type: str = "brand_story",
    filename: str = "story.md",
    extra: dict[str, str] | None = None,
) -> httpx.Response:
    return client.post(
        url,
        headers=headers,
        data={"title": title, "doc_type": doc_type, **(extra or {})},
        files={"file": (filename, text.encode(), "text/markdown")},
    )


def _ingest(
    client: TestClient, headers: dict[str, str], brand_id: str, text: str
) -> dict[str, Any]:
    r = _upload(client, headers, f"{API}/brands/{brand_id}/knowledge-documents", text)
    assert r.status_code == 201, r.text
    return r.json()


def _search(
    db: Session, embedder: FakeEmbeddingProvider, brand_id: str, query: str
) -> list[KnowledgeChunk]:
    db.expire_all()
    return DbKnowledgeSearch(db, embedder).search(
        brand_id=uuid.UUID(brand_id), query=query
    )


def test_admin_direct_ingest_is_searchable_and_audited(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    editor, editor_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    phrase = f"独特短语{uuid.uuid4().hex[:8]}"

    doc = _ingest(
        client, superuser_token_headers, brand["id"], f"冰希黎的故事。{phrase}。"
    )
    assert (doc["status"], doc["index_status"], doc["version"], doc["is_current"]) == (
        "approved",
        "ready",
        1,
        True,
    )

    hits = _search(db, embedder, brand["id"], phrase)
    assert hits and phrase in hits[0].content
    assert hits[0].source_level == "approved_kb" and hits[0].document_version == 1
    assert str(hits[0].document_id) == doc["group_id"]

    detail = client.get(
        f"{API}/knowledge-documents/{doc['id']}", headers=editor_headers
    ).json()
    assert [r["action"] for r in detail["reviews"]] == ["admin_direct_ingest"]
    assert detail["reviews"][0]["actor_id"] == doc["submitted_by"]

    # Editors cannot ingest directly, nor preview chunks; admins can.
    url = f"{API}/brands/{brand['id']}/knowledge-documents"
    assert _upload(client, editor_headers, url, "x").status_code == 403
    chunks_url = f"{API}/knowledge-documents/{doc['id']}/chunks"
    assert client.get(chunks_url, headers=editor_headers).status_code == 403
    chunks = client.get(chunks_url, headers=superuser_token_headers).json()
    assert chunks["total"] == 1 and phrase in chunks["items"][0]["content"]
    assert chunks["items"][0]["metadata"]["version"] == 1


def test_failed_parsing_or_embedding_leaves_nothing_behind(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    url = f"{API}/brands/{brand['id']}/knowledge-documents"

    bad_type = _upload(client, superuser_token_headers, url, "x", filename="x.exe")
    assert bad_type.status_code == 422
    empty = _upload(client, superuser_token_headers, url, "   ")
    assert empty.status_code == 422
    bad_doc_type = _upload(client, superuser_token_headers, url, "x", doc_type="novel")
    assert bad_doc_type.status_code == 422

    embedder.fail = True
    down = _upload(client, superuser_token_headers, url, "内容正常")
    assert down.status_code == 503

    db.expire_all()
    count = db.exec(
        select(KbDocument).where(KbDocument.brand_id == uuid.UUID(brand["id"]))
    ).all()
    assert count == []


def test_submission_review_flow(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    editor, editor_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    submit_url = f"{API}/brands/{brand['id']}/knowledge-submissions"
    phrase = f"待审短语{uuid.uuid4().hex[:8]}"

    r = _upload(client, editor_headers, submit_url, f"补充资料 {phrase}")
    assert r.status_code == 201
    pending = r.json()
    assert (pending["status"], pending["index_status"], pending["is_current"]) == (
        "pending_review",
        "pending",
        False,
    )
    assert _upload(client, outsider_headers, submit_url, "x").status_code == 403
    assert _search(db, embedder, brand["id"], phrase) == []  # not searchable yet

    review_url = f"{API}/knowledge-documents/{pending['id']}/reviews"
    assert (
        client.post(
            review_url, headers=editor_headers, json={"action": "approve"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            review_url, headers=superuser_token_headers, json={"action": "reject"}
        ).status_code
        == 422
    )
    embedder.fail = True  # a model outage must not leave a half-approved document
    outage = client.post(
        review_url, headers=superuser_token_headers, json={"action": "approve"}
    )
    assert outage.status_code == 503
    db.expire_all()
    assert db.get(KbDocument, uuid.UUID(pending["id"])).status == "pending_review"

    embedder.fail = False
    approved = client.post(
        review_url, headers=superuser_token_headers, json={"action": "approve"}
    )
    assert approved.status_code == 200
    assert (approved.json()["status"], approved.json()["index_status"]) == (
        "approved",
        "ready",
    )
    assert _search(db, embedder, brand["id"], phrase)

    again = client.post(
        review_url, headers=superuser_token_headers, json={"action": "approve"}
    )
    assert again.status_code == 409

    detail = client.get(
        f"{API}/knowledge-documents/{pending['id']}", headers=editor_headers
    ).json()
    assert [r["action"] for r in detail["reviews"]] == ["submit", "approve"]


def test_rejected_documents_are_never_searchable(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    phrase = f"驳回短语{uuid.uuid4().hex[:8]}"
    submitted = _upload(
        client,
        superuser_token_headers,
        f"{API}/brands/{brand['id']}/knowledge-submissions",
        phrase,
    ).json()
    rejected = client.post(
        f"{API}/knowledge-documents/{submitted['id']}/reviews",
        headers=superuser_token_headers,
        json={"action": "reject", "reason": "来源不明"},
    )
    assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"
    assert _search(db, embedder, brand["id"], phrase) == []
    reviews = db.exec(
        select(KbReview).where(KbReview.document_id == uuid.UUID(submitted["id"]))
    ).all()
    assert sorted(r.action for r in reviews) == ["reject", "submit"]
    assert [r.reason for r in reviews if r.action == "reject"] == ["来源不明"]


def test_new_versions_replace_the_current_one(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    old_phrase = f"旧版{uuid.uuid4().hex[:8]}"
    new_phrase = f"新版{uuid.uuid4().hex[:8]}"
    v1 = _ingest(client, superuser_token_headers, brand["id"], old_phrase)

    # A submitted replacement is not used until it is approved.
    submitted = _upload(
        client,
        superuser_token_headers,
        f"{API}/brands/{brand['id']}/knowledge-submissions",
        new_phrase,
        extra={"supersedes_document_id": v1["id"]},
    ).json()
    assert (submitted["group_id"], submitted["version"]) == (v1["group_id"], 2)
    assert [h.document_version for h in _search(db, embedder, brand["id"], old_phrase)][
        :1
    ] == [1]
    assert all(
        new_phrase not in h.content
        for h in _search(db, embedder, brand["id"], new_phrase)
    )

    client.post(
        f"{API}/knowledge-documents/{submitted['id']}/reviews",
        headers=superuser_token_headers,
        json={"action": "approve"},
    )
    contents = [
        h.content for h in _search(db, embedder, brand["id"], old_phrase + new_phrase)
    ]
    assert contents == [new_phrase]  # only the new current version is retrievable

    # Direct admin version on top.
    v3 = _upload(
        client,
        superuser_token_headers,
        f"{API}/knowledge-documents/{v1['id']}/versions",
        "第三版内容",
    ).json()
    assert v3["version"] == 3 and v3["is_current"]
    detail = client.get(
        f"{API}/knowledge-documents/{v3['id']}", headers=superuser_token_headers
    ).json()
    assert [(v["version"], v["is_current"]) for v in detail["versions"]] == [
        (1, False),
        (2, False),
        (3, True),
    ]


def test_deactivate_and_reindex(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    phrase = f"索引短语{uuid.uuid4().hex[:8]}"
    doc = _ingest(client, superuser_token_headers, brand["id"], phrase)
    reindex = f"{API}/knowledge-documents/{doc['id']}/reindex"

    ok = client.post(reindex, headers=superuser_token_headers)
    assert ok.status_code == 202 and ok.json()["index_status"] == "ready"

    embedder.fail = True
    failed = client.post(reindex, headers=superuser_token_headers)
    assert failed.status_code == 503
    db.expire_all()
    assert db.get(KbDocument, uuid.UUID(doc["id"])).index_status == "failed"
    embedder.fail = False
    assert (
        _search(db, embedder, brand["id"], phrase) == []
    )  # failed index is not searchable
    assert (
        client.post(reindex, headers=superuser_token_headers).json()["index_status"]
        == "ready"
    )
    assert _search(db, embedder, brand["id"], phrase)

    off = client.post(
        f"{API}/knowledge-documents/{doc['id']}/deactivate",
        headers=superuser_token_headers,
    )
    assert off.status_code == 200 and off.json()["status"] == "deactivated"
    assert off.json()["is_current"] is False
    assert _search(db, embedder, brand["id"], phrase) == []
    assert (
        client.post(
            f"{API}/knowledge-documents/{doc['id']}/deactivate",
            headers=superuser_token_headers,
        ).status_code
        == 409
    )
    assert client.post(reindex, headers=superuser_token_headers).status_code == 409


def test_documents_are_isolated_between_brands(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand_a = _create_brand(client, superuser_token_headers)
    brand_b = _create_brand(client, superuser_token_headers)
    user, headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand_b["id"], user, "admin")
    phrase = f"私有短语{uuid.uuid4().hex[:8]}"
    doc = _ingest(client, superuser_token_headers, brand_a["id"], phrase)

    assert _search(db, embedder, brand_b["id"], phrase) == []
    assert _search(db, embedder, brand_a["id"], phrase)
    # An admin of brand B cannot see, change or use brand A's documents; by id they simply do not exist.
    for method, path in (
        ("get", f"/knowledge-documents/{doc['id']}"),
        ("get", f"/knowledge-documents/{doc['id']}/chunks"),
        ("post", f"/knowledge-documents/{doc['id']}/deactivate"),
        ("post", f"/knowledge-documents/{doc['id']}/reindex"),
    ):
        assert (
            getattr(client, method)(f"{API}{path}", headers=headers).status_code == 404
        ), path
    assert (
        client.get(
            f"{API}/brands/{brand_a['id']}/knowledge-documents", headers=headers
        ).status_code
        == 403
    )
    cross = _upload(
        client,
        headers,
        f"{API}/brands/{brand_b['id']}/knowledge-submissions",
        "x",
        extra={"supersedes_document_id": doc["id"]},
    )
    assert cross.status_code == 404
    assert (
        client.get(
            f"{API}/knowledge-documents/{uuid.uuid4()}", headers=headers
        ).status_code
        == 404
    )


@pytest.mark.usefixtures("embedder")
def test_listing_filters_and_pagination(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    _ingest(client, superuser_token_headers, brand["id"], "一")
    _ingest(client, superuser_token_headers, brand["id"], "二")
    _upload(
        client,
        superuser_token_headers,
        f"{API}/brands/{brand['id']}/knowledge-submissions",
        "三",
        doc_type="ingredient",
    )
    url = f"{API}/brands/{brand['id']}/knowledge-documents"

    assert client.get(url, headers=superuser_token_headers).json()["total"] == 3
    pending = client.get(
        f"{url}?status=pending_review", headers=superuser_token_headers
    ).json()
    assert pending["total"] == 1 and pending["items"][0]["doc_type"] == "ingredient"
    by_type = client.get(
        f"{url}?doc_type=brand_story", headers=superuser_token_headers
    ).json()
    assert by_type["total"] == 2
    page = client.get(
        f"{url}?page=2&page_size=2", headers=superuser_token_headers
    ).json()
    assert len(page["items"]) == 1
    for query in ("page_size=101", "page=0", "status=gone", "doc_type=gone"):
        assert (
            client.get(f"{url}?{query}", headers=superuser_token_headers).status_code
            == 422
        ), query


def test_search_edge_cases(db: Session, embedder: FakeEmbeddingProvider) -> None:
    search = DbKnowledgeSearch(db, embedder)
    assert search.search(brand_id=uuid.uuid4(), query="  ") == []
    assert search.search(brand_id=uuid.uuid4(), query="x", limit=0) == []
    embedder.fail = True
    with pytest.raises(ModelUnavailableError):
        search.search(brand_id=uuid.uuid4(), query="x")
