"""Product and voice profile API (TC-005, TC-006 and brand isolation). Needs the database."""

import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.models import Brand, KbChunk, KbDocument, Tenant
from app.models.knowledge import DocumentStatus
from app.services.voice_profiles import DbVoiceProfileProvider
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR


@pytest.fixture(scope="module", autouse=True)
def cleanup_brands(db: Session) -> Generator[None]:
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


def _product(
    client: TestClient, headers: dict[str, str], brand_id: str, **extra: object
) -> dict[str, object]:
    body = {"name": "晨雾", "category": "perfume", **extra}
    r = client.post(f"{API}/brands/{brand_id}/products", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _approved_document(
    db: Session, brand_id: str, *, status: str = DocumentStatus.APPROVED.value
) -> KbDocument:
    doc = KbDocument(
        brand_id=uuid.UUID(brand_id),
        title="规格",
        doc_type="product_spec",
        status=status,
        is_current=True,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_product_crud_and_roles(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    editor, editor_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    url = f"{API}/brands/{brand['id']}/products"

    created = _product(
        client,
        superuser_token_headers,
        brand["id"],
        notes={"top": ["佛手柑"]},
        selling_points=[{"text": "清新前调"}],
    )
    assert created["status"] == "active"
    assert created["selling_points"][0]["evidence_status"] == "draft"  # type: ignore[index]

    # Editors read but cannot create; outsiders get nothing.
    assert client.get(url, headers=editor_headers).json()["total"] == 1
    assert client.get(url, headers=outsider_headers).status_code == 403
    assert (
        client.post(url, headers=editor_headers, json={"name": "x"}).status_code == 403
    )

    item = f"{API}/products/{created['id']}"
    patched = client.patch(
        item, headers=superuser_token_headers, json={"name": "晨雾二号"}
    )
    assert patched.status_code == 200 and patched.json()["name"] == "晨雾二号"
    null_name = client.patch(item, headers=superuser_token_headers, json={"name": None})
    assert (
        null_name.json()["name"] == "晨雾二号"
    )  # null does not clear a required field
    assert (
        client.patch(item, headers=editor_headers, json={"name": "x"}).status_code
        == 403
    )
    assert (
        client.patch(item, headers=outsider_headers, json={"name": "x"}).status_code
        == 403
    )
    missing = f"{API}/products/{uuid.uuid4()}"
    assert (
        client.patch(missing, headers=superuser_token_headers, json={}).status_code
        == 403
    )


def test_archive_is_a_soft_delete(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    product = _product(client, superuser_token_headers, brand["id"])
    url = f"{API}/brands/{brand['id']}/products"

    archived = client.post(
        f"{API}/products/{product['id']}/archive", headers=superuser_token_headers
    )
    assert archived.status_code == 200 and archived.json()["status"] == "archived"
    assert client.get(url, headers=superuser_token_headers).json()["total"] == 0
    listed = client.get(f"{url}?status=archived", headers=superuser_token_headers)
    assert [p["id"] for p in listed.json()["items"]] == [product["id"]]


def test_product_pagination_and_validation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    for _ in range(3):
        _product(client, superuser_token_headers, brand["id"])
    url = f"{API}/brands/{brand['id']}/products"

    page = client.get(f"{url}?page=2&page_size=2", headers=superuser_token_headers)
    body = page.json()
    assert (body["total"], len(body["items"]), body["page"]) == (3, 1, 2)
    for query in ("page_size=101", "page_size=0", "page=0", "status=gone"):
        r = client.get(f"{url}?{query}", headers=superuser_token_headers)
        assert r.status_code == 422, query
    bad = client.post(url, headers=superuser_token_headers, json={"name": ""})
    assert bad.status_code == 422


def test_products_are_isolated_between_brands(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand_a = _create_brand(client, superuser_token_headers)
    brand_b = _create_brand(client, superuser_token_headers)
    user, headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand_a["id"], user, "admin")
    other = _product(client, superuser_token_headers, brand_b["id"])

    assert (
        client.get(
            f"{API}/brands/{brand_b['id']}/products", headers=headers
        ).status_code
        == 403
    )
    # An admin of brand A cannot modify brand B's product, and the body cannot name another brand.
    assert (
        client.patch(
            f"{API}/products/{other['id']}", headers=headers, json={"name": "x"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{API}/products/{other['id']}/archive", headers=headers
        ).status_code
        == 403
    )
    created = client.post(
        f"{API}/brands/{brand_a['id']}/products",
        headers=headers,
        json={"name": "x", "brand_id": brand_b["id"]},
    )
    assert created.json()["brand_id"] == brand_a["id"]


def test_selling_point_sources_must_be_approved_documents_of_the_brand(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    other_brand = _create_brand(client, superuser_token_headers)
    good = _approved_document(db, brand["id"])
    pending = _approved_document(
        db, brand["id"], status=DocumentStatus.PENDING_REVIEW.value
    )
    foreign = _approved_document(db, other_brand["id"])
    chunk = KbChunk(
        brand_id=good.brand_id, document_id=good.id, chunk_index=0, content="佛手柑"
    )
    db.add(chunk)
    db.commit()
    url = f"{API}/brands/{brand['id']}/products"

    ok = client.post(
        url,
        headers=superuser_token_headers,
        json={
            "name": "晨雾",
            "selling_points": [
                {
                    "text": "佛手柑前调",
                    "source_document_id": str(good.id),
                    "source_chunk_id": str(chunk.id),
                }
            ],
        },
    )
    assert ok.status_code == 201
    assert ok.json()["selling_points"][0]["evidence_status"] == "linked"

    for doc in (pending, foreign):
        r = client.post(
            url,
            headers=superuser_token_headers,
            json={
                "name": "x",
                "selling_points": [{"text": "a", "source_document_id": str(doc.id)}],
            },
        )
        assert r.status_code == 409
    unknown_chunk = client.post(
        url,
        headers=superuser_token_headers,
        json={
            "name": "x",
            "selling_points": [
                {
                    "text": "a",
                    "source_document_id": str(good.id),
                    "source_chunk_id": str(uuid.uuid4()),
                }
            ],
        },
    )
    assert unknown_chunk.status_code == 409
    chunk_only = client.post(
        url,
        headers=superuser_token_headers,
        json={
            "name": "x",
            "selling_points": [{"text": "a", "source_chunk_id": str(chunk.id)}],
        },
    )
    assert chunk_only.status_code == 409


def test_voice_profile_versions_and_activation(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    editor, editor_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    base = f"{API}/brands/{brand['id']}/voice-profile"

    assert client.get(base, headers=superuser_token_headers).status_code == 404
    v1 = client.post(
        f"{base}/versions",
        headers=superuser_token_headers,
        json={"persona": "温柔克制", "forbidden_words": ["最好"]},
    )
    assert v1.status_code == 201
    assert (v1.json()["version"], v1.json()["is_active"]) == (1, False)
    assert (
        client.get(base, headers=superuser_token_headers).status_code == 404
    )  # draft only

    v2 = client.post(
        f"{base}/versions", headers=superuser_token_headers, json={"persona": "明亮"}
    )
    assert v2.json()["version"] == 2

    assert (
        client.post(
            f"{base}/versions/1/activate", headers=superuser_token_headers
        ).status_code
        == 200
    )
    assert client.get(base, headers=editor_headers).json()["persona"] == "温柔克制"
    assert (
        client.post(
            f"{base}/versions/2/activate", headers=superuser_token_headers
        ).status_code
        == 200
    )
    versions = client.get(f"{base}/versions", headers=editor_headers).json()["items"]
    assert [(v["version"], v["is_active"]) for v in versions] == [(2, True), (1, False)]
    assert client.get(base, headers=superuser_token_headers).json()["version"] == 2

    assert (
        client.post(
            f"{base}/versions/9/activate", headers=superuser_token_headers
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{base}/versions", headers=editor_headers, json={"persona": "x"}
        ).status_code
        == 403
    )
    assert (
        client.post(f"{base}/versions/1/activate", headers=editor_headers).status_code
        == 403
    )
    assert client.get(base, headers=outsider_headers).status_code == 403
    assert (
        client.post(
            f"{base}/versions", headers=superuser_token_headers, json={"persona": ""}
        ).status_code
        == 422
    )

    provider = DbVoiceProfileProvider(db)
    active = provider.get_active(brand_id=uuid.UUID(brand["id"]))
    assert active is not None and active.version == 2 and active.persona == "明亮"
    assert provider.get_active(brand_id=uuid.uuid4()) is None
