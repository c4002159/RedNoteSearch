"""The ``q`` keyword on the product, task, knowledge and rule lists. Needs the database."""

import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.models import Brand, KbDocument, Tenant
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _create_brand

API = settings.API_V1_STR


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


def _names(body: dict[str, Any], key: str) -> list[str]:
    return [item[key] for item in body["items"]]


def _product(
    client: TestClient, headers: dict[str, str], brand_id: str, name: str
) -> dict[str, Any]:
    r = client.post(
        f"{API}/brands/{brand_id}/products",
        headers=headers,
        json={"name": name, "category": "perfume"},
    )
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def test_product_search_is_case_insensitive_and_escapes_wildcards(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    for name in ("晨雾 Mist", "100%纯净", "夜行"):
        _product(client, h, brand["id"], name)
    url = f"{API}/brands/{brand['id']}/products"

    assert _names(client.get(f"{url}?q=mist", headers=h).json(), "name") == [
        "晨雾 Mist"
    ]
    assert _names(client.get(f"{url}?q=%25", headers=h).json(), "name") == [
        "100%纯净"
    ]  # a literal %, not "match everything"
    assert client.get(f"{url}?q=_", headers=h).json()["total"] == 0
    assert (
        client.get(f"{url}?q=%20%20", headers=h).json()["total"] == 3
    )  # blank = no filter
    assert client.get(f"{url}?q={'a' * 101}", headers=h).status_code == 422


def test_task_search_matches_product_name(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    scenario = client.get(f"{API}/scenarios", headers=h).json()["items"][0]["id"]
    wanted = _product(client, h, brand["id"], "巴黎红")
    other = _product(client, h, brand["id"], "夜行")
    for product in (wanted, other, wanted):
        r = client.post(
            f"{API}/tasks",
            headers=h,
            json={
                "brand_id": brand["id"],
                "product_id": product["id"],
                "scenario_id": scenario,
            },
        )
        assert r.status_code in (201, 202), r.text
    url = f"{API}/tasks?brand_id={brand['id']}"
    found = client.get(f"{url}&q=巴黎", headers=h).json()
    assert found["total"] == 2
    assert set(_names(found, "product_name")) == {"巴黎红"}
    assert client.get(f"{url}&q=没有", headers=h).json()["total"] == 0
    assert client.get(url, headers=h).json()["total"] == 3


def test_knowledge_search_matches_title_and_file_name(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    for title, filename in (("品牌手册", "manual.pdf"), ("价格表", "price.csv")):
        db.add(
            KbDocument(
                brand_id=uuid.UUID(brand["id"]),
                title=title,
                doc_type="product_spec",
                status="approved",
                is_current=True,
                source_filename=filename,
            )
        )
    db.commit()
    url = f"{API}/brands/{brand['id']}/knowledge-documents"
    assert _names(client.get(f"{url}?q=手册", headers=h).json(), "title") == [
        "品牌手册"
    ]
    assert _names(client.get(f"{url}?q=PRICE", headers=h).json(), "title") == ["价格表"]
    assert (
        client.get(f"{url}?q=手册&status=pending_review", headers=h).json()["total"]
        == 0
    )  # combines with the other filters


def test_rule_search_matches_pattern_suggestion_and_source(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    url = f"{API}/brands/{brand['id']}/compliance-rules"
    for pattern, suggestion, source in (
        ("神仙水", "不要借用其他品牌", "品牌内部规定"),
        ("第一名", "改成客观描述", "广告法"),
    ):
        r = client.post(
            url,
            headers=h,
            json={
                "layer": "lexicon",
                "rule_type": "brand_forbidden",
                "pattern": pattern,
                "severity": "warn",
                "suggestion": suggestion,
                "source_name": source,
            },
        )
        assert r.status_code == 201, r.text
    list_url = f"{API}/compliance-rules?brand_id={brand['id']}&scope=brand"
    assert _names(client.get(f"{list_url}&q=神仙", headers=h).json(), "pattern") == [
        "神仙水"
    ]
    assert _names(client.get(f"{list_url}&q=客观", headers=h).json(), "pattern") == [
        "第一名"
    ]
    assert _names(client.get(f"{list_url}&q=广告法", headers=h).json(), "pattern") == [
        "第一名"
    ]
