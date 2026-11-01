"""Brand and member API plus the brand-level authorisation dependencies (TC-003, TC-004, TC-044)."""

import uuid
from collections.abc import Generator

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app import crud
from app.api.brand_deps import get_brand_access, get_brand_admin_access
from app.core.config import settings
from app.models import Brand, BrandMember, MemberRole, Tenant, User
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import random_email, random_lower_string

API = settings.API_V1_STR


@pytest.fixture(scope="module", autouse=True)
def cleanup_brands(db: Session) -> Generator[None]:
    yield
    db.rollback()
    db.execute(delete(Brand))  # cascades to members, documents and chunks
    db.execute(delete(Tenant))
    db.commit()


def _make_user(client: TestClient, db: Session) -> tuple[User, dict[str, str]]:
    email = random_email()
    headers = authentication_token_from_email(client=client, email=email, db=db)
    user = crud.get_user_by_email(session=db, email=email)
    assert user is not None
    return user, headers


def _create_brand(
    client: TestClient, headers: dict[str, str], name: str | None = None
) -> dict[str, str]:
    r = client.post(
        f"{API}/brands",
        headers=headers,
        json={
            "name": name or f"Brand {random_lower_string()[:8]}",
            "category": "perfume",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _add_member(
    client: TestClient,
    headers: dict[str, str],
    brand_id: str,
    user: User,
    role: str,
) -> None:
    r = client.post(
        f"{API}/brands/{brand_id}/members",
        headers=headers,
        json={"user_id": str(user.id), "role": role},
    )
    assert r.status_code == 201, r.text


def test_list_brands_requires_authentication(client: TestClient) -> None:
    assert client.get(f"{API}/brands").status_code == 401


def test_list_brands_returns_only_member_brands_with_role(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand_a = _create_brand(client, superuser_token_headers)
    brand_b = _create_brand(client, superuser_token_headers)
    editor, editor_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand_a["id"], editor, "editor")

    items = client.get(f"{API}/brands", headers=editor_headers).json()["items"]
    assert [(i["id"], i["role"]) for i in items] == [(brand_a["id"], "editor")]

    admin_items = client.get(f"{API}/brands", headers=superuser_token_headers).json()[
        "items"
    ]
    roles = {i["id"]: i["role"] for i in admin_items}
    assert roles[brand_a["id"]] == "admin"  # the creator became an admin
    assert roles[brand_b["id"]] == "admin"


def test_create_brand_requires_a_platform_administrator(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.post(
        f"{API}/brands", headers=normal_user_token_headers, json={"name": "Nope"}
    )
    assert r.status_code == 403


def test_create_brand_defaults_and_validation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    first = client.post(
        f"{API}/brands", headers=superuser_token_headers, json={"name": "冰希黎"}
    )
    second = client.post(
        f"{API}/brands", headers=superuser_token_headers, json={"name": "冰希黎"}
    )
    assert first.status_code == second.status_code == 201
    assert first.json()["category"] == "other"
    assert first.json()["slug"].startswith("brand-")
    assert first.json()["slug"] != second.json()["slug"]

    explicit = {"name": "Explicit", "slug": f"slug-{uuid.uuid4().hex[:8]}"}
    assert (
        client.post(
            f"{API}/brands", headers=superuser_token_headers, json=explicit
        ).status_code
        == 201
    )
    duplicate = client.post(
        f"{API}/brands", headers=superuser_token_headers, json=explicit
    )
    assert duplicate.status_code == 409

    for bad in (
        {"name": "x", "category": "furniture"},
        {"name": "x", "slug": "Bad Slug!"},
        {"name": ""},
    ):
        r = client.post(f"{API}/brands", headers=superuser_token_headers, json=bad)
        assert r.status_code == 422, bad


def test_update_brand_permissions(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    admin, admin_headers = _make_user(client, db)
    editor, editor_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], admin, "admin")
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    url = f"{API}/brands/{brand['id']}"

    ok = client.patch(url, headers=admin_headers, json={"name": "Renamed"})
    assert ok.status_code == 200 and ok.json()["name"] == "Renamed"
    assert (
        client.patch(url, headers=editor_headers, json={"name": "x"}).status_code == 403
    )
    assert (
        client.patch(url, headers=outsider_headers, json={"name": "x"}).status_code
        == 403
    )
    assert (
        client.patch(
            url, headers=superuser_token_headers, json={"category": "skincare"}
        ).json()["category"]
        == "skincare"
    )
    missing = f"{API}/brands/{uuid.uuid4()}"
    assert (
        client.patch(
            missing, headers=superuser_token_headers, json={"name": "x"}
        ).status_code
        == 404
    )
    # A non-member addressing an unknown brand cannot tell whether it exists: 403.
    assert (
        client.patch(missing, headers=outsider_headers, json={"name": "x"}).status_code
        == 403
    )


def test_member_listing_permissions(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    admin, admin_headers = _make_user(client, db)
    editor, editor_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], admin, "admin")
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    url = f"{API}/brands/{brand['id']}/members"

    assert client.get(url, headers=editor_headers).status_code == 403
    assert client.get(url, headers=outsider_headers).status_code == 403
    for headers in (admin_headers, superuser_token_headers):
        r = client.get(url, headers=headers)
        assert r.status_code == 200
        roles = {m["user_id"]: m["role"] for m in r.json()["items"]}
        assert roles[str(admin.id)] == "admin" and roles[str(editor.id)] == "editor"


def test_add_member_rules(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    member, _ = _make_user(client, db)
    editor, editor_headers = _make_user(client, db)
    url = f"{API}/brands/{brand['id']}/members"
    _add_member(client, superuser_token_headers, brand["id"], member, "editor")
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")

    duplicate = client.post(
        url,
        headers=superuser_token_headers,
        json={"user_id": str(member.id), "role": "editor"},
    )
    assert duplicate.status_code == 409
    unknown = client.post(
        url,
        headers=superuser_token_headers,
        json={"user_id": str(uuid.uuid4()), "role": "editor"},
    )
    assert unknown.status_code == 404
    bad_role = client.post(
        url,
        headers=superuser_token_headers,
        json={"user_id": str(member.id), "role": "owner"},
    )
    assert bad_role.status_code == 422
    by_editor = client.post(
        url, headers=editor_headers, json={"user_id": str(member.id), "role": "admin"}
    )
    assert by_editor.status_code == 403


def test_a_brand_keeps_at_least_one_admin(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    creator = crud.get_user_by_email(session=db, email=settings.FIRST_SUPERUSER)
    assert creator is not None
    second, _ = _make_user(client, db)
    base = f"{API}/brands/{brand['id']}/members"
    me = f"{base}/{creator.id}"

    # The creator is the only admin: demoting or removing them is refused.
    assert (
        client.patch(
            me, headers=superuser_token_headers, json={"role": "editor"}
        ).status_code
        == 409
    )
    assert client.delete(me, headers=superuser_token_headers).status_code == 409

    _add_member(client, superuser_token_headers, brand["id"], second, "admin")
    demoted = client.patch(me, headers=superuser_token_headers, json={"role": "editor"})
    assert demoted.status_code == 200 and demoted.json()["role"] == "editor"
    # The second admin is now the last one.
    assert (
        client.delete(
            f"{base}/{second.id}", headers=superuser_token_headers
        ).status_code
        == 409
    )


def test_remove_member(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    editor, _ = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    url = f"{API}/brands/{brand['id']}/members/{editor.id}"

    assert client.delete(url, headers=superuser_token_headers).status_code == 200
    assert client.delete(url, headers=superuser_token_headers).status_code == 404


def test_brand_access_dependencies(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    """The dependencies B's routes will use: members only, admins only, no bypass for platform admins."""
    brand = _create_brand(client, superuser_token_headers)
    brand_id = uuid.UUID(brand["id"])
    editor, _ = _make_user(client, db)
    outsider, _ = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    superuser = crud.get_user_by_email(session=db, email=settings.FIRST_SUPERUSER)
    assert superuser is not None

    access = get_brand_access(brand_id, db, editor)
    assert access.role == MemberRole.EDITOR and access.brand_id == brand_id
    with pytest.raises(HTTPException) as no_access:
        get_brand_access(brand_id, db, outsider)
    assert no_access.value.status_code == 403
    with pytest.raises(HTTPException) as not_admin:
        get_brand_admin_access(access)
    assert not_admin.value.status_code == 403

    # A platform administrator who is not a member gets no access to brand-scoped data.
    other = _create_brand(client, superuser_token_headers)
    db.execute(
        delete(BrandMember).where(BrandMember.brand_id == uuid.UUID(other["id"]))
    )
    db.commit()
    with pytest.raises(HTTPException) as no_bypass:
        get_brand_access(uuid.UUID(other["id"]), db, superuser)
    assert no_bypass.value.status_code == 403


def test_add_member_by_email(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    admin, admin_headers = _make_user(client, db)
    editor, editor_headers = _make_user(client, db)
    newcomer, _ = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], admin, "admin")
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    url = f"{API}/brands/{brand['id']}/members"

    # a brand admin (not a platform admin) can add by email, case and spaces ignored
    ok = client.post(
        url,
        headers=admin_headers,
        json={"email": f"  {newcomer.email.upper()} ", "role": "editor"},
    )
    assert ok.status_code == 201
    assert ok.json()["user_id"] == str(newcomer.id)
    assert ok.json()["email"] == newcomer.email

    again = client.post(
        url, headers=admin_headers, json={"email": newcomer.email, "role": "editor"}
    )
    assert again.status_code == 409
    unknown = client.post(
        url,
        headers=admin_headers,
        json={"email": "nobody-here@example.com", "role": "editor"},
    )
    assert unknown.status_code == 404
    by_editor = client.post(
        url, headers=editor_headers, json={"email": newcomer.email, "role": "admin"}
    )
    assert by_editor.status_code == 403


def test_add_member_needs_exactly_one_identifier(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    user, _ = _make_user(client, db)
    url = f"{API}/brands/{brand['id']}/members"
    for body in (
        {"role": "editor"},
        {"user_id": str(user.id), "email": user.email, "role": "editor"},
        {"email": "", "role": "editor"},
    ):
        assert (
            client.post(url, headers=superuser_token_headers, json=body).status_code
            == 422
        )
