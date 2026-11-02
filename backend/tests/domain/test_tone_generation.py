import json

import pytest

from app.domain.tone import (
    InvalidToneOutput,
    NoValidTones,
    filter_generated_tones,
    tone_key,
)
from app.domain.tone_prompt import TONE_PROMPT_VERSION, build_tone_prompt
from app.fakes.demo_llm import DemoLlmClient
from app.ports.llm import LlmMessage, LlmRequest


def answer(*items: tuple[str, str]) -> str:
    return json.dumps({"suggestions": [{"tone": t, "reason": r} for t, r in items]})


@pytest.mark.parametrize(
    "word",
    [
        "最",
        "第一",
        "唯一",
        "100%",
        "１００％",
        "百 分 之 百",
        "无副作用",
        "祛痘",
        "治疗",
        "美白",
        "改善睡眠",
        "补水",
        "CURE",
        "禁词",
    ],
)
@pytest.mark.parametrize("field", ["tone", "reason"])
def test_unsafe_tone_and_reason_are_removed(word: str, field: str) -> None:
    bad = (word, "写作方式") if field == "tone" else ("自然", word)
    items = filter_generated_tones(
        answer(bad, ("平实", "清楚叙述")), forbidden_words=["禁词"]
    )
    assert [i.tone for i in items] == ["平实"]


def test_clean_exact_duplicates_and_existing() -> None:
    items = filter_generated_tones(
        answer(
            (" 已有 ", "描述"),
            (" 温柔\t克制 ", "描述"),
            ("温柔 克制", "描述"),
            ("其他", "描述"),
        ),
        existing=["已有"],
        count=1,
    )
    assert [i.tone for i in items] == ["温柔 克制"]


@pytest.mark.parametrize(
    "tone,reason",
    [
        ("", "说明"),
        ("风" * 21, "说明"),
        ("风格", "字" * 61),
        ("风格", "   "),
        ("最强", "说明"),
    ],
)
def test_all_rejected(tone: str, reason: str) -> None:
    with pytest.raises(NoValidTones):
        filter_generated_tones(answer((tone, reason)))


def test_lengths_code_points_and_whitespace() -> None:
    items = filter_generated_tones(
        answer(("风" * 19 + "😀", "字" * 60), ("a b", " e\u0301 "))
    )
    assert len(items[0].tone) == 20 and len(items[0].reason) == 60
    assert items[1].reason == "e\u0301"
    with pytest.raises(NoValidTones):
        filter_generated_tones(answer(("已有", "描述")), existing=["已有"])


@pytest.mark.parametrize(
    "text",
    [
        "",
        "null",
        "[]",
        "{",
        "{}",
        '{"suggestions":"a"}',
        '```json\n{"suggestions":[]}\n```',
        '{"suggestions":[],"body":"extra"}',
    ],
)
def test_invalid_json(text: str) -> None:
    with pytest.raises(InvalidToneOutput):
        filter_generated_tones(text)


def test_empty_and_bad_items() -> None:
    for text in ('{"suggestions":[]}', '{"suggestions":[{"tone":3,"reason":false}]}'):
        with pytest.raises(NoValidTones):
            filter_generated_tones(text)


@pytest.mark.parametrize("keywords", [[], ["温柔", "克制"]])
def test_demo_fixed_prompt_and_count(keywords: list[str]) -> None:
    system, context = build_tone_prompt(
        profile={"tone_keywords": keywords} if keywords else None,
        product=None,
        scene_name=None,
        existing_tones={"history": []},
        count=5,
    )
    assert TONE_PROMPT_VERSION == "tone-v1"
    assert "不是产品功效" in system and "不编造" in system
    request = LlmRequest(
        messages=(LlmMessage("system", system), LlmMessage("user", context)),
        purpose="tone_suggestions",
    )
    a = DemoLlmClient().complete(request)
    assert a == DemoLlmClient().complete(request)
    items = filter_generated_tones(a.text)
    assert len(items) == (5 if keywords else 2)
    if keywords:
        assert all(any(k in item.tone for k in keywords) for item in items)
    else:
        assert "profile" not in context


def test_width_case_spaces_and_punctuation_do_not_make_a_tone_new() -> None:
    items = filter_generated_tones(
        answer(
            ("温柔，叙事", "描述"),
            ("温柔 叙事", "描述"),
            ("ＡＢ Calm", "描述"),
            ("ab calm!", "描述"),
            ("全新", "描述"),
        ),
        existing=["温柔叙事"],
    )
    assert [i.tone for i in items] == ["ＡＢ Calm", "全新"]


@pytest.mark.parametrize(
    "left,right",
    [
        (" ＡＢ，Calm! ", "ab calm"),
        ("温柔、叙述", "温柔\u3000叙述"),
        ("Straße", "STRASSE"),
    ],
)
def test_tone_key_equivalence(left: str, right: str) -> None:
    assert tone_key(left) == tone_key(right)


def test_symbol_differences_remain_and_empty_keys_are_discarded() -> None:
    assert tone_key("C+") != tone_key("C")
    assert tone_key("🙂") != tone_key("🙃")
    assert tone_key("！？\u3000") == ""
    with pytest.raises(NoValidTones):
        filter_generated_tones(answer(("！！！", "描述")))
    with pytest.raises(NoValidTones):
        filter_generated_tones(answer(("已有！", "描述")), existing=["已有"])


def test_exclude_request_bounds_without_database() -> None:
    from pydantic import ValidationError

    from app.services.tone_generate import ToneGenerateRequest

    assert ToneGenerateRequest().exclude == []
    assert len(ToneGenerateRequest(exclude=["字" * 40] * 30).exclude) == 30
    for value in ([""], ["字" * 41], ["字"] * 31, [1], None, "text"):
        with pytest.raises(ValidationError):
            ToneGenerateRequest.model_validate({"exclude": value})
