from datetime import UTC, datetime, timedelta

import pytest

from app.domain.tone import clean_tone, history_tones, result_tones, template_tones

NOW = datetime(2026, 11, 2, tzinfo=UTC)


@pytest.mark.parametrize(
    "value, expected",
    [
        (None, ""),
        (42, ""),
        (" \t\n", ""),
        ("  温柔\t  克制\n", "温柔 克制"),
        ("🌿轻松", "🌿轻松"),
    ],
)
def test_clean_tone(value: object, expected: str) -> None:
    assert clean_tone(value) == expected


def test_history_separates_presets_and_counts_tasks_only() -> None:
    rows = history_tones(
        [(" 温柔  克制 ", NOW), ("温柔 克制", NOW - timedelta(days=1)), ("", NOW)],
        [
            ("温柔 克制", NOW),
            (" 温柔\t克制 ", NOW - timedelta(days=2)),
            ("轻松", NOW + timedelta(days=1)),
        ],
    )
    assert [(r.tone, r.source, r.count, r.last_used_at) for r in rows] == [
        ("温柔 克制", "task", 2, NOW),
        ("轻松", "preset", None, None),
        ("温柔 克制", "preset", None, None),
    ]


def test_history_ties_use_latest_task_time_and_limit() -> None:
    rows = history_tones(
        [("早", NOW), ("晚", NOW + timedelta(hours=1))], [("预设", NOW)], limit=1
    )
    assert rows[0].tone == "晚"
    assert history_tones([], []) == []


def test_template_counts_patterns_and_distinct_sample_ids() -> None:
    rows = template_tones(
        [("轻松", "a"), (" 轻松 ", "a"), ("轻松", "b"), (" ", "c"), ("克制", "d")],
        limit=1,
    )
    assert [(r.tone, r.count, r.sample_count) for r in rows] == [("轻松", 3, 2)]
    assert template_tones([]) == []


@pytest.mark.parametrize("count", [0, 1, 2, 3])
def test_results_minimum_notes(count: int) -> None:
    result = result_tones([("轻松", 1, 2, 3, False)] * count)
    assert result.enough_data is (count >= 3)
    assert result.notes_with_metrics == count
    assert result.min_notes == 3
    assert len(result.items) == (1 if count >= 3 else 0)


def test_results_clean_and_group_latest_readings_with_approximate_flag() -> None:
    result = result_tones(
        [
            ("温柔", 10, 2, 1, False),
            (" 温柔 ", 20, 3, 2, True),
            ("轻松", 100, 0, 0, False),
            ("", 999, 0, 0, False),
        ]
    )
    assert [
        (r.tone, r.note_count, r.average_engagement, r.approximate)
        for r in result.items
    ] == [("轻松", 1, 100.0, False), ("温柔", 2, 19.0, True)]
    assert result.notes_with_metrics == 3


@pytest.mark.parametrize("limit", [0, -1, 21])
def test_invalid_limits(limit: int) -> None:
    for call in (
        lambda: history_tones([], [], limit),
        lambda: template_tones([], limit),
        lambda: result_tones([], limit),
    ):
        with pytest.raises(ValueError):
            call()
