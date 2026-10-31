"""Compliance risk-hint engine (pure): rule validity, scanning, the efficacy layer and context findings."""

from datetime import date

import pytest
from pydantic import ValidationError

from app.domain.compliance.engine import (
    CONTEXT_SYSTEM,
    ContextFinding,
    ContextFindings,
    Layer,
    Rule,
    RuleType,
    Severity,
    apply_efficacy_basis,
    build_context_messages,
    is_active,
    locate_findings,
    pattern_problem,
    scan,
    sentence_around,
)

TODAY = date(2026, 10, 31)


def _rule(pattern: str, **overrides: object) -> Rule:
    data: dict[str, object] = {
        "id": "r1",
        "rule_version": 1,
        "layer": Layer.LEXICON,
        "rule_type": RuleType.ABSOLUTE_TERM,
        "pattern": pattern,
        "is_regex": False,
        "severity": Severity.BLOCK,
        "suggestion": "改掉",
        "source_name": "示例",
    }
    return Rule(**(data | overrides))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("pattern", "is_regex", "ok"),
    [
        ("最好", False, True),
        (r"\d+%", True, True),
        ("", False, False),
        ("   ", True, False),
        ("a" * 201, False, False),
        ("(a+)+", True, False),  # nested quantifier: could hang the check
        ("(.*)*x", True, False),
        ("([", True, False),  # not a valid expression
        ("(a+)+", False, True),  # the same text is harmless as plain words
    ],
)
def test_pattern_validation(pattern: str, is_regex: bool, ok: bool) -> None:
    assert (pattern_problem(pattern, is_regex) is None) is ok


def test_rules_respect_enabled_flag_and_effective_dates() -> None:
    assert is_active(_rule("x"), TODAY)
    assert not is_active(_rule("x", enabled=False), TODAY)
    assert not is_active(_rule("x", effective_from=date(2026, 11, 1)), TODAY)
    assert is_active(_rule("x", effective_from=TODAY), TODAY)
    assert not is_active(_rule("x", effective_to=date(2026, 10, 30)), TODAY)
    assert is_active(_rule("x", effective_to=TODAY), TODAY)


def test_scan_finds_every_occurrence_in_every_field_with_positions() -> None:
    hits = scan(
        {"title.0": "最好的香水", "body": "真的最好用，最好看", "hashtags": "日常"},
        [_rule("最好")],
        today=TODAY,
    )
    assert [(h.field, h.start, h.end, h.matched_text) for h in hits] == [
        ("body", 2, 4, "最好"),
        ("body", 6, 8, "最好"),
        ("title.0", 0, 2, "最好"),
    ]
    first = hits[0]
    assert (first.rule_id, first.rule_version, first.severity) == (
        "r1",
        1,
        Severity.BLOCK,
    )
    assert (first.suggestion, first.source_name, first.layer) == (
        "改掉",
        "示例",
        Layer.LEXICON,
    )


def test_scan_supports_regex_case_and_skips_what_cannot_apply() -> None:
    fields = {"body": "含 99.5% 的成分，EAU 清爽"}
    percent = _rule(r"\d+(\.\d+)?\s*%", is_regex=True, rule_type=RuleType.DATA_CLAIM)
    assert [h.matched_text for h in scan(fields, [percent], today=TODAY)] == ["99.5%"]
    assert len(scan(fields, [_rule("eau")], today=TODAY)) == 1  # case-insensitive
    skipped = [
        _rule("成分", enabled=False),
        _rule("成分", layer=Layer.CONTEXT),
        _rule("成分", effective_to=date(2020, 1, 1)),
        _rule(
            "(a+)+", is_regex=True
        ),  # unsafe pattern is ignored, the note is still checked
        _rule("([", is_regex=True),
        _rule("   "),
    ]
    assert scan(fields, skipped, today=TODAY) == []
    assert (
        scan(fields, [_rule(r"x*", is_regex=True)], today=TODAY) == []
    )  # empty matches are not hits


def test_sentence_around_uses_sentence_punctuation_and_line_breaks() -> None:
    text = "第一句。这款美白很好！\n第三句"
    start = text.index("美白")
    assert sentence_around(text, start, start + 2) == "这款美白很好"
    assert sentence_around("只有一句美白", 4, 6) == "只有一句美白"


def test_efficacy_hits_are_softened_only_when_a_supported_claim_backs_the_sentence() -> (
    None
):
    fields = {"body": "资料说它有美白作用。我觉得它能祛斑。味道清爽。"}
    efficacy = _rule(
        "美白", layer=Layer.EFFICACY_BASIS, rule_type=RuleType.EFFICACY_CLAIM
    )
    unbacked = _rule(
        "祛斑", layer=Layer.EFFICACY_BASIS, rule_type=RuleType.EFFICACY_CLAIM
    )
    plain = _rule("清爽", severity=Severity.WARN)
    hits = scan(fields, [efficacy, unbacked, plain], today=TODAY)
    result = {
        h.matched_text: h
        for h in apply_efficacy_basis(hits, fields, ["资料说它有美白作用", ""])
    }
    assert (result["美白"].basis, result["美白"].severity) == ("found", Severity.WARN)
    assert (result["祛斑"].basis, result["祛斑"].severity) == ("none", Severity.BLOCK)
    assert (result["清爽"].basis, result["清爽"].severity) == (None, Severity.WARN)
    assert apply_efficacy_basis(hits, fields, []) is not hits  # always a new list


def test_context_findings_must_point_at_text_that_exists() -> None:
    findings = ContextFindings(
        findings=[
            ContextFinding(
                sentence="用完皮肤会变年轻",
                concern="暗示功效",
                severity="block",
                suggestion="删除",
            ),
            ContextFinding(sentence="原文里没有的句子", concern="编的"),
            ContextFinding(sentence="  ", concern="空"),
        ]
    ).findings
    assert len(findings) == 2  # blanks are dropped by the schema
    hits = locate_findings(
        findings, {"title.0": "标题", "body": "用完皮肤会变年轻。很舒服"}
    )
    assert len(hits) == 1
    hit = hits[0]
    assert (hit.field, hit.start, hit.end, hit.severity) == (
        "body",
        0,
        8,
        Severity.BLOCK,
    )
    assert (hit.layer, hit.rule_id, hit.suggestion) == (Layer.CONTEXT, None, "删除")
    assert (
        locate_findings([ContextFinding(sentence="x", concern="担心")], {"body": "x"})[
            0
        ].suggestion
        == "担心"
    )
    with pytest.raises(ValidationError):
        ContextFinding(sentence="x", severity="fatal")  # type: ignore[arg-type]


def test_context_prompt_asks_for_hints_not_verdicts() -> None:
    messages = build_context_messages({"title.0": "标题甲", "body": "正文乙"})
    assert (
        "【title.0】标题甲" in messages[1].content
        and "【body】正文乙" in messages[1].content
    )
    assert "不是合规结论" in CONTEXT_SYSTEM
    assert "合规通过" not in CONTEXT_SYSTEM
