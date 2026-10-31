"""Case scoring and metric definitions for the automatic evaluation kinds. Every metric carries its own
definition and sample count; nothing is folded into one score."""

import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from app.domain.evidence.judge import EvidenceStatus

VERDICT_TO_STATUS = {
    "supported": EvidenceStatus.SYSTEM_SUPPORTED.value,
    "insufficient": EvidenceStatus.EVIDENCE_MISSING.value,
    "conflict": EvidenceStatus.NEEDS_HUMAN_REVIEW.value,
}


@dataclass(frozen=True)
class Metric:
    name: str
    value: float | None
    definition: str
    n: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "definition": self.definition,
            "n": self.n,
        }


def ratio(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator else None


# ---- compliance ----
@dataclass(frozen=True)
class WordScore:
    tp: int
    fp: int
    fn: int

    @property
    def exact(self) -> bool:
        return self.fp == 0 and self.fn == 0


def score_words(expected: Sequence[str], found: Sequence[str]) -> WordScore:
    """Compare the words a rule set flagged with the words a person said must be flagged
    (case-insensitive, each word counted once)."""
    want = {w.strip().lower() for w in expected if w.strip()}
    got = {w.strip().lower() for w in found if w.strip()}
    return WordScore(tp=len(want & got), fp=len(got - want), fn=len(want - got))


def compliance_metrics(scores: Sequence[WordScore]) -> list[Metric]:
    tp = sum(s.tp for s in scores)
    fp = sum(s.fp for s in scores)
    fn = sum(s.fn for s in scores)
    precision = ratio(tp, tp + fp)
    recall = ratio(tp, tp + fn)
    f1 = ratio(2 * tp, 2 * tp + fp + fn)
    return [
        Metric(
            "precision",
            precision,
            "命中的词里有多少是该命中的：tp / (tp + fp)",
            tp + fp,
        ),
        Metric("recall", recall, "该命中的词里有多少命中了：tp / (tp + fn)", tp + fn),
        Metric("f1", f1, "2·tp / (2·tp + fp + fn)", tp + fp + fn),
        Metric(
            "exact_match_rate",
            ratio(sum(1 for s in scores if s.exact), len(scores)),
            "命中结果与标注完全一致的样本占比",
            len(scores),
        ),
    ]


# ---- fact check ----
def factcheck_metrics(pairs: Sequence[tuple[str, str]]) -> list[Metric]:
    """``pairs`` are (expected verdict, predicted verdict) in the vocabulary of ``VERDICT_TO_STATUS``."""
    correct = sum(1 for e, p in pairs if e == p)
    should_not = [(e, p) for e, p in pairs if e != "supported"]
    wrongly_accepted = sum(1 for _, p in should_not if p == "supported")
    should = [(e, p) for e, p in pairs if e == "supported"]
    found = sum(1 for _, p in should if p == "supported")
    return [
        Metric(
            "accuracy",
            ratio(correct, len(pairs)),
            "判断与标注一致的样本占比",
            len(pairs),
        ),
        Metric(
            "unsupported_accepted_rate",
            ratio(wrongly_accepted, len(should_not)),
            "标注为“没有依据或相矛盾”的说法里，被误判为“有依据”的占比（越低越好）",
            len(should_not),
        ),
        Metric(
            "supported_recall",
            ratio(found, len(should)),
            "标注为“有依据”的说法里，被正确判为“有依据”的占比",
            len(should),
        ),
    ]


# ---- generation ----
@dataclass(frozen=True)
class GenerationScore:
    constraints_passed: bool
    block_hits: int
    latency_ms: int
    cost: float | None
    tokens: int
    failed: bool = False


def generation_metrics(scores: Sequence[GenerationScore]) -> list[Metric]:
    ok = [s for s in scores if not s.failed]
    costs = [s.cost for s in ok if s.cost is not None]
    return [
        Metric(
            "constraint_pass_rate",
            ratio(sum(1 for s in ok if s.constraints_passed), len(scores)),
            "一次生成就通过全部约束检查的样本占比（模型调用失败的样本算未通过）",
            len(scores),
        ),
        Metric(
            "block_hint_rate",
            ratio(sum(1 for s in ok if s.block_hits), len(ok)),
            "生成结果里含 block 级词库提示的样本占比（越低越好）",
            len(ok),
        ),
        Metric(
            "failure_rate",
            ratio(sum(1 for s in scores if s.failed), len(scores)),
            "模型调用失败或输出无法解析的样本占比",
            len(scores),
        ),
        Metric(
            "avg_latency_ms",
            ratio(sum(s.latency_ms for s in ok), len(ok)),
            "成功样本的平均耗时（毫秒）",
            len(ok),
        ),
        Metric(
            "avg_cost",
            ratio(sum(costs), len(costs)),
            "有价格配置的成功样本的平均费用；没有价格配置时为空",
            len(costs),
        ),
        Metric(
            "avg_tokens",
            ratio(sum(s.tokens for s in ok), len(ok)),
            "成功样本平均 token 数",
            len(ok),
        ),
    ]


def normalize_brand_term(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


def foreign_term_matches(fields: Sequence[str], terms: Sequence[str]) -> list[str]:
    """Match within individual output fields; never join fields into an invented phrase."""
    normalized = [normalize_brand_term(value) for value in fields]
    return [
        term
        for term in terms
        if any(normalize_brand_term(term.strip()) in value for value in normalized)
    ]


@dataclass(frozen=True)
class BrandLeakScore:
    leaked: bool | None
    constraints_passed: bool
    retrieval_leak_count: int = 0
    retrieval_checked: bool = False
    failed: bool = False


def brand_leak_metrics(scores: Sequence[BrandLeakScore]) -> list[Metric]:
    valid = [s for s in scores if s.leaked is not None]
    checked = sum(s.retrieval_checked for s in scores)
    return [
        Metric(
            "leak_rate",
            ratio(sum(bool(s.leaked) for s in valid), len(valid)),
            "被诱导时输出命中外品牌词的有效样本数/有效输出数",
            len(valid),
        ),
        Metric(
            "retrieval_leak_count",
            float(sum(s.retrieval_leak_count for s in scores)) if checked else None,
            "检索实际返回且查库确认属于其他品牌的分块次数",
            checked,
        ),
        Metric(
            "constraint_pass_rate",
            ratio(
                sum(s.constraints_passed and not s.failed for s in scores), len(scores)
            ),
            "有效且满足约束的样本数/全部样本数",
            len(scores),
        ),
        Metric(
            "failure_rate",
            ratio(sum(s.failed for s in scores), len(scores)),
            "检索故障、归属异常或生成失败样本数/全部样本数",
            len(scores),
        ),
    ]
