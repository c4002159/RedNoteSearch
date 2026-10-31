"""Constraint core: length rules, checks and copy formats (TC-016, 017, 042, 049, 050, 051)."""

import pytest

from app.domain.constraints import (
    HIDDEN_TOPIC_SUFFIX,
    ConstraintCode,
    ConstraintConfig,
    body_units,
    check_note,
    check_title,
    normalize_tag,
    strip_hidden_topic_suffix,
    tag_visible_units,
    title_weight,
    to_xhs_parts,
    utf16_units,
)


def _codes(issues: object) -> list[str]:
    return [i.code.value for i in issues]  # type: ignore[attr-defined]


# ---- length rules ----
@pytest.mark.parametrize(
    ("title", "weight", "ok"),
    [
        ("字" * 20, 20, True),  # TC-016
        ("字" * 21, 21, False),
        ("a" * 40, 20, True),
        ("a" * 41, 20.5, False),
        ("字" * 10 + "a" * 20, 20, True),
        ("字" * 10 + "a" * 21, 20.5, False),
        ("", 0, False),  # empty is a missing field, not a length problem
    ],
)
def test_title_weight_boundaries(title: str, weight: float, ok: bool) -> None:
    assert title_weight(title) == weight
    assert (check_title(title) == []) is ok


def test_title_weight_treats_everything_outside_ascii_printable_as_full_width() -> None:
    assert title_weight("，") == 1  # full-width comma (assumption, see ADR-004)
    assert title_weight(" ") == 0.5 and title_weight("~") == 0.5
    assert title_weight("\x7f") == 1 and title_weight("é") == 1
    assert (
        title_weight("😀") == 2
    )  # two UTF-16 code units, measured on the publish page
    assert title_weight("a😀，") == 3.5
    assert (
        title_weight("汉" * 10 + "😀" * 5) == 20
        and title_weight("汉" * 10 + "😀" * 5 + "a") == 20.5
    )


def test_body_units_ignore_newlines_and_count_emoji_twice() -> None:
    assert body_units("a" * 1000) == 1000  # TC-049
    assert body_units("a" * 1000 + "\n" * 5) == 1000
    assert body_units("a\nb\nc") == 3
    assert body_units("😀") == 2 and utf16_units("😀") == 2
    assert body_units("字 a#") == 4  # full-width, space, latin and # all count 1
    assert body_units("a\r\nb") == 3  # \r is not a line break for counting
    assert utf16_units("\ud800") == 1  # a lone surrogate must not raise


def test_tag_helpers() -> None:
    assert normalize_tag(" ##春日香氛 ") == "春日香氛"
    assert tag_visible_units("春日香氛") == 6  # "#" + 4 + one space
    assert tag_visible_units("#a") == 3
    assert tag_visible_units("😀") == 4


# ---- check_note ----
def _ok(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "title": "通勤路上的一点清爽",
        "body": "早上出门前喷一下。",
        "tags": ["日常香氛", "通勤好物"],
    }
    return base | overrides


def test_a_valid_note_passes_and_reports_counts() -> None:
    result = check_note(**_ok())  # type: ignore[arg-type]
    assert result.passed and result.issues == ()
    assert result.counts.title_weight == 9
    assert result.counts.body_units == 9
    assert result.counts.tags_units == 12 and result.counts.tag_count == 2
    assert result.counts.body_budget_used == 21


def test_body_limit_includes_visible_tag_characters() -> None:
    tags = ["春日香氛"]  # costs 6
    body_limit_minus_tags = 1000 - 6
    ok = check_note(title="标题", body="a" * body_limit_minus_tags, tags=tags)
    assert ok.passed and ok.counts.body_budget_used == 1000
    over = check_note(title="标题", body="a" * (body_limit_minus_tags + 1), tags=tags)
    assert _codes(over.issues) == ["body_too_long"]
    issue = over.issues[0]
    assert issue.field == "body" and issue.details["used"] == 1001
    # Newlines do not count towards the limit.
    assert check_note(title="标题", body="a" * 994 + "\n" * 50, tags=tags).passed


def test_tag_count_boundary() -> None:  # TC-050
    ten = [f"标签{i}" for i in range(10)]
    assert check_note(title="标题", body="正文", tags=ten).passed
    eleven = [*ten, "标签10"]
    result = check_note(title="标题", body="正文", tags=eleven)
    assert _codes(result.issues) == ["too_many_tags"]
    assert result.issues[0].field == "tags" and result.issues[0].details["count"] == 11


