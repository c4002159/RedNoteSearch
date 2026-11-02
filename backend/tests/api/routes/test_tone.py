import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import (
    ConfirmedCopy,
    GenerationVersion,
    PostMetric,
    StylePreset,
)
from app.models.viral import ViralPattern, ViralSample
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR
NOW = datetime(2026, 11, 2, tzinfo=UTC)


def _context(client: TestClient, db: Session, h: dict[str, str]) -> dict[str, Any]:
    ensure_default_scenarios(db)
    brand = _create_brand(client, h)
    product = client.post(
        f"{API}/brands/{brand['id']}/products", headers=h, json={"name": "tone test"}
    ).json()
    scenes = client.get(f"{API}/scenarios", headers=h).json()["items"]
    return {
        "brand": brand["id"],
        "product": product["id"],
        "scenes": {s["scene"]: s["id"] for s in scenes if s["brand_id"] is None},
    }


def _task(
    client: TestClient,
    h: dict[str, str],
    ctx: dict[str, Any],
    tone: str,
    scene: str = "seeding",
) -> uuid.UUID:
    response = client.post(
        f"{API}/tasks",
        headers=h,
        json={
            "brand_id": ctx["brand"],
            "product_id": ctx["product"],
            "scenario_id": ctx["scenes"][scene],
            "style": {"tone": tone},
        },
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


def _pattern(
    db: Session, brand: str, tone: str, sample: ViralSample | None = None
) -> ViralSample:
    if sample is None:
        sample = ViralSample(brand_id=uuid.UUID(brand), text="test sample")
        db.add(sample)
        db.flush()
    db.add(
        ViralPattern(
            sample_id=sample.id,
            brand_id=uuid.UUID(brand),
            tone=tone,
            title_pattern="title",
            hook_type="hook",
            paragraph_structure=["paragraph"],
            emoji_usage="none",
            hashtag_usage="none",
            abstract_template="structure",
            model_id="fake",
            prompt_version="test",
            checker_version="test",
        )
    )
    db.commit()
    return sample


def _reading(
    db: Session,
    ctx: dict[str, Any],
    task_id: uuid.UUID,
    likes: int,
    *,
    scene: str = "seeding",
    approximate: bool = False,
) -> ConfirmedCopy:
    brand_id = uuid.UUID(ctx["brand"])
    version = GenerationVersion(
        task_id=task_id, brand_id=brand_id, version_no=1, flow_status="ready_to_copy"
    )
    db.add(version)
    db.flush()
    copy = ConfirmedCopy(
        brand_id=brand_id,
        task_id=task_id,
        version_id=version.id,
        title="tone",
        scene=scene,
    )
    db.add(copy)
    db.flush()
    db.add(
        PostMetric(
            copy_id=copy.id,
            brand_id=brand_id,
            captured_at=NOW,
            likes=likes,
            collects=2,
            comments=3,
            approximate=approximate,
        )
    )
    db.commit()
    return copy


def test_tone_empty_authentication_limits_and_brand_access(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _context(client, db, h)
    url = f"{API}/brands/{ctx['brand']}/tone-suggestions"
    assert client.get(url).status_code == 401
    outsider, other = _make_user(client, db)
    assert client.get(url, headers=other).status_code == 403
    _add_member(client, h, ctx["brand"], outsider, "editor")
    empty = client.get(url, headers=other)
    assert empty.status_code == 200
    assert empty.json() == {
        "history": [],
        "template": [],
        "results": {
            "enough_data": False,
            "notes_with_metrics": 0,
            "min_notes": 3,
            "items": [],
        },
    }
    for query in ("limit=0", "limit=21", "limit=-1", "scene=", "scene=" + "a" * 21):
        assert client.get(url + "?" + query, headers=h).status_code == 422
    assert client.get(url + "?limit=20", headers=h).status_code == 200


def test_tone_scene_filters_tasks_but_presets_and_patterns_stay_brand_wide(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    a = _context(client, db, h)
    b = _context(client, db, h)
    _task(client, h, a, " 温柔\t克制 ")
    _task(client, h, a, "温柔 克制")
    _task(client, h, a, "测评语气", "review")
    _task(client, h, b, "别的品牌")
    db.add(
        StylePreset(
            brand_id=uuid.UUID(a["brand"]),
            name="preset-a",
            params={"tone": "温柔 克制"},
            created_at=NOW,
        )
    )
    db.add(
        StylePreset(
            brand_id=uuid.UUID(b["brand"]), name="preset-b", params={"tone": "别的预设"}
        )
    )
    db.commit()
    sample = _pattern(db, a["brand"], "轻松")
    _pattern(db, a["brand"], " 轻松 ", sample)
    _pattern(db, a["brand"], "轻松")
    _pattern(db, b["brand"], "别的结构")
    url = f"{API}/brands/{a['brand']}/tone-suggestions"
    all_rows = client.get(url, headers=h).json()
    seed = client.get(url + "?scene=seeding", headers=h).json()
    review = client.get(url + "?scene=review", headers=h).json()
    assert (
        all_rows["template"]
        == seed["template"]
        == review["template"]
        == [{"tone": "轻松", "count": 3, "sample_count": 2}]
    )
    preset = {
        "tone": "温柔 克制",
        "source": "preset",
        "count": None,
        "last_used_at": None,
    }
    for data in (all_rows, seed, review):
        assert [r for r in data["history"] if r["source"] == "preset"] == [preset]
        assert "别的" not in str(data)
    assert [
        (r["tone"], r["count"]) for r in seed["history"] if r["source"] == "task"
    ] == [("温柔 克制", 2)]
    assert [
        (r["tone"], r["count"]) for r in review["history"] if r["source"] == "task"
    ] == [("测评语气", 1)]
    limited = client.get(url + "?limit=1", headers=h).json()
    assert len(limited["history"]) == len(limited["template"]) == 1
    unknown = client.get(url + "?scene=unknown", headers=h).json()
    assert (
        unknown["history"] == [preset] and unknown["template"] == all_rows["template"]
    )


def test_tone_results_use_latest_readings_three_notes_and_scene_boundary(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    ctx = _context(client, db, h)
    t1 = _task(client, h, ctx, "温柔")
    t2 = _task(client, h, ctx, " 温柔 ")
    t3 = _task(client, h, ctx, "轻松", "review")
    copy = _reading(db, ctx, t1, 5)
    _reading(db, ctx, t2, 15, approximate=True)
    db.add(
        PostMetric(
            copy_id=copy.id,
            brand_id=copy.brand_id,
            captured_at=NOW - timedelta(days=1),
            likes=999999,
        )
    )
    db.commit()
    url = f"{API}/brands/{ctx['brand']}/tone-suggestions"
    before = client.get(url, headers=h).json()["results"]
    assert before == {
        "enough_data": False,
        "notes_with_metrics": 2,
        "min_notes": 3,
        "items": [],
    }
    _reading(db, ctx, t3, 95, scene="review")
    after = client.get(url, headers=h).json()["results"]
    assert after["notes_with_metrics"] == 3 and after["enough_data"] is True
    assert after["items"] == [
        {
            "tone": "轻松",
            "note_count": 1,
            "average_engagement": 100.0,
            "approximate": False,
        },
        {
            "tone": "温柔",
            "note_count": 2,
            "average_engagement": 15.0,
            "approximate": True,
        },
    ]
    assert client.get(url + "?scene=seeding", headers=h).json()["results"] == before
    other = _context(client, db, h)
    assert (
        client.get(f"{API}/brands/{other['brand']}/tone-suggestions", headers=h).json()[
            "results"
        ]["notes_with_metrics"]
        == 0
    )
