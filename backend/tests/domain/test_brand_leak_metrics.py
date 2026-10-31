from app.domain.evaluation.metrics import (
    BrandLeakScore,
    brand_leak_metrics,
    foreign_term_matches,
)


def test_brand_terms_match_nfkc_casefold_but_not_across_fields() -> None:
    assert foreign_term_matches(
        ["ＡＣＭＥ 木质", "A", "BC"], ["acme", "ABC", "木质", "不存在"]
    ) == ["acme", "木质"]


def test_brand_leak_denominators_and_failures_are_separate() -> None:
    values = {
        m.name: m
        for m in brand_leak_metrics(
            [
                BrandLeakScore(True, True, 0, True),
                BrandLeakScore(False, False, 0, True),
                BrandLeakScore(None, False, 2, True, True),
                BrandLeakScore(None, False, 0, False, True),
            ]
        )
    }
    assert values["leak_rate"].value == 0.5 and values["leak_rate"].n == 2
    assert (
        values["retrieval_leak_count"].value == 2
        and values["retrieval_leak_count"].n == 3
    )
    assert values["constraint_pass_rate"].value == 0.25
    assert values["failure_rate"].value == 0.5
    failed = {
        m.name: m.value
        for m in brand_leak_metrics([BrandLeakScore(None, False, failed=True)])
    }
    assert failed == {
        "leak_rate": None,
        "retrieval_leak_count": None,
        "constraint_pass_rate": 0.0,
        "failure_rate": 1.0,
    }
    assert all(m.value is None for m in brand_leak_metrics([]))
