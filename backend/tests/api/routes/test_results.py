"""Confirmed copies, post links and result readings. Needs the database; the model is a fake."""

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app.core.config import settings
from tests.api.routes.test_brands import _create_brand, _make_user
from tests.api.routes.test_versions import ANSWERS, cleanup, llm  # noqa: F401

API = settings.API_V1_STR
URL = "https://www.xiaohongshu.com/explore/65abc"


def _iso(delta: timedelta) -> str:
    return (datetime.now(UTC) + delta).isoformat()


def _setup(client: TestClient, h: dict[str, str]) -> dict[str, Any]:
    brand = _create_brand(client, h)
    product = client.post(
        f"{API}/brands/{brand['id']}/products", headers=h, json={"name": "晨雾"}
    ).json()
    scenarios = client.get(f"{API}/scenarios", headers=h).json()["items"]
    return {"brand": brand["id"], "product": product["id"], "scenarios": scenarios}


def _confirmed(
    client: TestClient, h: dict[str, str], ctx: dict[str, Any], scenario: int = 0
) -> dict[str, Any]:
    task = client.post(
        f"{API}/tasks",
        headers=h,
        json={
            "brand_id": ctx["brand"],
            "product_id": ctx["product"],
            "scenario_id": ctx["scenarios"][scenario]["id"],
            "required_terms": ["木质香调"],
        },
    ).json()
    client.post(f"{API}/tasks/{task['id']}/generate", headers=h)
    version = client.get(f"{API}/tasks/{task['id']}", headers=h).json()[
        "latest_version_id"
    ]
    ok = client.post(
        f"{API}/generation-versions/{version}/confirm",
        headers=h,
        json={"selected_title_index": 1},
    )
    assert ok.status_code == 200, ok.text
    listed = client.get(
        f"{API}/brands/{ctx['brand']}/confirmed-copies", headers=h
    ).json()["items"]
    return next(c for c in listed if c["version_id"] == version)  # type: ignore[no-any-return]


def _metric(**extra: Any) -> dict[str, Any]:
    return {"likes": 10, "collects": 5, "comments": 2, **extra}


