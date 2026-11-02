"""Brand scenario templates: create, version, switch off, and the link back to a viral structure."""

import json
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.api.routes.viral import get_viral_llm_factory
from app.core.config import settings
from app.fakes.llm import FakeLlmClient
from app.main import app
from app.models import Brand, Tenant
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user
from tests.api.routes.test_viral import analyze, sample
from tests.domain.test_viral import ANALYSIS

API = settings.API_V1_STR


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


def _create(
    client: TestClient, headers: dict[str, str], brand_id: str, **body: Any
) -> Any:
    payload = {"scene": "seeding", "name": "晨间通勤", "structure": "开头点题。"}
    return client.post(
        f"{API}/brands/{brand_id}/scenario-templates",
        headers=headers,
        json={**payload, **body},
    )


def test_create_version_disable_and_workbench_list(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    first = _create(client, h, brand["id"], name="  晨间通勤  ")
    assert first.status_code == 201, first.text
    assert first.json()["template_version"] == 1
    assert first.json()["name"] == "晨间通勤"
    assert first.json()["enabled"] is True
    second = _create(client, h, brand["id"], structure="开头点题。结尾提问。")
    assert second.json()["template_version"] == 2

    listing = client.get(
        f"{API}/brands/{brand['id']}/scenario-templates", headers=h
    ).json()["items"]
    own = [r for r in listing if r["brand_id"] == brand["id"]]
    assert [(r["template_version"], r["enabled"]) for r in own] == [
        (2, True),
        (1, False),
    ]
    assert any(r["brand_id"] is None for r in listing)  # the global ones come along

    # the workbench list only offers the newest, enabled version
    workbench = client.get(f"{API}/scenarios", headers=h).json()["items"]
    mine = [r for r in workbench if r["brand_id"] == brand["id"]]
    assert [r["id"] for r in mine] == [second.json()["id"]]

    # an older version cannot be switched back on; the newest can be switched off and on
    url = f"{API}/scenario-templates"
    old = own[1]["id"]
    assert (
        client.patch(f"{url}/{old}", headers=h, json={"enabled": True}).status_code
        == 409
    )
    new = second.json()["id"]
    off = client.patch(f"{url}/{new}", headers=h, json={"enabled": False})
    assert off.status_code == 200 and off.json()["enabled"] is False
    assert not [
        r
        for r in client.get(f"{API}/scenarios", headers=h).json()["items"]
        if r["brand_id"] == brand["id"]
    ]
    on = client.patch(f"{url}/{new}", headers=h, json={"enabled": True})
    assert on.json()["enabled"] is True


def test_validation_roles_and_isolation(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    editor, eh = _make_user(client, db)
    _add_member(client, h, brand["id"], editor, "editor")
    _, oh = _make_user(client, db)
    row = _create(client, h, brand["id"]).json()
    base = f"{API}/brands/{brand['id']}/scenario-templates"

    for body in (
        {"name": "   "},
        {"structure": ""},
        {"structure": "x" * 2001},
        {"scene": "nope"},
        {"extra": 1},
    ):
        assert _create(client, h, brand["id"], **body).status_code == 422

    # members may read, only admins may write; outsiders see nothing
    assert client.get(base, headers=eh).status_code == 200
    assert _create(client, eh, brand["id"]).status_code == 403
    assert client.get(base, headers=oh).status_code == 403
    assert _create(client, oh, brand["id"]).status_code == 403
    assert client.get(base).status_code == 401
    one = f"{API}/scenario-templates/{row['id']}"
    for headers, code in ((eh, 403), (oh, 404)):
        r = client.patch(one, headers=headers, json={"enabled": False})
        assert r.status_code == code
    assert client.patch(one, json={"enabled": False}).status_code == 401
    missing = f"{API}/scenario-templates/{uuid.uuid4()}"
    assert client.patch(missing, headers=h, json={"enabled": False}).status_code == 404
    # a global template is not editable here
    global_id = next(
        r["id"]
        for r in client.get(f"{API}/scenarios", headers=h).json()["items"]
        if r["brand_id"] is None
    )
    assert (
        client.patch(
            f"{API}/scenario-templates/{global_id}",
            headers=h,
            json={"enabled": False},
        ).status_code
        == 404
    )


def test_viral_conversion_links_source_and_replaces_older_version(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    fake = FakeLlmClient([json.dumps(ANALYSIS, ensure_ascii=False)])
    app.dependency_overrides[get_viral_llm_factory] = lambda: lambda _b, _m: fake
    try:
        brand = _create_brand(client, h)
        p = analyze(client, h, sample(client, h, brand["id"])["id"])
        url = f"{API}/viral-patterns/{p['id']}/to-template"
        body = {"name": "爆款结构", "scene": "story"}
        r1 = client.post(url, headers=h, json=body)
        r2 = client.post(url, headers=h, json=body)
    finally:
        app.dependency_overrides.pop(get_viral_llm_factory, None)
    assert r1.status_code == r2.status_code == 201
    assert r2.json()["template_version"] == 2
    assert r2.json()["source_pattern_id"] == p["id"]
    assert r2.json()["source_pattern_title"] == p["hook_type"]
    mine = [
        r
        for r in client.get(f"{API}/scenarios", headers=h).json()["items"]
        if r["brand_id"] == brand["id"]
    ]
    assert [r["id"] for r in mine] == [r2.json()["id"]]  # v1 switched off


def test_task_shows_the_template_version_it_used(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    product = client.post(
        f"{API}/brands/{brand['id']}/products",
        headers=h,
        json={"name": "夜行", "category": "perfume"},
    ).json()
    _create(client, h, brand["id"])
    template = _create(client, h, brand["id"]).json()  # version 2
    r = client.post(
        f"{API}/tasks",
        headers=h,
        json={
            "brand_id": brand["id"],
            "product_id": product["id"],
            "scenario_id": template["id"],
        },
    )
    assert r.status_code in (201, 202), r.text
    task = client.get(f"{API}/tasks/{r.json()['id']}", headers=h).json()
    assert (task["scenario_name"], task["scenario_version"]) == ("晨间通勤", 2)
