"""Prompt assembly, output schema and constraint evaluation for generation (pure, no database)."""

import pytest
from pydantic import ValidationError

from app.domain.generation.evaluate import (
    CHECKER_VERSION,
    evaluate_note,
    problems_from_report,
)
from app.domain.generation.prompt import (
    PROMPT_VERSION,
    PromptInput,
    SourceSnippet,
    body_budget,
    build_messages,
)
from app.domain.generation.schema import GeneratedNote


def _note(**overrides: object) -> GeneratedNote:
    data: dict[str, object] = {
        "title_candidates": ["通勤路上的清爽", "木质香调小记"],
        "body": "早上出门前喷一下，木质香调很柔和。",
        "hashtags": ["日常香氛", "通勤好物"],
        "cover_candidates": ["清爽一整天"],
    }
    return GeneratedNote.model_validate(data | overrides)


def test_schema_cleans_blanks_and_requires_content() -> None:
    note = _note(
        title_candidates=[" 标题 ", "", "  "], hashtags=["a", " "], body="  正文 "
    )
    assert (
        note.title_candidates == ["标题"]
        and note.hashtags == ["a"]
        and note.body == "正文"
    )
    for bad in (
        {"title_candidates": []},
        {"body": ""},
        {"body": "   "},
        {"title_candidates": ["x"] * 9},
        {"hashtags": ["t"] * 21},
    ):
        with pytest.raises(ValidationError):
            _note(**bad)
    with pytest.raises(ValidationError):
        GeneratedNote.model_validate({"body": "x"})


def test_evaluate_passes_a_clean_note_and_reports_counts() -> None:
    report = evaluate_note(
        _note(), required_words=["木质香调"], forbidden_words=["最好"]
    )
    assert report["passed"] is True and report["checker_version"] == CHECKER_VERSION
    assert [t["issues"] for t in report["titles"]] == [[], []]
    assert report["note"]["issues"] == []
    assert report["note"]["counts"]["tag_count"] == 2
    assert problems_from_report(report) == []


def test_every_title_is_checked_on_its_own() -> None:
    report = evaluate_note(
        _note(title_candidates=["字" * 21, "最好的清爽", "正常标题"]),
        required_words=[],
        forbidden_words=["最好"],
    )
    assert report["passed"] is False
    codes = [[i["code"] for i in t["issues"]] for t in report["titles"]]
    assert codes == [["title_too_long"], ["forbidden_word"], []]
    problems = problems_from_report(report)
    assert len(problems) == 2 and "标题「" + "字" * 21 + "」" in problems[0]


def test_body_tags_required_and_forbidden_words_are_reported() -> None:
    report = evaluate_note(
        _note(body="这是最好的，不含必含词。", hashtags=["a"] * 11),
        required_words=["木质香调"],
        forbidden_words=["最好"],
    )
    codes = {i["code"] for i in report["note"]["issues"]}
    assert {
        "too_many_tags",
        "missing_required_word",
        "forbidden_word",
        "duplicate_tag",
    } <= codes
    assert not report["passed"]
    assert all(
        i["field"] != "title" for i in report["note"]["issues"]
    )  # titles are reported apart


def test_prompt_separates_verified_facts_from_unverified_points() -> None:
    messages = build_messages(
        PromptInput(
            brand_name="冰希黎（演示）",
            product_name="晨雾",
            category="perfume",
            scene_name="种草笔记",
            scene_structure="1. 开头",
            notes={"top": ["佛手柑"], "middle": [], "base": ["雪松"]},
            verified_points=("前调为柑橘",),
            unverified_points=("持久留香",),
            restricted_claims=("提升魅力",),
            style={
                "tone": "克制",
                "length": "short",
                "person": "second",
                "emoji_density": "low",
                "hashtag_count": 3,
            },
            brief="突出通勤",
            required_terms=("木质香调",),
            persona="亲切克制",
            tone_keywords=("清爽",),
            preferred_words=("柔和",),
            forbidden_words=("最好",),
            sources=(
                SourceSnippet("S1", "approved_kb", "佛手柑前调"),
                SourceSnippet("S2", "task_material", "临时资料"),
            ),
        )
    )
    system, user = messages[0].content, messages[1].content
    assert messages[0].role == "system" and messages[1].role == "user"
    assert (
        "不编造" in system
        and "只输出一个 JSON" in system
        and "20" in system
        and "1000" in system
    )
    assert "已核实的商品信息（可以当作事实）：\n- 前调为柑橘" in user
    assert "未核实的卖点（只可参考，不要写成事实）：\n- 持久留香" in user
    assert (
        "禁止宣称（不得出现）：\n- 提升魅力" in user
        and "禁用词（不得出现）：\n- 最好" in user
    )
    assert "必含词（必须自然出现）：\n- 木质香调" in user
    assert "前调：佛手柑；后调：雪松" in user
    assert (
        "[S1]（已审核资料）佛手柑前调" in user
        and "[S2]（任务资料，未审核）临时资料" in user
    )
    assert "第二人称" in user and "标签 3 个" in user and "语气：克制" in user
    assert "合规通过" not in system + user  # the prompt never claims compliance
    assert PROMPT_VERSION == "gen-v3"


def test_prompt_handles_missing_context_and_adds_problems_on_retry() -> None:
    inp = PromptInput(
        brand_name="B",
        product_name="P",
        category="other",
        scene_name="S",
        scene_structure="x",
    )
    first = build_messages(inp)[1].content
    assert "没有检索到资料" in first and "上一版有这些问题" not in first
    assert "已核实的商品信息" not in first and "品牌调性" not in first
    retry = build_messages(inp, ["标题太长", "缺少必含词"])[1].content
    assert retry.endswith("- 标题太长\n- 缺少必含词") and "上一版有这些问题" in retry


def test_body_budget_leaves_room_for_the_tags() -> None:
    assert body_budget({"hashtag_count": 0}) == 1000
    assert body_budget({"hashtag_count": 5}) == 960
    assert body_budget({}) == 960  # default of five tags