@pytest.mark.usefixtures("llm")
def test_confirming_a_version_adds_it_to_the_results_list(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _setup(client, h)
    copy = _confirmed(client, h, ctx)
    assert copy["title"] == "木质香调小记"  # the title picked at confirmation
    assert copy["scenario_name"] == ctx["scenarios"][0]["name"]
    assert copy["promo_label"] == "晨雾" and copy["promo_type"] == "product"
    assert copy["post_url"] is None and copy["latest_metric"] is None
    assert copy["needs_metrics"] is False and copy["metrics_due_at"] is None

    again = client.get(f"{API}/confirmed-copies/{copy['id']}", headers=h)
    assert again.status_code == 200 and again.json()["id"] == copy["id"]
    q = client.get(f"{API}/brands/{ctx['brand']}/confirmed-copies?q=晨雾", headers=h)
    assert q.json()["total"] == 1


@pytest.mark.usefixtures("llm")
def test_post_link_and_publish_time_are_validated(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    copy = _confirmed(client, h, _setup(client, h))
    url = f"{API}/confirmed-copies/{copy['id']}"
    for bad in (
        {"post_url": "http://www.xiaohongshu.com/explore/1"},
        {"post_url": "https://evil.example.com/explore/1"},
        {"post_url": "javascript:alert(1)"},
        {"published_at": "2026-11-01T10:00:00"},  # no time zone
        {"title": "   "},
        {"unknown": 1},
    ):
        assert client.patch(url, headers=h, json=bad).status_code == 422, bad
    future = client.patch(
        url, headers=h, json={"published_at": _iso(timedelta(days=2))}
    )
    assert future.status_code == 422

    ok = client.patch(
        url,
        headers=h,
        json={"post_url": URL, "published_at": _iso(-timedelta(days=1))},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["post_url"] == URL and ok.json()["needs_metrics"] is False
    cleared = client.patch(url, headers=h, json={"post_url": None})
    assert cleared.json()["post_url"] is None
    assert cleared.json()["published_at"] is not None  # fields not sent are kept


@pytest.mark.usefixtures("llm")
def test_numbers_are_due_three_days_after_publishing(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _setup(client, h)
    copy = _confirmed(client, h, ctx)
    url = f"{API}/confirmed-copies/{copy['id']}"
    list_url = f"{API}/brands/{ctx['brand']}/confirmed-copies?needs_metrics=true"
    published = datetime.now(UTC) - timedelta(days=4)
    client.patch(url, headers=h, json={"published_at": published.isoformat()})
    assert client.get(url, headers=h).json()["needs_metrics"] is True
    assert [c["id"] for c in client.get(list_url, headers=h).json()["items"]] == [
        copy["id"]
    ]
    assert (
        client.get(f"{API}/brands/{ctx['brand']}/results/summary", headers=h).json()[
            "pending_count"
        ]
        == 1
    )

    # a reading from day one does not clear the reminder
    early = client.post(
        f"{url}/metrics",
        headers=h,
        json=_metric(captured_at=(published + timedelta(days=1)).isoformat()),
    )
    assert early.status_code == 201
    assert client.get(url, headers=h).json()["needs_metrics"] is True

    done = client.post(f"{url}/metrics", headers=h, json=_metric(likes=99))
    assert done.status_code == 201 and done.json()["source"] == "manual"
    now_state = client.get(url, headers=h).json()
    assert now_state["needs_metrics"] is False
    assert now_state["latest_metric"]["likes"] == 99
    assert client.get(list_url, headers=h).json()["total"] == 0
    readings = client.get(f"{url}/metrics", headers=h).json()["items"]
    assert [m["likes"] for m in readings] == [99, 10]  # newest first, none overwritten


@pytest.mark.usefixtures("llm")
def test_metric_validation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    copy = _confirmed(client, h, _setup(client, h))
    url = f"{API}/confirmed-copies/{copy['id']}/metrics"
    for bad in (
        _metric(likes=-1),
        _metric(likes=1.5),
        _metric(comments=2_000_000_000),
        {"likes": 1, "collects": 1},
        _metric(source="crawler"),
        _metric(captured_at="2026-11-01T10:00:00"),
        _metric(captured_at=_iso(timedelta(days=1))),
        _metric(extra=1),
    ):
        assert client.post(url, headers=h, json=bad).status_code == 422, bad
    ok = client.post(url, headers=h, json=_metric(approximate=True, source="extension"))
    assert ok.status_code == 201
    assert ok.json()["approximate"] is True and ok.json()["source"] == "extension"


@pytest.mark.usefixtures("llm")
def test_summary_shows_most_used_and_hottest_only_with_enough_notes(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _setup(client, h)
    copies = [_confirmed(client, h, ctx, s) for s in (0, 0, 1)]
    summary = f"{API}/brands/{ctx['brand']}/results/summary"
    first = client.get(summary, headers=h).json()
    assert first["total_copies"] == 3 and first["pending_count"] == 0
    assert first["most_used"][0] == {
        "scenario_name": ctx["scenarios"][0]["name"],
        "scene": ctx["scenarios"][0]["scene"],
        "count": 2,
    }
    assert first["hottest"]["enough_data"] is False
    assert first["hottest"]["items"] == [] and first["hottest"]["min_notes"] == 3

    for copy, likes in zip(copies, (100, 300, 10), strict=True):
        client.post(
            f"{API}/confirmed-copies/{copy['id']}/metrics",
            headers=h,
            json=_metric(likes=likes, collects=0, comments=0, approximate=likes == 10),
        )
    # only the newest reading of a note counts
    client.post(
        f"{API}/confirmed-copies/{copies[2]['id']}/metrics",
        headers=h,
        json=_metric(likes=20, collects=0, comments=0, approximate=True),
    )
    hot = client.get(summary, headers=h).json()["hottest"]
    assert hot["enough_data"] is True and hot["notes_with_metrics"] == 3
    assert [(i["note_count"], i["average_engagement"]) for i in hot["items"]] == [
        (2, 200.0),
        (1, 20.0),
    ]
    assert [i["approximate"] for i in hot["items"]] == [False, True]


@pytest.mark.usefixtures("llm")
def test_results_are_isolated_between_brands(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _setup(client, h)
    copy = _confirmed(client, h, ctx)
    _, outsider = _make_user(client, db)
    url = f"{API}/confirmed-copies/{copy['id']}"
    assert client.get(url, headers=outsider).status_code == 404
    assert (
        client.patch(url, headers=outsider, json={"post_url": URL}).status_code == 404
    )
    assert client.get(f"{url}/metrics", headers=outsider).status_code == 404
    assert (
        client.post(f"{url}/metrics", headers=outsider, json=_metric()).status_code
        == 404
    )
    brand = f"{API}/brands/{ctx['brand']}"
    assert client.get(f"{brand}/confirmed-copies", headers=outsider).status_code == 403
    assert client.get(f"{brand}/results/summary", headers=outsider).status_code == 403
    assert client.get(url).status_code == 401


@pytest.mark.usefixtures("llm")
def test_migration_backfills_versions_confirmed_earlier(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _setup(client, h)
    copy = _confirmed(client, h, ctx)
    db.execute(text("DELETE FROM confirmed_copy WHERE id = :i"), {"i": copy["id"]})
    db.commit()
    path = next(
        Path(__file__).parents[3].glob("app/alembic/versions/e8a2c6d0f4b3_*.py")
    )
    spec = importlib.util.spec_from_file_location("backfill", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    db.execute(text(module.BACKFILL_SQL))
    db.commit()
    listed = client.get(
        f"{API}/brands/{ctx['brand']}/confirmed-copies", headers=h
    ).json()["items"]
    assert len(listed) == 1
    assert listed[0]["version_id"] == copy["version_id"]
    assert listed[0]["title"] == "木质香调小记"
    assert listed[0]["promo_label"] == "晨雾"
