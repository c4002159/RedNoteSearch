"""Task material snapshots, audit rows and the demo seed. Needs the database."""

import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app import crud
from app.api.routes.knowledge import get_embedder
from app.core.config import settings
from app.fakes.embedding import FakeEmbeddingProvider
from app.main import app
from app.models import (
    AuditLog,
    Brand,
    BrandVoiceProfile,
    EvalDataset,
    KbDocument,
    Product,
    TaskInput,
    Tenant,
)
from app.seed import DEMO_SLUG, seed_demo
from app.services.errors import ModelUnavailableError, ParseError
from app.services.knowledge_search import DbKnowledgeSearch
from app.services.task_input import DbTaskInputRepository
from tests.api.routes.test_brands import _create_brand

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


def test_task_material_is_snapshotted_and_visible_only_to_its_task(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand_id = uuid.UUID(_create_brand(client, superuser_token_headers)["id"])
    other_brand_id = uuid.UUID(_create_brand(client, superuser_token_headers)["id"])
    task, other_task = uuid.uuid4(), uuid.uuid4()
    repo = DbTaskInputRepository(db, embedder)
    search = DbKnowledgeSearch(db, embedder)
    phrase = f"素材短语{uuid.uuid4().hex[:8]}"

    snapshot = repo.create_snapshot(
        brand_id=brand_id, task_id=task, filename="brief.md", text=f"运营补充：{phrase}"
    )
    assert snapshot.content_hash and snapshot.task_id == task
    assert [s.id for s in repo.list_snapshots(brand_id=brand_id, task_id=task)] == [
        snapshot.id
    ]
    assert repo.list_snapshots(brand_id=brand_id, task_id=other_task) == []
    assert repo.list_snapshots(brand_id=other_brand_id, task_id=task) == []

    hits = search.search(brand_id=brand_id, query=phrase, task_id=task)
    assert [(h.source_level, h.snapshot_id) for h in hits] == [
        ("task_material", snapshot.id)
    ]
    assert hits[0].document_id is None and phrase in hits[0].content
    # Not visible without the task id, to other tasks, or in another brand.
    assert search.search(brand_id=brand_id, query=phrase) == []
    assert search.search(brand_id=brand_id, query=phrase, task_id=other_task) == []
    assert search.search(brand_id=other_brand_id, query=phrase, task_id=task) == []


def test_snapshot_creation_is_all_or_nothing(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand_id = uuid.UUID(_create_brand(client, superuser_token_headers)["id"])
    task = uuid.uuid4()
    repo = DbTaskInputRepository(db, embedder)

    with pytest.raises(ParseError):
        repo.create_snapshot(
            brand_id=brand_id, task_id=task, filename="a.md", text="  "
        )
    embedder.fail = True
    with pytest.raises(ModelUnavailableError):
        repo.create_snapshot(
            brand_id=brand_id, task_id=task, filename="a.md", text="内容"
        )
    assert db.exec(select(TaskInput).where(TaskInput.task_id == task)).all() == []


@pytest.mark.usefixtures("embedder")
def test_important_actions_write_audit_rows(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    brand_id = uuid.UUID(brand["id"])
    admin = crud.get_user_by_email(session=db, email=settings.FIRST_SUPERUSER)
    assert admin is not None

    doc = client.post(
        f"{API}/brands/{brand['id']}/knowledge-documents",
        headers=superuser_token_headers,
        data={"title": "资料", "doc_type": "brand_story"},
        files={"file": ("a.md", "审计内容".encode(), "text/markdown")},
    ).json()
    client.post(
        f"{API}/knowledge-documents/{doc['id']}/reindex",
        headers=superuser_token_headers,
    )
    client.post(
        f"{API}/knowledge-documents/{doc['id']}/deactivate",
        headers=superuser_token_headers,
    )
    voice = client.post(
        f"{API}/brands/{brand['id']}/voice-profile/versions",
        headers=superuser_token_headers,
        json={"persona": "亲切"},
    )
    client.post(
        f"{API}/brands/{brand['id']}/voice-profile/versions/{voice.json()['version']}/activate",
        headers=superuser_token_headers,
    )
    product = client.post(
        f"{API}/brands/{brand['id']}/products",
        headers=superuser_token_headers,
        json={"name": "商品"},
    ).json()
    client.post(
        f"{API}/products/{product['id']}/archive", headers=superuser_token_headers
    )

    db.expire_all()
    rows = db.exec(select(AuditLog).where(AuditLog.brand_id == brand_id)).all()
    assert {r.action for r in rows} == {
        "knowledge.admin_direct_ingest",
        "knowledge.reindex",
        "knowledge.deactivate",
        "voice_profile.activate",
        "product.archive",
    }
    assert {r.actor_id for r in rows} == {admin.id}
    ingest = next(r for r in rows if r.action == "knowledge.admin_direct_ingest")
    assert ingest.entity_id == uuid.UUID(doc["id"]) and ingest.detail["version"] == 1


def test_demo_seed_is_complete_searchable_and_idempotent(
    db: Session, embedder: FakeEmbeddingProvider
) -> None:
    owner = crud.get_user_by_email(session=db, email=settings.FIRST_SUPERUSER)
    assert owner is not None

    brand = seed_demo(db, embedder, owner)
    assert brand is not None and brand.slug == DEMO_SLUG
    assert seed_demo(db, embedder, owner) is None  # second run does nothing

    docs = db.exec(select(KbDocument).where(KbDocument.brand_id == brand.id)).all()
    assert len(docs) == 5 and {d.status for d in docs} == {"approved"}
    products = db.exec(select(Product).where(Product.brand_id == brand.id)).all()
    assert len(products) == 3
    statuses = {
        p.name: [sp.get("source_document_id") is not None for sp in p.selling_points]
        for p in products
    }
    assert statuses["晨雾淡香水（演示）"] == [
        True,
        False,
    ]  # one sourced, one draft selling point
    active = db.exec(
        select(BrandVoiceProfile).where(
            BrandVoiceProfile.brand_id == brand.id, BrandVoiceProfile.is_active
        )
    ).all()
    assert [v.version for v in active] == [1]

    datasets = db.exec(
        select(EvalDataset).where(EvalDataset.brand_id == brand.id)
    ).all()
    assert {d.kind for d in datasets} == {"compliance", "factcheck", "generation"}
    assert all(d.name.endswith("（演示）") and d.case_count >= 2 for d in datasets)

    hits = DbKnowledgeSearch(db, embedder).search(
        brand_id=brand.id, query="佛手柑 前调"
    )
    assert hits and all(h.source_level == "approved_kb" for h in hits)
