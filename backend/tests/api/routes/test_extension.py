"""The browser extension's key and its one write endpoint. Needs the database."""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.domain.results import note_id
from app.models import AuditLog, ExtensionKey
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user
from tests.api.routes.test_results import _confirmed, _setup, cleanup, llm  # noqa: F401

API = settings.API_V1_STR
NOTE = "65a1b2c3d4e5f60718293a4b"
PAGE = f"https://www.xiaohongshu.com/explore/{NOTE}"


def _key(
    client: TestClient, h: dict[str, str], brand: str, label: str = "我的电脑"
) -> dict[str, Any]:
    r = client.post(
        f"{API}/brands/{brand}/extension-keys", headers=h, json={"label": label}
    )
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def _send(client: TestClient, key: str | None, **body: Any) -> Any:
    payload = {
        "note_url": PAGE,
        "likes": 21000,
        "collects": 539,
        "comments": 1575,
        **body,
    }
    headers = {"X-Extension-Key": key} if key else {}
    return client.post(f"{API}/extension/metrics", headers=headers, json=payload)


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (PAGE, NOTE),
        (f"{PAGE}?xsec_token=secret&xsec_source=pc_feed", NOTE),
        (f"https://www.xiaohongshu.com/discovery/item/{NOTE}", NOTE),
        (f"https://www.xiaohongshu.com/user/profile/5abc123/{NOTE}?x=1", NOTE),
        (f"https://m.xiaohongshu.com/explore/{NOTE}/", NOTE),
        (f"http://www.xiaohongshu.com/explore/{NOTE}", None),
        (f"https://evilxiaohongshu.com/explore/{NOTE}", None),
        (f"https://www.xiaohongshu.com/explore/{NOTE[:-1]}", None),
        (f"https://www.xiaohongshu.com/explore/{NOTE.upper()}", None),
        ("https://xhslink.com/a/xyz", None),
        ("", None),
    ],
)
def test_note_id_is_taken_from_the_path_only(url: str, expected: str | None) -> None:
    assert note_id(url) == expected


@pytest.mark.usefixtures("llm")
def test_keys_are_shown_once_stored_hashed_and_revocable(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)["id"]
    made = _key(client, h, brand)
    assert made["key"].startswith("rnk_") and made["prefix"] == made["key"][:8]
    listed = client.get(f"{API}/brands/{brand}/extension-keys", headers=h).json()[
        "items"
    ]
    assert [i["id"] for i in listed] == [made["id"]]
    assert "key" not in listed[0] and "key_hash" not in listed[0]

    row = db.exec(select(ExtensionKey).where(ExtensionKey.id == made["id"])).one()
    assert row.key_hash == hashlib.sha256(made["key"].encode()).hexdigest()
    assert made["key"] not in row.key_hash and row.revoked_at is None

    url = f"{API}/brands/{brand}/extension-keys/{made['id']}"
    assert client.delete(url, headers=h).status_code == 204
    assert (
        client.delete(url, headers=h).status_code == 204
    )  # revoking twice is harmless
    db.expire_all()
    assert db.get(ExtensionKey, row.id).revoked_at is not None  # type: ignore[union-attr]
    assert _send(client, made["key"]).status_code == 401

    for bad in (
        {},
        {"label": ""},
        {"label": "  "},
        {"label": "x" * 61},
        {"label": "a", "z": 1},
    ):
        assert (
            client.post(
                f"{API}/brands/{brand}/extension-keys", headers=h, json=bad
            ).status_code
            == 422
        )


