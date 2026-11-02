"""Product category requests retain the existing product permission boundaries."""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR


def test_custom_category_create_update_and_legacy_values(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    headers = superuser_token_headers
    brand = _create_brand(client, headers)["id"]
    url = f"{API}/brands/{brand}/products"
    response = client.post(
        url, headers=headers, json={"name": "固体香", "category": " 香膏 "}
    )
    assert response.status_code == 201, response.text
    assert response.json()["category"] == "香膏"
    item = f"{API}/products/{response.json()['id']}"
    for category, expected in [
        ("香水", "perfume"),
        ("护肤", "skincare"),
        ("彩妆", "makeup"),
        ("家居香氛", "home_fragrance"),
        ("其他", "other"),
        ("固体香", "固体香"),
    ]:
        patched = client.patch(item, headers=headers, json={"category": category})
        assert patched.status_code == 200 and patched.json()["category"] == expected
        created = client.post(
            url, headers=headers, json={"name": "新商品", "category": category}
        )
        assert created.status_code == 201 and created.json()["category"] == expected
    for category in ("perfume", "skincare", "makeup", "home_fragrance", "other"):
        created = client.post(
            url, headers=headers, json={"name": "旧键商品", "category": category}
        )
        assert created.status_code == 201 and created.json()["category"] == category
    for body in ({"category": None}, {"name": "更名"}):
        patched = client.patch(item, headers=headers, json=body)
        assert patched.status_code == 200 and patched.json()["category"] == "固体香"


@pytest.mark.parametrize(
    "category", ["", " ", "香" * 31, "香\n膏", "香膏\n", "香\t膏", "香\u200b膏", 1]
)
def test_invalid_categories_do_not_change_saved_product(
    client: TestClient, superuser_token_headers: dict[str, str], category: object
) -> None:
    headers = superuser_token_headers
    brand = _create_brand(client, headers)["id"]
    url = f"{API}/brands/{brand}/products"
    good = client.post(url, headers=headers, json={"name": "香膏", "category": "香膏"})
    assert good.status_code == 201
    item = f"{API}/products/{good.json()['id']}"
    assert (
        client.post(
            url, headers=headers, json={"name": "不写入", "category": category}
        ).status_code
        == 422
    )
    assert (
        client.patch(item, headers=headers, json={"category": category}).status_code
        == 422
    )
    listed = client.get(url, headers=headers)
    assert listed.status_code == 200
    assert listed.json()["items"][0]["category"] == "香膏"
    assert listed.json()["total"] == 1


def test_custom_category_keeps_product_auth_and_brand_category_enum(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    headers = superuser_token_headers
    brand = _create_brand(client, headers)["id"]
    editor, editor_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, headers, brand, editor, "editor")
    url = f"{API}/brands/{brand}/products"
    body = {"name": "香膏", "category": "香膏"}
    assert client.post(url, json=body).status_code == 401
    assert client.post(url, headers=editor_headers, json=body).status_code == 403
    assert client.post(url, headers=outsider_headers, json=body).status_code == 403
    item = client.post(url, headers=headers, json=body).json()
    assert (
        client.get(url, headers=editor_headers).json()["items"][0]["category"] == "香膏"
    )
    assert (
        client.patch(
            f"{API}/products/{item['id']}",
            headers=outsider_headers,
            json={"category": "other"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{API}/brands",
            headers=headers,
            json={"name": "不允许自定义品牌分类", "category": "香膏"},
        ).status_code
        == 422
    )
