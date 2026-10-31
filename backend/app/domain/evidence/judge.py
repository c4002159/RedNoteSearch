"""Evidence judgement for claims in a generated note (F7).

The model proposes whether a claim is supported by retrieved sources; code decides what that is worth.
A "supported" answer is accepted only if it points at a source that was actually retrieved and quotes text
that really appears in it; anything else is downgraded to human review. "Supported" here means the
sources back the wording, never that the claim is true.
"""

import enum
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.ports.llm import LlmMessage

PROMPT_VERSION = "evidence-v1"
MAX_CLAIMS = 12


class EvidenceStatus(enum.StrEnum):
    SYSTEM_SUPPORTED = "system_supported"
    EVIDENCE_MISSING = "evidence_missing"
    NEEDS_HUMAN_REVIEW = "needs_human_review"


class ExtractedClaims(BaseModel):
    claims: list[str] = Field(default_factory=list, max_length=40)

    @field_validator("claims")
    @classmethod
    def _clean(cls, values: list[str]) -> list[str]:
        seen: dict[str, None] = {}
        for value in values:
            if isinstance(value, str) and value.strip():
                seen.setdefault(value.strip(), None)
        return list(seen)[:MAX_CLAIMS]


class ClaimJudgement(BaseModel):
    verdict: Literal["supported", "insufficient", "conflict"]
    source_ref: str | None = None
    quote: str | None = None
    rationale: str = ""


@dataclass(frozen=True)
class Candidate:
    """A retrieved source offered to the judge, named ``ref`` in the prompt (``C1``, ``C2``...)."""

    ref: str
    text: str


@dataclass(frozen=True)
class EvidenceDecision:
    status: EvidenceStatus
    source_ref: str | None
    quote: str | None
    rationale: str


_SPACE = re.compile(r"\s+")


def _normalize(text: str) -> str:
    return _SPACE.sub("", text).lower()


def quote_appears_in(quote: str, source_text: str) -> bool:
    """Whitespace- and case-insensitive containment, so a quote survives line breaks in the source."""
    needle = _normalize(quote)
    return bool(needle) and needle in _normalize(source_text)


def decide(
    judgement: ClaimJudgement, candidates: Mapping[str, str]
) -> EvidenceDecision:
    """Turn the model's verdict into a stored status.

    * ``insufficient`` -> ``evidence_missing``
    * ``conflict`` -> ``needs_human_review``
    * ``supported`` -> ``system_supported`` only when the cited source exists among the candidates and the
      quote really appears in it; otherwise ``needs_human_review`` (the model claimed support the code
      cannot confirm).
    """
    rationale = judgement.rationale.strip()
    if judgement.verdict == "insufficient":
        return EvidenceDecision(
            EvidenceStatus.EVIDENCE_MISSING,
            None,
            None,
            rationale or "资料中没有找到依据",
        )
    if judgement.verdict == "conflict":
        return EvidenceDecision(
            EvidenceStatus.NEEDS_HUMAN_REVIEW,
            judgement.source_ref if judgement.source_ref in candidates else None,
            judgement.quote,
            rationale or "资料与说法存在出入，需要人工判断",
        )
    ref, quote = judgement.source_ref, (judgement.quote or "").strip()
    if (
        ref is None
        or ref not in candidates
        or not quote_appears_in(quote, candidates[ref])
    ):
        return EvidenceDecision(
            EvidenceStatus.NEEDS_HUMAN_REVIEW,
            ref if ref in candidates else None,
            quote or None,
            "模型认为有依据，但引用的资料或原文无法核实，需要人工确认",
        )
    return EvidenceDecision(
        EvidenceStatus.SYSTEM_SUPPORTED, ref, quote, rationale or "资料中有对应表述"
    )


EXTRACT_SYSTEM = """你从小红书笔记里找出“可以核查的事实性说法”，例如成分、香调、产地、获奖、认证、数据、销量、功效、使用效果、对比。
不要列出主观感受、场景描写、修辞和泛泛的形容。每条说法用一句话原样或近似原样写出，最多 12 条。
只输出一个 JSON 对象：{"claims": ["说法1", "说法2"]}。没有可核查的说法时输出 {"claims": []}。"""


def build_extract_messages(
    titles: Sequence[str], body: str, hashtags: Sequence[str]
) -> tuple[LlmMessage, ...]:
    text = "标题候选：\n" + "\n".join(f"- {t}" for t in titles) + f"\n\n正文：\n{body}"
    if hashtags:
        text += "\n\n标签：" + "、".join(hashtags)
    return (LlmMessage("system", EXTRACT_SYSTEM), LlmMessage("user", text))


JUDGE_SYSTEM = """你判断“资料”是否支持“说法”。只依据给出的资料，不使用其他知识。
- supported：某条资料里有与说法一致的表述；必须给出 source_ref（如 C1）和从该资料中逐字摘出的 quote。
- insufficient：资料里没有这方面的内容，或只有相关但不足以支持的内容。
- conflict：资料与说法不一致或互相矛盾。
只输出一个 JSON 对象：{"verdict": "supported|insufficient|conflict", "source_ref": "C1 或 null", "quote": "逐字摘录或 null", "rationale": "一句话理由"}。
你的判断只表示资料是否支持这个说法，不表示说法本身是否属实。"""


def build_judge_messages(
    claim: str, candidates: Sequence[Candidate]
) -> tuple[LlmMessage, ...]:
    sources = "\n".join(f"[{c.ref}] {c.text}" for c in candidates)
    return (
        LlmMessage("system", JUDGE_SYSTEM),
        LlmMessage("user", f"说法：{claim}\n\n资料：\n{sources}"),
    )
