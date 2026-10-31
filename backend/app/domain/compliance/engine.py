"""Risk hints for a generated note (F8). They are rule-assisted hints for a human reviewer, not a
compliance verdict: nothing here says "compliant" and no wording may suggest legal approval.

Three layers:

* ``lexicon``: a rule's pattern (plain text or regular expression) is found in the text.
* ``efficacy_basis``: like lexicon, but the hit is about an efficacy, medical or data claim that needs a
  supporting source; a hit whose sentence is backed by supported evidence is softened to a warning.
* ``context``: findings from a model reading the text for implied claims that no word list catches.
"""

import enum
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.ports.llm import LlmMessage

PROMPT_VERSION = "context-v1"
MAX_PATTERN_LENGTH = 200
# A regular expression typed in by a person must not be able to hang the server.
_NESTED_QUANTIFIER = re.compile(r"\([^)]*[+*][^)]*\)[+*{]")


class Layer(enum.StrEnum):
    LEXICON = "lexicon"
    CONTEXT = "context"
    EFFICACY_BASIS = "efficacy_basis"


class RuleType(enum.StrEnum):
    ABSOLUTE_TERM = "absolute_term"
    EFFICACY_CLAIM = "efficacy_claim"
    MEDICAL_TERM = "medical_term"
    DATA_CLAIM = "data_claim"
    PLATFORM_RULE = "platform_rule"
    BRAND_FORBIDDEN = "brand_forbidden"


class Severity(enum.StrEnum):
    BLOCK = "block"
    WARN = "warn"


@dataclass(frozen=True)
class Rule:
    id: str
    rule_version: int
    layer: Layer
    rule_type: RuleType
    pattern: str
    is_regex: bool
    severity: Severity
    suggestion: str = ""
    source_name: str = ""
    source_clause: str | None = None
    region_scope: str | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    enabled: bool = True


@dataclass(frozen=True)
class Hit:
    rule_id: str | None
    rule_version: int | None
    layer: Layer
    rule_type: str | None
    severity: Severity
    field: str
    start: int
    end: int
    matched_text: str
    suggestion: str
    source_name: str
    source_clause: str | None
    region_scope: str | None
    # efficacy layer only: whether a supported source backs the sentence the hit is in
    basis: Literal["found", "none"] | None = None


def pattern_problem(pattern: str, is_regex: bool) -> str | None:
    """Why a rule pattern is not acceptable, or ``None`` when it is."""
    if not pattern.strip():
        return "规则内容不能为空"
    if len(pattern) > MAX_PATTERN_LENGTH:
        return f"规则内容不能超过 {MAX_PATTERN_LENGTH} 个字符"
    if not is_regex:
        return None
    if _NESTED_QUANTIFIER.search(pattern):
        return "正则表达式含有嵌套的重复，可能导致检查卡住"
    try:
        re.compile(pattern)
    except re.error as exc:
        return f"正则表达式无效：{exc}"
    return None


def is_active(rule: Rule, today: date) -> bool:
    if not rule.enabled:
        return False
    if rule.effective_from and today < rule.effective_from:
        return False
    return not (rule.effective_to and today > rule.effective_to)


def _matches(rule: Rule, text: str) -> list[tuple[int, int]]:
    if rule.is_regex:
        return [
            (m.start(), m.end())
            for m in re.finditer(rule.pattern, text, flags=re.IGNORECASE)
            if m.end() > m.start()
        ]
    lowered, needle = text.lower(), rule.pattern.lower()
    spans, start = [], 0
    while (index := lowered.find(needle, start)) != -1:
        spans.append((index, index + len(needle)))
        start = index + len(needle)
    return spans


def scan(fields: Mapping[str, str], rules: Sequence[Rule], *, today: date) -> list[Hit]:
    """Find every active rule's matches in each field; the ``context`` layer has no pattern and is skipped."""
    hits: list[Hit] = []
    for rule in rules:
        if rule.layer is Layer.CONTEXT or not is_active(rule, today):
            continue
        if pattern_problem(rule.pattern, rule.is_regex):
            continue  # a bad rule never breaks the check of a note
        for name, text in fields.items():
            for start, end in _matches(rule, text):
                hits.append(
                    Hit(
                        rule_id=rule.id,
                        rule_version=rule.rule_version,
                        layer=rule.layer,
                        rule_type=rule.rule_type.value,
                        severity=rule.severity,
                        field=name,
                        start=start,
                        end=end,
                        matched_text=text[start:end],
                        suggestion=rule.suggestion,
                        source_name=rule.source_name,
                        source_clause=rule.source_clause,
                        region_scope=rule.region_scope,
                    )
                )
    return sorted(hits, key=lambda h: (h.field, h.start, h.end))


