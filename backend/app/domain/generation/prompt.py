"""Assemble the generation prompt from the task's inputs. Pure: no database, no model call.

The prompt carries the anti-fabrication rule (use only the supplied facts), the length limits of the
publish page, the brand voice and the product facts. Which prompt text produced a version is recorded as
``PROMPT_VERSION``; bump it whenever the wording changes.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from app.domain.constraints import BODY_LIMIT, TAG_LIMIT, TITLE_LIMIT
from app.ports.llm import LlmMessage

PROMPT_VERSION = "gen-v1"

# A conservative guess of what one tag costs in the body budget (``#`` + a short name + a space).
APPROX_TAG_COST = 8

_LENGTH_HINT = {
    "short": "正文偏短，约 200 到 400 字",
    "medium": "正文中等长度，约 400 到 700 字",
    "long": "正文偏长，约 700 到 900 字",
}
_PERSON_HINT = {
    "first": "用第一人称（我）叙述",
    "second": "用第二人称（你）与读者交流",
    "third": "用第三人称叙述",
}
_EMOJI_HINT = {
    "low": "表情符号很少用，最多两三个",
    "medium": "适量使用表情符号",
    "high": "可以较多使用表情符号，但不要影响阅读",
}


@dataclass(frozen=True)
class SourceSnippet:
    """A piece of retrieved evidence shown to the model. ``ref`` is how the prompt names it."""

    ref: str
    level: Literal["approved_kb", "task_material"]
    text: str


@dataclass(frozen=True)
class PromptInput:
    brand_name: str
    product_name: str
    category: str
    scene_name: str
    scene_structure: str
    product_line: str | None = None
    notes: dict[str, list[str]] = field(default_factory=dict)
    verified_points: tuple[str, ...] = ()
    unverified_points: tuple[str, ...] = ()
    restricted_claims: tuple[str, ...] = ()
    style: dict[str, Any] = field(default_factory=dict)
    brief: str = ""
    required_terms: tuple[str, ...] = ()
    persona: str | None = None
    tone_keywords: tuple[str, ...] = ()
    preferred_words: tuple[str, ...] = ()
    forbidden_words: tuple[str, ...] = ()
    sources: tuple[SourceSnippet, ...] = ()


SYSTEM_PROMPT = f"""你是小红书美妆香氛品牌的文案助手，为运营人员起草笔记。你只负责起草，发布前由人审核。

必须遵守：
1. 事实只能来自下面提供的“已核实的商品信息”和“参考资料”。资料里没有的内容，不要写成事实：不编造获奖、认证、销量、成分含量、测试数据、功效或使用效果。资料不足时，写场景和主观感受，不写具体事实。
2. 标注为“任务资料”的内容没有经过审核，使用时要谨慎，不要当作已经核实的事实。
3. 不使用绝对化用语（最、第一、唯一、100% 等），不承诺功效，不涉及医疗或治疗。
4. “禁止宣称”和“禁用词”里的内容一律不要出现；“必含词”必须自然地出现在文中。
5. 小红书长度限制：每个标题的加权长度不超过 {TITLE_LIMIT}（汉字等全角字符算 1，英文字母、数字、半角符号算 0.5）；正文加上标签的可见字符不超过 {BODY_LIMIT}（换行不算，一个 emoji 算 2）；标签不超过 {TAG_LIMIT} 个，标签不带 # 号。
6. 只输出一个 JSON 对象，不要输出其他文字，格式如下：
{{"title_candidates": ["标题1", "标题2", "标题3"], "body": "正文", "hashtags": ["标签1", "标签2"], "cover_candidates": ["封面文案1", "封面文案2"]}}
标题给 3 到 5 个候选；封面文案给 2 到 3 个，每个不超过 12 个字。"""


def _lines(title: str, items: Sequence[str]) -> str:
    if not items:
        return ""
    return f"{title}：\n" + "\n".join(f"- {item}" for item in items) + "\n\n"


def _style_text(style: dict[str, Any]) -> str:
    parts = []
    if style.get("tone"):
        parts.append(f"语气：{style['tone']}")
    parts.append(
        _LENGTH_HINT.get(style.get("length", "medium"), _LENGTH_HINT["medium"])
    )
    parts.append(_PERSON_HINT.get(style.get("person", "first"), _PERSON_HINT["first"]))
    parts.append(_EMOJI_HINT.get(style.get("emoji_density", "low"), _EMOJI_HINT["low"]))
    count = int(style.get("hashtag_count", 5))
    parts.append(f"标签 {count} 个")
    return "；".join(parts)


def body_budget(style: dict[str, Any]) -> int:
    """Roughly how many body characters remain once the requested tags are counted."""
    return BODY_LIMIT - int(style.get("hashtag_count", 5)) * APPROX_TAG_COST


def build_messages(
    inp: PromptInput, problems: Sequence[str] = ()
) -> tuple[LlmMessage, ...]:
    """The chat messages for one generation round. ``problems`` are failures of the previous attempt
    that the model must fix this time."""
    notes = "；".join(
        f"{label}：{'、'.join(values)}"
        for label, values in (
            ("前调", inp.notes.get("top", [])),
            ("中调", inp.notes.get("middle", [])),
            ("后调", inp.notes.get("base", [])),
        )
        if values
    )
    voice = ""
    if inp.persona:
        voice += f"品牌调性：{inp.persona}\n"
    if inp.tone_keywords:
        voice += f"调性关键词：{'、'.join(inp.tone_keywords)}\n"
    if inp.preferred_words:
        voice += f"偏好用词：{'、'.join(inp.preferred_words)}\n"
    sources = "".join(
        f"[{s.ref}]（{'已审核资料' if s.level == 'approved_kb' else '任务资料，未审核'}）{s.text}\n"
        for s in inp.sources
    )
    user = (
        f"品牌：{inp.brand_name}\n"
        f"{voice}\n"
        f"商品：{inp.product_name}"
        f"{'（' + inp.product_line + '）' if inp.product_line else ''}，品类 {inp.category}\n"
        f"{('香调：' + notes + chr(10)) if notes else ''}\n"
        + _lines("已核实的商品信息（可以当作事实）", inp.verified_points)
        + _lines("未核实的卖点（只可参考，不要写成事实）", inp.unverified_points)
        + _lines("禁止宣称（不得出现）", inp.restricted_claims)
        + _lines("禁用词（不得出现）", inp.forbidden_words)
        + _lines("必含词（必须自然出现）", inp.required_terms)
        + f"笔记场景：{inp.scene_name}\n结构建议：\n{inp.scene_structure}\n\n"
        + f"风格要求：{_style_text(inp.style)}；正文大约不超过 {body_budget(inp.style)} 个字符\n\n"
        + (f"运营补充说明：{inp.brief}\n\n" if inp.brief else "")
        + (
            f"参考资料：\n{sources}\n"
            if sources
            else "参考资料：（没有检索到资料，只能写场景和感受）\n\n"
        )
        + "请按要求输出 JSON。"
    )
    if problems:
        user += "\n\n上一版有这些问题，请逐条修正后重新输出完整 JSON：\n" + "\n".join(
            f"- {p}" for p in problems
        )
    return (LlmMessage("system", SYSTEM_PROMPT), LlmMessage("user", user))
