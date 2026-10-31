"""How well raters agree. Plain statistics with the method stated, never a made-up overall score."""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import combinations

from app.domain.evaluation.rubric import MAX_SCORE, MIN_SCORE

METHOD = (
    "两两评分者之间的加权 Cohen's kappa（二次权重），对所有评分者对取平均；"
    "同时给出完全一致的比例和相差不超过 1 分的比例。样本少于 2 个共同评分的评分者对不计入。"
)


@dataclass(frozen=True)
class DimensionAgreement:
    dimension: str
    pairs: int  # rater pairs that had at least 2 samples rated by both
    samples: int  # samples rated by at least two raters
    exact: float | None
    within_one: float | None
    weighted_kappa: float | None


def weighted_kappa(a: Sequence[int], b: Sequence[int]) -> float | None:
    """Quadratic weighted Cohen's kappa of two raters' scores for the same samples.

    ``None`` when it is undefined: fewer than two samples, or both raters expect no disagreement at all
    (everyone gave the same single score, so there is nothing to measure).
    """
    n = len(a)
    if n < 2 or n != len(b):
        return None
    k = MAX_SCORE - MIN_SCORE + 1
    observed = [[0.0] * k for _ in range(k)]
    for x, y in zip(a, b, strict=True):
        observed[x - MIN_SCORE][y - MIN_SCORE] += 1
    row = [sum(observed[i]) for i in range(k)]
    col = [sum(observed[i][j] for i in range(k)) for j in range(k)]
    num = den = 0.0
    for i in range(k):
        for j in range(k):
            weight = (i - j) ** 2 / (k - 1) ** 2
            num += weight * observed[i][j]
            den += weight * row[i] * col[j] / n
    if den == 0:
        return None
    return 1 - num / den


def dimension_agreement(
    dimension: str, by_rater: Mapping[str, Mapping[str, int]]
) -> DimensionAgreement:
    """``by_rater[rater][sample]`` is that rater's score for the sample on this dimension."""
    kappas: list[float] = []
    exact_hits = within_hits = total = pairs = 0
    rated_by: dict[str, set[str]] = defaultdict(set)
    for rater, scores in by_rater.items():
        for sample in scores:
            rated_by[sample].add(rater)
    for first, second in combinations(sorted(by_rater), 2):
        shared = sorted(set(by_rater[first]) & set(by_rater[second]))
        if len(shared) < 2:
            continue
        pairs += 1
        xs = [by_rater[first][s] for s in shared]
        ys = [by_rater[second][s] for s in shared]
        total += len(shared)
        exact_hits += sum(1 for x, y in zip(xs, ys, strict=True) if x == y)
        within_hits += sum(1 for x, y in zip(xs, ys, strict=True) if abs(x - y) <= 1)
        kappa = weighted_kappa(xs, ys)
        if kappa is not None:
            kappas.append(kappa)
    return DimensionAgreement(
        dimension=dimension,
        pairs=pairs,
        samples=sum(1 for raters in rated_by.values() if len(raters) >= 2),
        exact=exact_hits / total if total else None,
        within_one=within_hits / total if total else None,
        weighted_kappa=sum(kappas) / len(kappas) if kappas else None,
    )
