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

PROMPT_VERSION = "gen-v4"

# A conservative guess of what one tag costs in the body budget (``#`` + a short name + a space).
APPROX_TAG_COST = 8

_LENGTH_HINT = {
    "short": "正文偏短，约 200 到 400 字",
    "medium": "正文中等长度，约 400 到 700 字",
    "long": "正文偏长，约 700 到 900 字",
}
_PERSON_HINT = {
    "first": "可以用亲切的口吻和“我们”“一起”与读者交流，但不要写“我”的个人经历、习惯或偏好",
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
1. 事实只能来自下面提供的“已核实的商品信息”和“参考资料”。资料里没有的内容，不要写成事实：不编造获奖、认证、销量、成分含量、测试数据、功效或使用效果。使用方法、用量、频率、搭配、适用人群或肤质、留香时长、效果承诺，资料里没有就一律不写，也不给别人操作性建议。气味、瓶身、质感只写资料里出现过的描述，不自己添加资料没有的比喻、动作或场景细节（例如“摇一摇会散开”“像洗完头发的味道”这类资料里没有的说法）。资料不足时，写场景和整体感受，宁可写短，也不要补充资料里没有的细节。
1.1 写作者不是真实的使用者，不要虚构“我”的个人信息：不写“我一直、我最近、我自己、我习惯、我偏爱、我觉得、对我来说”这类关于写作者自己的经历、习惯、偏好或判断，不写用了多久、什么场合用、喷在哪里、喷几下，也不要说“我最近在用某某品牌”。需要表达感受时，用“这支香给人的感觉是……”“适合……的时候”这类对产品和场景的描述，或者用设问、邀请读者的口吻（如“你更喜欢哪一种？”），不把感受说成“我”的亲身经历。
2. 标注为“任务资料”的内容没有经过审核，使用时要谨慎，不要当作已经核实的事实。
3. 不使用绝对化用语（最、第一、唯一、100% 等），不承诺功效，不涉及医疗或治疗。
4. “禁止宣称”和“禁用词”里的内容一律不要出现；“必含词”必须自然地出现在文中。
5. 小红书长度限制：每个标题的加权长度不超过 {TITLE_LIMIT}（汉字和全角标点算 1，emoji 算 2，英文字母、数字、半角符号算 0.5）；正文加上标签的可见字符不超过 {BODY_LIMIT}（换行不算，一个 emoji 算 2）；标签不超过 {TAG_LIMIT} 个，标签不带 # 号。
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
