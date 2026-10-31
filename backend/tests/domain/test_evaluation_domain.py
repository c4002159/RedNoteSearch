"""Rubric, agreement statistics and metric definitions (pure)."""

import pytest

from app.domain.evaluation.agreement import (
    METHOD,
    dimension_agreement,
    weighted_kappa,
)
from app.domain.evaluation.metrics import (
    GenerationScore,
    WordScore,
    compliance_metrics,
    factcheck_metrics,
    generation_metrics,
    ratio,
    score_words,
)
from app.domain.evaluation.rubric import (
    DIMENSIONS,
    RUBRIC_VERSION,
    rubric_payload,
    validate_scores,
)


def _metric(metrics: list, name: str):  # type: ignore[no-untyped-def,type-arg]
    return next(m for m in metrics if m.name == name)


# ---- rubric ----
def test_rubric_lists_every_dimension_with_its_version_and_no_total() -> None:
    payload = rubric_payload()
    assert payload["rubric_version"] == RUBRIC_VERSION == "rubric-v1"
    keys = [d["key"] for d in payload["dimensions"]]  # type: ignore[index,union-attr]
    assert (
        keys
        == [d.key for d in DIMENSIONS]
        == ["structure", "tone", "specificity", "faithfulness"]
    )
    assert payload["scale"] == {"min": 1, "max": 5, "meaning": "1 很差，3 一般，5 很好"}
    assert "不合并成一个总分" in str(payload["note"])


@pytest.mark.parametrize(
    ("scores", "problem"),
    [
        ({"structure": 4, "tone": 3, "specificity": 5, "faithfulness": 2}, None),
        ({"structure": 4}, "缺少维度"),
        (
            {
                "structure": 4,
                "tone": 3,
                "specificity": 5,
                "faithfulness": 2,
                "extra": 1,
            },
            "未知维度",
        ),
        ({"structure": 0, "tone": 3, "specificity": 5, "faithfulness": 2}, "分值必须"),
        ({"structure": 6, "tone": 3, "specificity": 5, "faithfulness": 2}, "分值必须"),
    ],
)
def test_score_validation(scores: dict[str, int], problem: str | None) -> None:
    result = validate_scores(scores)
    assert (
        (result is None)
        if problem is None
        else (result is not None and problem in result)
    )


# ---- agreement ----
def test_identical_ratings_give_a_kappa_of_one() -> None:
    assert weighted_kappa([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]) == pytest.approx(1.0)


def test_opposite_ratings_give_a_negative_kappa() -> None:
    kappa = weighted_kappa([1, 5, 1, 5], [5, 1, 5, 1])
    assert kappa is not None and kappa < 0


def test_kappa_is_undefined_when_there_is_nothing_to_measure() -> None:
    assert weighted_kappa([3], [3]) is None
    assert weighted_kappa([3, 3, 3], [3, 3, 3]) is None  # everyone always says 3
    assert weighted_kappa([1, 2], [1]) is None


def test_near_misses_hurt_less_than_far_misses() -> None:
    base = [1, 2, 3, 4, 5, 3, 2]
    near = weighted_kappa(base, [2, 2, 3, 4, 4, 3, 2])
    far = weighted_kappa(base, [5, 2, 3, 4, 1, 3, 2])
    assert near is not None and far is not None and near > far


def test_dimension_agreement_averages_pairs_and_counts_samples() -> None:
    result = dimension_agreement(
        "tone",
        {
            "alice": {"s1": 4, "s2": 2, "s3": 5},
            "bob": {"s1": 4, "s2": 3, "s3": 5},
            "carol": {
                "s1": 1,
                "s2": 5,
                "s9": 3,
            },  # shares only s1 and s2 with the others
        },
    )
    assert (result.dimension, result.pairs, result.samples) == ("tone", 3, 3)
    assert result.exact is not None and 0 < result.exact < 1
    assert result.within_one is not None and result.within_one >= result.exact
    assert result.weighted_kappa is not None


def test_dimension_agreement_needs_two_raters_with_two_shared_samples() -> None:
    one_rater = dimension_agreement("tone", {"alice": {"s1": 4, "s2": 3}})
    assert (
        one_rater.pairs,
        one_rater.samples,
        one_rater.exact,
        one_rater.weighted_kappa,
    ) == (0, 0, None, None)
    thin = dimension_agreement("tone", {"a": {"s1": 4}, "b": {"s1": 4}})
    assert (thin.pairs, thin.samples) == (
        0,
        1,
    )  # one shared sample is not enough for a pair
    assert "加权 Cohen" in METHOD


# ---- metrics ----
def test_word_scoring_is_case_insensitive_and_counts_each_word_once() -> None:
    score = score_words(["最好", "EAU", "唯一"], ["最好", "最好", "eau", "第一"])
    assert (score.tp, score.fp, score.fn) == (2, 1, 1)
    assert not score.exact
    assert score_words([], []).exact and score_words([" "], []).exact


def test_compliance_metrics_define_themselves_and_keep_the_counts() -> None:
    metrics = compliance_metrics(
        [WordScore(2, 0, 0), WordScore(1, 1, 1), WordScore(0, 0, 0)]
    )
    assert _metric(metrics, "precision").value == pytest.approx(3 / 4)
    assert _metric(metrics, "recall").value == pytest.approx(3 / 4)
    assert _metric(metrics, "f1").value == pytest.approx(6 / 8)
    exact = _metric(metrics, "exact_match_rate")
    assert (exact.value, exact.n) == (pytest.approx(2 / 3), 3)
    assert all(m.definition for m in metrics)
    empty = compliance_metrics([])
    assert all(m.value is None for m in empty)  # no samples, no number


def test_factcheck_metrics_expose_the_harmful_error_separately() -> None:
    pairs = [
        ("supported", "supported"),
        ("supported", "insufficient"),
        ("insufficient", "supported"),  # an unsupported claim was accepted
        ("conflict", "conflict"),
        ("insufficient", "insufficient"),
    ]
    metrics = factcheck_metrics(pairs)
    assert _metric(metrics, "accuracy").value == pytest.approx(3 / 5)
    accepted = _metric(metrics, "unsupported_accepted_rate")
    assert (accepted.value, accepted.n) == (pytest.approx(1 / 3), 3)
    recall = _metric(metrics, "supported_recall")
    assert (recall.value, recall.n) == (pytest.approx(1 / 2), 2)


def test_generation_metrics_treat_failures_as_not_passed_and_skip_missing_prices() -> (
    None
):
    scores = [
        GenerationScore(True, 0, 1000, 0.002, 300),
        GenerationScore(False, 1, 3000, None, 500),
        GenerationScore(False, 0, 0, None, 0, failed=True),
    ]
    metrics = generation_metrics(scores)
    assert _metric(metrics, "constraint_pass_rate").value == pytest.approx(1 / 3)
    assert _metric(metrics, "failure_rate").value == pytest.approx(1 / 3)
    block = _metric(metrics, "block_hint_rate")
    assert (block.value, block.n) == (
        pytest.approx(1 / 2),
        2,
    )  # failed calls produced no text
    assert _metric(metrics, "avg_latency_ms").value == pytest.approx(2000)
    cost = _metric(metrics, "avg_cost")
    assert (cost.value, cost.n) == (pytest.approx(0.002), 1)
    assert _metric(metrics, "avg_tokens").value == pytest.approx(400)
    assert _metric(generation_metrics([]), "avg_cost").value is None
    assert {"name", "value", "definition", "n"} == set(cost.as_dict())


def test_ratio_handles_an_empty_denominator() -> None:
    assert ratio(1, 0) is None and ratio(0, 5) == 0
