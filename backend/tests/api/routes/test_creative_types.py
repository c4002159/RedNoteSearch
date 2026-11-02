"""A brand's own creative types next to the six built-in ones. Needs the database."""

from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.models import Brand, Tenant
from app.services.scenarios import ensure_default_scenarios
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


def _types(client: TestClient, h: dict[str, str], brand: str) -> list[dict[str, Any]]:
    r = client.get(f"{API}/brands/{brand}/creative-types", headers=h)
    assert r.status_code == 200, r.text
    return r.json()["items"]  # type: ignore[no-any-return]


def _template(
    client: TestClient, h: dict[str, str], brand: str, scene: str, name: str = "探店"
) -> Any:
    return client.post(
        f"{API}/brands/{brand}/scenario-templates",
        headers=h,
        json={"scene": scene, "name": name, "structure": "开头 中间 结尾"},
    )


def test_builtin_types_are_listed_first_and_cannot_be_changed(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)["id"]
    items = _types(client, h, brand)
    assert [i["key"] for i in items] == [
        "seeding",
        "review",
        "tutorial",
        "launch",
        "promotion",
        "story",
    ]
    assert all(i["builtin"] for i in items) and items[0]["name"] == "种草"
    assert items[0]["template_count"] >= 1  # the global template
    base = f"{API}/brands/{brand}/creative-types"
    assert (
        client.patch(f"{base}/seeding", headers=h, json={"name": "x"}).status_code
        == 409
    )
    assert client.delete(f"{base}/seeding", headers=h).status_code == 409


def test_create_rename_and_use_a_custom_type(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)["id"]
    base = f"{API}/brands/{brand}/creative-types"
    created = client.post(base, headers=h, json={"name": "  探店 "})
    assert created.status_code == 201, created.text
    key = created.json()["key"]
    assert created.json()["name"] == "探店" and created.json()["builtin"] is False
    assert [i["key"] for i in _types(client, h, brand)][-1] == key

    # a template of the new type
    made = _template(client, h, brand, key)
    assert made.status_code == 201 and made.json()["scene"] == key
    assert _types(client, h, brand)[-1]["template_count"] == 1

    # renaming keeps the key, so the template follows
    renamed = client.patch(f"{base}/{key}", headers=h, json={"name": "探店打卡"})
    assert renamed.status_code == 200 and renamed.json()["key"] == key
    assert renamed.json()["template_count"] == 1
    assert _types(client, h, brand)[-1]["name"] == "探店打卡"

    # keeps its own name when renamed to itself; duplicates are refused
    assert (
        client.patch(f"{base}/{key}", headers=h, json={"name": "探店打卡"}).status_code
        == 200
    )
    other = client.post(base, headers=h, json={"name": "开箱"}).json()["key"]
    assert (
        client.patch(
            f"{base}/{other}", headers=h, json={"name": "探店打卡"}
        ).status_code
        == 409
    )


def test_names_are_validated_and_unique(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)["id"]
    base = f"{API}/brands/{brand}/creative-types"
    for bad in (
        {},
        {"name": ""},
        {"name": "   "},
        {"name": "长" * 21},
        {"name": "a", "x": 1},
    ):
        assert client.post(base, headers=h, json=bad).status_code == 422, bad
    assert client.post(base, headers=h, json={"name": "种草"}).status_code == 409
    assert client.post(base, headers=h, json={"name": "探店"}).status_code == 201
    assert client.post(base, headers=h, json={"name": "探店"}).status_code == 409


def test_a_brand_may_have_twenty_own_types(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)["id"]
    base = f"{API}/brands/{brand}/creative-types"
    for n in range(20):
        assert (
            client.post(base, headers=h, json={"name": f"类型{n}"}).status_code == 201
        )
    assert client.post(base, headers=h, json={"name": "多一个"}).status_code == 409


def test_unknown_or_other_brands_types_are_refused_for_templates(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)["id"]
    other = _create_brand(client, h)["id"]
    foreign = client.post(
        f"{API}/brands/{other}/creative-types", headers=h, json={"name": "别家"}
    ).json()["key"]
    for scene in ("nonsense", foreign, ""):
        assert _template(client, h, brand, scene).status_code == 422, scene
    assert _template(client, h, other, foreign).status_code == 201


def test_a_type_in_use_cannot_be_deleted(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)["id"]
    base = f"{API}/brands/{brand}/creative-types"
    used = client.post(base, headers=h, json={"name": "探店"}).json()["key"]
    unused = client.post(base, headers=h, json={"name": "开箱"}).json()["key"]
    template = _template(client, h, brand, used).json()

    blocked = client.delete(f"{base}/{used}", headers=h)
    assert blocked.status_code == 409
    assert blocked.json()["error"]["details"]["templates"] == 1

    # switching the template off does not free the type: tasks may still point at it
    client.patch(
        f"{API}/scenario-templates/{template['id']}", headers=h, json={"enabled": False}
    )
    assert client.delete(f"{base}/{used}", headers=h).status_code == 409

    assert client.delete(f"{base}/{unused}", headers=h).status_code == 204
    assert unused not in [i["key"] for i in _types(client, h, brand)]
    assert client.delete(f"{base}/{unused}", headers=h).status_code == 404
    assert _template(client, h, brand, unused, "新").status_code == 422


def test_only_admins_change_types_and_only_members_see_them(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)["id"]
    base = f"{API}/brands/{brand}/creative-types"
    key = client.post(base, headers=h, json={"name": "探店"}).json()["key"]

    editor, editor_h = _make_user(client, db)
    _add_member(client, h, brand, editor, "editor")
    assert client.get(base, headers=editor_h).status_code == 200
    assert client.post(base, headers=editor_h, json={"name": "新"}).status_code == 403
    assert (
        client.patch(f"{base}/{key}", headers=editor_h, json={"name": "新"}).status_code
        == 403
    )
    assert client.delete(f"{base}/{key}", headers=editor_h).status_code == 403

    _, outsider = _make_user(client, db)
    assert client.get(base, headers=outsider).status_code == 403
    assert client.post(base, headers=outsider, json={"name": "新"}).status_code == 403
    assert client.get(base).status_code == 401
