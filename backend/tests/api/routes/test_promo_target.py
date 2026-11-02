"""What a task promotes: one product, several products, or an activity with no product.

Needs the database. The model is a scripted fake; no real model is called.
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
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _create_brand, _make_user

API = settings.API_V1_STR

GOOD = json.dumps(
    {
        "title_candidates": ["双十一香氛小记"],
        "body": "木质香调很柔和，适合通勤。",
        "hashtags": ["日常香氛"],
        "cover_candidates": ["通勤香气"],
    },
    ensure_ascii=False,
)


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


@pytest.fixture
def fake_llm() -> Generator[FakeLlmClient]:
    llm = FakeLlmClient([GOOD])
    embedder = FakeEmbeddingProvider()
    app.dependency_overrides[get_llm_factory] = lambda: lambda _b, _t: llm
    app.dependency_overrides[get_embedder] = lambda: embedder
    yield llm
    app.dependency_overrides.pop(get_llm_factory, None)
    app.dependency_overrides.pop(get_embedder, None)


def _product(
    client: TestClient,
    headers: dict[str, str],
    brand_id: str,
    name: str,
    **extra: Any,
) -> dict[str, Any]:
    r = client.post(
        f"{API}/brands/{brand_id}/products",
        headers=headers,
        json={"name": name, "category": "perfume", **extra},
    )
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def _scenario(client: TestClient, headers: dict[str, str]) -> str:
    return str(client.get(f"{API}/scenarios", headers=headers).json()["items"][0]["id"])


def _create(
    client: TestClient, headers: dict[str, str], brand_id: str, **body: Any
) -> Any:
    return client.post(
        f"{API}/tasks",
        headers=headers,
        json={
            "brand_id": brand_id,
            "scenario_id": _scenario(client, headers),
            **body,
        },
    )


def _prompt(llm: FakeLlmClient) -> str:
    return [r for r in llm.requests if r.purpose == "generate"][0].messages[1].content


def test_multi_product_task_shows_every_product_and_prompts_with_all(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    fake_llm: FakeLlmClient,
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    a = _product(
        client,
        h,
        brand["id"],
        "晨雾",
        selling_points=[{"text": "木质香调"}],
        restricted_claims=["提升魅力"],
    )
    b = _product(
        client,
        h,
        brand["id"],
        "暮色",
        selling_points=[{"text": "琥珀尾调"}],
        restricted_claims=["提升魅力", "持久一整天"],
    )
    r = _create(
        client,
        h,
        brand["id"],
        promo_type="multi_product",
        product_id=a["id"],
        extra_product_ids=[b["id"]],
    )
    assert r.status_code == 201, r.text
    task = client.get(f"{API}/tasks/{r.json()['id']}", headers=h).json()
    assert task["promo_type"] == "multi_product"
    assert task["product_id"] == a["id"] and task["extra_product_ids"] == [b["id"]]
    assert task["product_name"] == "晨雾、暮色" and task["activity"] is None

    client.post(f"{API}/tasks/{task['id']}/generate", headers=h)
    prompt = _prompt(fake_llm)
    assert "晨雾、暮色" in prompt and "不要把一款的卖点写成另一款的" in prompt
    assert "晨雾：木质香调" in prompt and "暮色：琥珀尾调" in prompt
    assert "提升魅力" in prompt and "持久一整天" in prompt
    assert prompt.count("提升魅力") == 1  # a claim two products share is listed once
    assert (
        client.get(f"{API}/tasks/{task['id']}", headers=h).json()["flow_status"]
        == "checks_completed"
    )


def test_activity_task_has_no_product_and_keeps_the_operators_text(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    fake_llm: FakeLlmClient,
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    r = _create(
        client,
        h,
        brand["id"],
        promo_type="activity",
        activity={
            "name": " 双十一香氛节 ",
            "detail": "全场香氛限时活动",
            "perks": [" 满 500 减 50 ", "", "赠香氛小样"],
        },
    )
    assert r.status_code == 201, r.text
    task = client.get(f"{API}/tasks/{r.json()['id']}", headers=h).json()
    assert task["promo_type"] == "activity" and task["product_id"] is None
    assert task["product_name"] == "双十一香氛节"
    assert task["activity"] == {
        "name": "双十一香氛节",
        "detail": "全场香氛限时活动",
        "perks": ["满 500 减 50", "赠香氛小样"],
    }

    listed = client.get(
        f"{API}/tasks?brand_id={brand['id']}&q=双十一", headers=h
    ).json()
    assert [t["id"] for t in listed["items"]] == [task["id"]] and listed["total"] == 1

    client.post(f"{API}/tasks/{task['id']}/generate", headers=h)
    prompt = _prompt(fake_llm)
    assert "活动「双十一香氛节」" in prompt and "全场香氛限时活动" in prompt
    assert "运营提供的活动福利" in prompt and "满 500 减 50" in prompt
    assert "商品：" not in prompt
    assert (
        client.get(f"{API}/tasks/{task['id']}", headers=h).json()["flow_status"]
        == "checks_completed"
    )

    # recheck works without any product
    version_id = client.get(f"{API}/tasks/{task['id']}", headers=h).json()[
        "latest_version_id"
    ]
    again = client.post(f"{API}/generation-versions/{version_id}/recheck", headers=h)
    assert again.status_code in (200, 202), again.text


def test_promo_target_validation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    a = _product(client, h, brand["id"], "晨雾")
    b = _product(client, h, brand["id"], "暮色")
    activity = {"name": "双十一"}
    bad_bodies: list[dict[str, Any]] = [
        {"promo_type": "activity"},  # no activity
        {"promo_type": "activity", "activity": activity, "product_id": a["id"]},
        {"promo_type": "product"},  # no product
        {"promo_type": "product", "product_id": a["id"], "activity": activity},
        {
            "promo_type": "product",
            "product_id": a["id"],
            "extra_product_ids": [b["id"]],
        },
        {"promo_type": "multi_product", "product_id": a["id"]},
        {
            "promo_type": "multi_product",
            "product_id": a["id"],
            "extra_product_ids": [a["id"]],
        },
        {"promo_type": "activity", "activity": {"name": "  "}},
        {"promo_type": "activity", "activity": {"name": "x", "perks": ["长" * 201]}},
        {"promo_type": "other", "product_id": a["id"]},
    ]
    for body in bad_bodies:
        assert _create(client, h, brand["id"], **body).status_code == 422, body
    # the old request shape still works
    assert _create(client, h, brand["id"], product_id=a["id"]).status_code == 201


def test_every_product_must_be_the_brands_and_active(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    other = _create_brand(client, h)
    a = _product(client, h, brand["id"], "晨雾")
    b = _product(client, h, brand["id"], "暮色")
    foreign = _product(client, h, other["id"], "别家")
    body = {"promo_type": "multi_product", "product_id": a["id"]}

    r = _create(client, h, brand["id"], **body, extra_product_ids=[foreign["id"]])
    assert r.status_code == 404

    client.post(f"{API}/products/{b['id']}/archive", headers=h)
    r = _create(client, h, brand["id"], **body, extra_product_ids=[b["id"]])
    assert r.status_code == 409


def test_non_member_cannot_create_a_promo_task(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    _, outsider = _make_user(client, db)
    r = _create(
        client,
        outsider,
        brand["id"],
        promo_type="activity",
        activity={"name": "双十一"},
    )
    assert r.status_code in (403, 404)