_SENTENCE_END = "。！？!?\n；;"


def sentence_around(text: str, start: int, end: int) -> str:
    left = max((text.rfind(ch, 0, start) for ch in _SENTENCE_END), default=-1)
    rights = [i for ch in _SENTENCE_END if (i := text.find(ch, end)) != -1]
    return text[left + 1 : min(rights) if rights else len(text)].strip()


def apply_efficacy_basis(
    hits: Sequence[Hit],
    fields: Mapping[str, str],
    supported_claims: Sequence[str],
) -> list[Hit]:
    """Mark efficacy-layer hits as backed or not, and soften the backed ones to a warning.

    A hit is backed when its sentence and a ``system_supported`` claim contain one another. This only
    reflects that a source states the claim; it never turns the sentence into a verified fact.
    """
    claims = [c.strip() for c in supported_claims if c.strip()]
    result: list[Hit] = []
    for hit in hits:
        if hit.layer is not Layer.EFFICACY_BASIS:
            result.append(hit)
            continue
        sentence = sentence_around(fields.get(hit.field, ""), hit.start, hit.end)
        backed = any(c in sentence or (sentence and sentence in c) for c in claims)
        result.append(
            replace(
                hit,
                basis="found" if backed else "none",
                severity=Severity.WARN if backed else hit.severity,
            )
        )
    return result


class ContextFinding(BaseModel):
    sentence: str
    concern: str = ""
    severity: Literal["block", "warn"] = "warn"
    suggestion: str = ""


class ContextFindings(BaseModel):
    findings: list[ContextFinding] = Field(default_factory=list, max_length=30)

    @field_validator("findings")
    @classmethod
    def _drop_blank(cls, values: list[ContextFinding]) -> list[ContextFinding]:
        return [v for v in values if v.sentence.strip()]


def locate_findings(
    findings: Sequence[ContextFinding], fields: Mapping[str, str]
) -> list[Hit]:
    """Turn model findings into hits, keeping only sentences that really occur in a field.

    A finding whose sentence cannot be found is dropped: the model may not point at text that is not
    there. Context findings are never ``block`` unless the model says so, and always carry no rule id.
    """
    hits: list[Hit] = []
    for finding in findings:
        sentence = finding.sentence.strip()
        for name, text in fields.items():
            index = text.find(sentence)
            if index == -1:
                continue
            hits.append(
                Hit(
                    rule_id=None,
                    rule_version=None,
                    layer=Layer.CONTEXT,
                    rule_type=None,
                    severity=Severity(finding.severity),
                    field=name,
                    start=index,
                    end=index + len(sentence),
                    matched_text=sentence,
                    suggestion=finding.suggestion or finding.concern,
                    source_name="模型语境判断",
                    source_clause=None,
                    region_scope=None,
                )
            )
            break
    return hits


CONTEXT_SYSTEM = """你为小红书美妆香氛笔记找“可能有风险的隐含说法”，供运营人员复核。
找这几类：没有出现违禁词但暗示了功效、疗效或医疗效果的句子；暗示“最好、唯一、绝对”的比较或夸大；没有依据的数据或对比；诱导加微信、私信、站外交易的句子。
只列出确有风险的句子，句子必须从原文逐字摘出；没有就返回空列表。severity 只有 block（明显违规风险）和 warn（需要留意）。
只输出一个 JSON 对象：{"findings": [{"sentence": "原文句子", "concern": "担心什么", "severity": "warn", "suggestion": "怎么改"}]}。
你的结果只是风险提示，不是合规结论。"""


def build_context_messages(fields: Mapping[str, str]) -> tuple[LlmMessage, ...]:
    text = "\n".join(f"【{name}】{value}" for name, value in fields.items())
    return (LlmMessage("system", CONTEXT_SYSTEM), LlmMessage("user", text))