@pytest.mark.usefixtures("llm")
def test_a_reading_from_the_extension_lands_on_the_matching_note(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _setup(client, h)
    copy = _confirmed(client, h, ctx)
    key = _key(client, h, ctx["brand"])["key"]

    # the note has no link yet
    missing = _send(client, key)
    assert missing.status_code == 404
    client.patch(
        f"{API}/confirmed-copies/{copy['id']}",
        headers=h,
        json={"post_url": f"{PAGE}?xsec_token=abc"},
    )

    ok = _send(client, key, approximate=True)
    assert ok.status_code == 201 and ok.json() == {
        "recorded": True,
        "approximate": True,
    }
    assert set(ok.json()) == {
        "recorded",
        "approximate",
    }  # nothing about the note comes back
    readings = client.get(
        f"{API}/confirmed-copies/{copy['id']}/metrics", headers=h
    ).json()["items"]
    assert len(readings) == 1
    assert (
        readings[0]["likes"],
        readings[0]["source"],
        readings[0]["approximate"],
    ) == (21000, "extension", True)
    listed = client.get(
        f"{API}/brands/{ctx['brand']}/extension-keys", headers=h
    ).json()["items"]
    assert listed[0]["last_used_at"] is not None

    # the page address of another note, or a non-note page, finds nothing / is refused
    other = f"https://www.xiaohongshu.com/explore/{'a' * 24}"
    assert _send(client, key, note_url=other).status_code == 404
    assert (
        _send(client, key, note_url="https://www.xiaohongshu.com/explore").status_code
        == 422
    )
    # a changed link moves the match; clearing it removes the match
    client.patch(
        f"{API}/confirmed-copies/{copy['id']}", headers=h, json={"post_url": other}
    )
    assert _send(client, key, note_url=other).status_code == 201
    client.patch(
        f"{API}/confirmed-copies/{copy['id']}", headers=h, json={"post_url": None}
    )
    assert _send(client, key, note_url=other).status_code == 404


@pytest.mark.usefixtures("llm")
def test_a_key_only_writes_to_its_own_brand(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _setup(client, h)
    copy = _confirmed(client, h, ctx)
    client.patch(
        f"{API}/confirmed-copies/{copy['id']}", headers=h, json={"post_url": PAGE}
    )
    other_brand = _create_brand(client, h)["id"]
    foreign_key = _key(client, h, other_brand)["key"]
    assert _send(client, foreign_key).status_code == 404  # same link, other brand's key
    assert (
        client.get(f"{API}/confirmed-copies/{copy['id']}/metrics", headers=h).json()[
            "items"
        ]
        == []
    )


@pytest.mark.usefixtures("llm")
def test_the_endpoint_checks_the_key_and_the_numbers(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _setup(client, h)
    copy = _confirmed(client, h, ctx)
    client.patch(
        f"{API}/confirmed-copies/{copy['id']}", headers=h, json={"post_url": PAGE}
    )
    key = _key(client, h, ctx["brand"])["key"]
    for wrong in (None, "", "rnk_nope", key + "x", key[:-1]):
        assert _send(client, wrong).status_code == 401, wrong
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    for bad in (
        {"likes": -1},
        {"likes": 1.5},
        {"comments": 2_000_000_000},
        {"captured_at": "2026-11-01T10:00:00"},
        {"captured_at": future},
        {"extra": 1},
        {"note_url": ""},
    ):
        assert _send(client, key, **bad).status_code == 422, bad
    assert (
        client.post(
            f"{API}/extension/metrics", headers={"X-Extension-Key": key}, json={}
        ).status_code
        == 422
    )
    # the user token does not work on this endpoint, the extension key does not work elsewhere
    assert (
        client.post(
            f"{API}/extension/metrics",
            headers=h,
            json={"note_url": PAGE, "likes": 1, "collects": 1, "comments": 1},
        ).status_code
        == 401
    )
    assert (
        client.get(
            f"{API}/confirmed-copies/{copy['id']}", headers={"X-Extension-Key": key}
        ).status_code
        == 401
    )


@pytest.mark.usefixtures("llm")
def test_a_leaked_key_cannot_flood_a_note(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _setup(client, h)
    copy = _confirmed(client, h, ctx)
    client.patch(
        f"{API}/confirmed-copies/{copy['id']}", headers=h, json={"post_url": PAGE}
    )
    key = _key(client, h, ctx["brand"])["key"]
    codes = [_send(client, key, likes=n).status_code for n in range(14)]
    assert codes == [201] * 12 + [429] * 2


@pytest.mark.usefixtures("llm")
def test_only_admins_manage_keys_and_the_active_limit(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)["id"]
    base = f"{API}/brands/{brand}/extension-keys"
    editor, editor_h = _make_user(client, db)
    _add_member(client, h, brand, editor, "editor")
    _, outsider = _make_user(client, db)
    for who in (editor_h, outsider):
        assert client.post(base, headers=who, json={"label": "x"}).status_code == 403
        assert client.get(base, headers=who).status_code == 403
    assert client.get(base).status_code == 401
    first = _key(client, h, brand)
    for n in range(9):
        _key(client, h, brand, f"k{n}")
    assert client.post(base, headers=h, json={"label": "11"}).status_code == 422
    client.delete(f"{base}/{first['id']}", headers=h)  # a revoked key frees a place
    assert client.post(base, headers=h, json={"label": "11"}).status_code == 201
    assert client.delete(f"{base}/{first['id']}", headers=editor_h).status_code == 403

    db.expire_all()
    actions = [a.action for a in db.exec(select(AuditLog)).all()]
    assert "extension_key.create" in actions and "extension_key.revoke" in actions
