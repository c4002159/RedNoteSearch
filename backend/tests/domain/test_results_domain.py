from datetime import UTC, datetime, timedelta

import pytest

from app.domain import results as r
from app.models.results import clean_post_url

T0 = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)


def test_metrics_become_due_after_three_days() -> None:
    assert r.due_at(None) is None
    assert r.due_at(T0) == T0 + timedelta(days=3)
    assert not r.needs_metrics(
        published_at=None, captured_at=[], now=T0 + timedelta(days=9)
    )
    just_before = T0 + timedelta(days=3) - timedelta(seconds=1)
    assert not r.needs_metrics(published_at=T0, captured_at=[], now=just_before)
    assert r.needs_metrics(published_at=T0, captured_at=[], now=T0 + timedelta(days=3))


def test_a_reading_before_the_due_time_does_not_clear_the_reminder() -> None:
    now = T0 + timedelta(days=4)
    early = [T0 + timedelta(days=1)]
    assert r.needs_metrics(published_at=T0, captured_at=early, now=now)
    late = [*early, T0 + timedelta(days=3, hours=1)]
    assert not r.needs_metrics(published_at=T0, captured_at=late, now=now)


def test_most_used_counts_and_limits() -> None:
    keys = [("种草", "seeding")] * 3 + [("测评", "review")] * 2 + [("故事", "story")]
    assert r.most_used(keys, limit=2) == [
        (("种草", "seeding"), 3),
        (("测评", "review"), 2),
    ]
    assert r.most_used([]) == []


def test_hottest_needs_three_notes() -> None:
    rows = [(("a", "s"), 10, False), (("b", "s"), 50, False)]
    assert r.hottest(rows) == (False, [])
    enough, stats = r.hottest([*rows, (("a", "s"), 30, True)])
    assert enough
    assert [(s.key, s.count, s.average, s.approximate) for s in stats] == [
        (("b", "s"), 1, 50.0, False),
        (("a", "s"), 2, 20.0, True),
    ]


@pytest.mark.parametrize(
    "url",
    [
        "https://www.xiaohongshu.com/explore/abc123",
        "https://xhslink.com/a/xyz",
        "https://m.xiaohongshu.com/discovery/item/1",
    ],
)
def test_post_urls_accepted(url: str) -> None:
    assert clean_post_url(f"  {url} ") == url


@pytest.mark.parametrize(
    "url",
    [
        "http://www.xiaohongshu.com/explore/1",
        "https://evilxiaohongshu.com/explore/1",
        "https://xiaohongshu.com.evil.com/x",
        "https://user:pw@www.xiaohongshu.com/x",
        "https://www.xiaohongshu.com/a b",
        "javascript:alert(1)",
        "www.xiaohongshu.com/explore/1",
        "",
    ],
)
def test_post_urls_rejected(url: str) -> None:
    with pytest.raises(ValueError):
        clean_post_url(url)