def test_missing_fields_are_all_reported() -> None:
    result = check_note(title=" ", body="\n", tags=[])
    assert [(i.field, i.code) for i in result.issues] == [
        ("title", ConstraintCode.MISSING_FIELD),
        ("body", ConstraintCode.MISSING_FIELD),
        ("tags", ConstraintCode.MISSING_FIELD),
    ]
    relaxed = check_note(
        title="标题", body="正文", tags=[], config=ConstraintConfig(min_tags=0)
    )
    assert relaxed.passed


def test_invalid_and_duplicate_tags() -> None:
    result = check_note(
        title="标题", body="正文", tags=["好物", "#好物", "a b", "#", "好#物"]
    )
    assert _codes(result.issues) == [
        "duplicate_tag",
        "invalid_tag",
        "invalid_tag",
        "invalid_tag",
    ]
    assert result.issues[1].details["index"] == 2


def test_required_words_must_appear_somewhere() -> None:  # TC-017
    note = _ok(required_words=["清爽", "晨雾", "日常香氛", "  "])
    result = check_note(**note)  # type: ignore[arg-type]
    assert [(i.code.value, i.details["word"]) for i in result.issues] == [
        ("missing_required_word", "晨雾")
    ]
    assert check_note(**_ok(required_words=["清爽"])).passed  # type: ignore[arg-type]


def test_forbidden_words_report_field_and_position_of_every_hit() -> None:  # TC-017
    result = check_note(
        title="最好的香水",
        body="真的最好用，真的最好",
        tags=["最好", "日常"],
        forbidden_words=["最好", "最好"],  # duplicates are reported once
    )
    hits = [(i.field, i.details["position"]) for i in result.issues]
    assert hits == [("title", 0), ("body", 2), ("body", 8), ("tags", 0)]
    assert all(i.code is ConstraintCode.FORBIDDEN_WORD for i in result.issues)


def test_word_matching_is_case_insensitive_and_skips_blank_words() -> None:
    result = check_note(
        title="Eau de Parfum",
        body="a gentle EAU scent",
        tags=["fresh"],
        forbidden_words=["eau", "", " "],
        required_words=["FRESH"],
    )
    assert [(i.field, i.details["position"]) for i in result.issues] == [
        ("title", 0),
        ("body", 9),
    ]


def test_all_failures_come_back_together() -> None:
    result = check_note(
        title="字" * 21,
        body="b" * 1001,
        tags=[f"t{i}" for i in range(11)],
        required_words=["缺失词"],
        forbidden_words=["b"],
    )
    codes = set(_codes(result.issues))
    assert {
        "title_too_long",
        "body_too_long",
        "too_many_tags",
        "missing_required_word",
        "forbidden_word",
    } <= codes
    assert not result.passed


def test_config_overrides_the_limits() -> None:
    strict = ConstraintConfig(title_limit=5, body_limit=10, tag_limit=1)
    result = check_note(
        title="一二三四五六", body="a" * 11, tags=["a", "b"], config=strict
    )
    assert {"title_too_long", "body_too_long", "too_many_tags"} <= set(
        _codes(result.issues)
    )


# ---- copy formats ----
def test_xhs_parts_split_title_body_and_tags() -> None:  # TC-042
    parts = to_xhs_parts(
        "  标题  ", "\n正文第一行\n第二行\n", ["#日常香氛", " 通勤好物 ", "", "#"]
    )
    assert parts.title == "标题" and parts.body == "正文第一行\n第二行"
    assert parts.tags == ["日常香氛", "通勤好物"]  # no leading '#'
    assert parts.tags_text == "#日常香氛 #通勤好物"  # single spaces
    assert (parts.title_weight, parts.body_units) == (2, 8)
    assert (parts.tags_units, parts.tag_count) == (12, 2)


def test_strip_hidden_topic_suffix_keeps_the_tag_name() -> None:  # TC-051
    raw = f"今天分享 #春日香氛{HIDDEN_TOPIC_SUFFIX} 和 #通勤{HIDDEN_TOPIC_SUFFIX}"
    assert strip_hidden_topic_suffix(raw) == "今天分享 #春日香氛 和 #通勤"
    assert HIDDEN_TOPIC_SUFFIX not in strip_hidden_topic_suffix(raw)
    assert strip_hidden_topic_suffix("没有后缀") == "没有后缀"
