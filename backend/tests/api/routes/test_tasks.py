"""Scenarios, style presets, tasks and generation versions. Needs the database."""

import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.api.routes.knowledge import get_embedder
from app.core.config import settings
from app.fakes.embedding import FakeEmbeddingProvider
from app.main import app
from app.models import (
    AuditLog,
    Brand,
    GenerationVersion,
    ScenarioTemplate,
    Task,
    TaskInput,
    Tenant,
)
from app.services.knowledge_search import DbKnowledgeSearch
from app.services.scenarios import DEFAULT_SCENARIOS, ensure_default_scenarios
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR


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


def _scenario_id(client: TestClient, headers: dict[str, str]) -> str:
    items = client.get(f"{API}/scenarios", headers=headers).json()["items"]
    return str(items[0]["id"])


def _product(
    client: TestClient, headers: dict[str, str], brand_id: str
) -> dict[str, Any]:
    r = client.post(
        f"{API}/brands/{brand_id}/products",
        headers=headers,
        json={"name": "晨雾", "category": "perfume"},
    )
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def _task_body(
    brand_id: str, product_id: str, scenario_id: str, **extra: Any
) -> dict[str, Any]:
    return {
        "brand_id": brand_id,
        "product_id": product_id,
        "scenario_id": scenario_id,
        **extra,
    }


def test_default_scenarios_are_created_once_and_listed(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    assert ensure_default_scenarios(db) == 0  # the fixture already created them
    assert (
        db.exec(
            select(ScenarioTemplate).where(ScenarioTemplate.brand_id.is_(None))
        ).all()  # type: ignore[union-attr]
        and len(DEFAULT_SCENARIOS) == 6
    )
    items = client.get(f"{API}/scenarios", headers=superuser_token_headers).json()[
        "items"
    ]
    scenes = {i["scene"] for i in items}
    assert scenes == {"seeding", "review", "tutorial", "launch", "promotion", "story"}
    assert all(i["brand_id"] is None and i["template_version"] == 1 for i in items)
    assert client.get(f"{API}/scenarios").status_code == 401


def test_brand_templates_are_only_visible_to_members(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    member, member_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], member, "editor")
    db.add(
        ScenarioTemplate(
            brand_id=uuid.UUID(brand["id"]),
            scene="story",
            name="专属故事",
            structure="x",
        )
    )
    db.add(
        ScenarioTemplate(
            brand_id=uuid.UUID(brand["id"]),
            scene="story",
            name="已停用",
            structure="x",
            enabled=False,
        )
    )
    db.commit()

    names = lambda h: {  # noqa: E731
        i["name"] for i in client.get(f"{API}/scenarios", headers=h).json()["items"]
    }
    assert "专属故事" in names(member_headers) and "已停用" not in names(member_headers)
    assert "专属故事" not in names(outsider_headers)


def test_style_presets(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    editor, editor_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    url = f"{API}/brands/{brand['id']}/style-presets"

    created = client.post(
        url,
        headers=editor_headers,
        json={"name": "通勤", "params": {"tone": "克制", "hashtag_count": 3}},
    )
    assert created.status_code == 201
    assert created.json()["params"]["hashtag_count"] == 3
    assert created.json()["params"]["length"] == "medium"  # defaults filled in
    listed = client.get(url, headers=superuser_token_headers).json()["items"]
    assert [p["name"] for p in listed] == ["通勤"]
    assert client.get(url, headers=outsider_headers).status_code == 403
    assert (
        client.post(url, headers=outsider_headers, json={"name": "x"}).status_code
        == 403
    )
    for bad in (
        {"name": ""},
        {"name": "x", "params": {"hashtag_count": 11}},
        {"name": "x", "params": {"length": "huge"}},
    ):
        assert client.post(url, headers=editor_headers, json=bad).status_code == 422


def test_create_task_snapshots_materials_and_audits(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    product = _product(client, superuser_token_headers, brand["id"])
    phrase = f"临时资料{uuid.uuid4().hex[:8]}"

    r = client.post(
        f"{API}/tasks",
        headers=superuser_token_headers,
        json=_task_body(
            brand["id"],
            product["id"],
            _scenario_id(client, superuser_token_headers),
            brief="  突出木质香调  ",
            required_terms=["木质香调", " ", "木质香调", "通勤"],
            task_materials=[
                {"filename": "brief.txt", "text": f"用户提供的资料：{phrase}"}
            ],
        ),
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["status"] == "queued" and created["brand_id"] == brand["id"]

    detail = client.get(
        f"{API}/tasks/{created['id']}", headers=superuser_token_headers
    ).json()
    assert detail["brief"] == "突出木质香调"
    assert detail["required_terms"] == [
        "木质香调",
        "通勤",
    ]  # blanks and duplicates removed
    assert detail["style"]["length"] == "medium" and detail["progress"] == {
        "stage": None
    }
    assert detail["flow_status"] == "queued" and detail["latest_version_id"] is None

    task_id = uuid.UUID(created["id"])
    snapshots = db.exec(select(TaskInput).where(TaskInput.task_id == task_id)).all()
    assert len(snapshots) == 1 and snapshots[0].filename == "brief.txt"
    hits = DbKnowledgeSearch(db, embedder).search(
        brand_id=uuid.UUID(brand["id"]), query=phrase, task_id=task_id
    )
    assert [h.source_level for h in hits] == ["task_material"]
    audit = db.exec(select(AuditLog).where(AuditLog.entity_id == task_id)).all()
    assert [a.action for a in audit] == ["task.create"]


def test_create_task_is_all_or_nothing(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    product = _product(client, superuser_token_headers, brand["id"])
    body = _task_body(
        brand["id"],
        product["id"],
        _scenario_id(client, superuser_token_headers),
        task_materials=[{"filename": "a.txt", "text": "资料"}],
    )
    embedder.fail = True
    down = client.post(f"{API}/tasks", headers=superuser_token_headers, json=body)
    assert down.status_code == 503
    db.expire_all()
    assert (
        db.exec(select(Task).where(Task.brand_id == uuid.UUID(brand["id"]))).all() == []
    )
    assert (
        db.exec(
            select(TaskInput).where(TaskInput.brand_id == uuid.UUID(brand["id"]))
        ).all()
        == []
    )


@pytest.mark.usefixtures("embedder")
def test_create_task_validates_authorization_and_ownership(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    brand_a = _create_brand(client, superuser_token_headers)
    brand_b = _create_brand(client, superuser_token_headers)
    product_a = _product(client, superuser_token_headers, brand_a["id"])
    product_b = _product(client, superuser_token_headers, brand_b["id"])
    scenario = _scenario_id(client, superuser_token_headers)
    user, headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand_a["id"], user, "editor")
    post = lambda h, b: client.post(f"{API}/tasks", headers=h, json=b)  # noqa: E731

    assert (
        post(headers, _task_body(brand_a["id"], product_a["id"], scenario)).status_code
        == 201
    )
    # Not a member of brand B: forbidden, whatever else the body says.
    assert (
        post(headers, _task_body(brand_b["id"], product_b["id"], scenario)).status_code
        == 403
    )
    # A product of another brand looks missing even to a member of the requested brand.
    assert (
        post(headers, _task_body(brand_a["id"], product_b["id"], scenario)).status_code
        == 404
    )
    assert (
        post(
            headers, _task_body(brand_a["id"], str(uuid.uuid4()), scenario)
        ).status_code
        == 404
    )
    assert (
        post(
            headers, _task_body(brand_a["id"], product_a["id"], str(uuid.uuid4()))
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{API}/tasks", json=_task_body(brand_a["id"], product_a["id"], scenario)
        ).status_code
        == 401
    )

    # Another brand's own template cannot be used.
    other = ScenarioTemplate(
        brand_id=uuid.UUID(brand_b["id"]), scene="story", name="B 专属", structure="x"
    )
    db.add(other)
    db.commit()
    assert (
        post(
            headers, _task_body(brand_a["id"], product_a["id"], str(other.id))
        ).status_code
        == 404
    )

    # Archived products cannot start new tasks.
    client.post(
        f"{API}/products/{product_a['id']}/archive", headers=superuser_token_headers
    )
    assert (
        post(headers, _task_body(brand_a["id"], product_a["id"], scenario)).status_code
        == 409
    )

    for bad in (
        {"brief": "x" * 2001},
        {"required_terms": ["a"] * 21},
        {"task_materials": [{"filename": "a", "text": "t"}] * 6},
        {"task_materials": [{"filename": "a", "text": ""}]},
        {"style": {"person": "fourth"}},
    ):
        product_c = _product(client, superuser_token_headers, brand_a["id"])
        r = post(
            superuser_token_headers,
            _task_body(brand_a["id"], product_c["id"], scenario, **bad),
        )
        assert r.status_code == 422, bad


@pytest.mark.usefixtures("embedder")
def test_task_listing_filters_sorts_and_paginates(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    product = _product(client, superuser_token_headers, brand["id"])
    scenario = _scenario_id(client, superuser_token_headers)
    ids = [
        client.post(
            f"{API}/tasks",
            headers=superuser_token_headers,
            json=_task_body(brand["id"], product["id"], scenario, brief=f"任务{i}"),
        ).json()["id"]
        for i in range(3)
    ]
    url = f"{API}/tasks?brand_id={brand['id']}"

    newest = client.get(url, headers=superuser_token_headers).json()
    assert newest["total"] == 3 and [t["id"] for t in newest["items"]] == ids[::-1]
    oldest = client.get(
        f"{url}&sort=created_at", headers=superuser_token_headers
    ).json()
    assert [t["id"] for t in oldest["items"]] == ids
    page = client.get(
        f"{url}&page=2&page_size=2", headers=superuser_token_headers
    ).json()
    assert len(page["items"]) == 1 and page["page"] == 2
    assert (
        client.get(f"{url}&status=queued", headers=superuser_token_headers).json()[
            "total"
        ]
        == 3
    )
    assert (
        client.get(
            f"{url}&status=ready_to_copy", headers=superuser_token_headers
        ).json()["total"]
        == 0
    )
    for bad in ("page_size=101", "page=0", "status=gone", "sort=title"):
        assert (
            client.get(f"{url}&{bad}", headers=superuser_token_headers).status_code
            == 422
        ), bad
    assert (
        client.get(f"{API}/tasks", headers=superuser_token_headers).status_code == 422
    )  # brand_id required


@pytest.mark.usefixtures("embedder")
def test_tasks_and_versions_are_isolated_between_brands(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    product = _product(client, superuser_token_headers, brand["id"])
    task = client.post(
        f"{API}/tasks",
        headers=superuser_token_headers,
        json=_task_body(
            brand["id"], product["id"], _scenario_id(client, superuser_token_headers)
        ),
    ).json()
    version = GenerationVersion(
        task_id=uuid.UUID(task["id"]),
        brand_id=uuid.UUID(brand["id"]),
        version_no=1,
        title_candidates=["标题"],
        body="正文",
        hashtags=["日常"],
    )
    db.add(version)
    db.commit()
    member, member_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], member, "editor")

    # Members read; outsiders cannot tell the task or version exists.
    assert (
        client.get(f"{API}/tasks/{task['id']}", headers=member_headers).status_code
        == 200
    )
    versions = client.get(
        f"{API}/tasks/{task['id']}/versions", headers=member_headers
    ).json()["items"]
    assert [(v["version_no"], v["title_candidates"]) for v in versions] == [
        (1, ["标题"])
    ]
    detail = client.get(
        f"{API}/generation-versions/{version.id}", headers=member_headers
    )
    assert detail.status_code == 200 and detail.json()["flow_status"] == "generating"
    for path in (
        f"/tasks/{task['id']}",
        f"/tasks/{task['id']}/versions",
        f"/generation-versions/{version.id}",
        f"/tasks/{uuid.uuid4()}",
        f"/generation-versions/{uuid.uuid4()}",
    ):
        assert (
            client.get(f"{API}{path}", headers=outsider_headers).status_code == 404
        ), path
    assert (
        client.get(
            f"{API}/tasks?brand_id={brand['id']}", headers=outsider_headers
        ).status_code
        == 403
    )
    assert client.get(f"{API}/tasks/{task['id']}").status_code == 401
