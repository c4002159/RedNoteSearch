"""Evidence judgement rules (pure): what a model's verdict is worth once the code has checked it."""

import pytest
from pydantic import ValidationError

from app.domain.evidence.judge import (
    JUDGE_SYSTEM,
    MAX_CLAIMS,
    Candidate,
    ClaimJudgement,
    EvidenceStatus,
    ExtractedClaims,
    build_extract_messages,
    build_judge_messages,
    decide,
    quote_appears_in,
)

SOURCES = {"C1": "前调为柑橘与佛手柑，\n香调清新。", "C2": "适合日常通勤。"}


def _judgement(**overrides: object) -> ClaimJudgement:
    data: dict[str, object] = {
        "verdict": "supported",
        "source_ref": "C1",
        "quote": "前调为柑橘与佛手柑",
        "rationale": "资料中有这句",
    }
    return ClaimJudgement.model_validate(data | overrides)


def test_a_verified_quote_is_system_supported() -> None:
    decision = decide(_judgement(), SOURCES)
    assert decision.status is EvidenceStatus.SYSTEM_SUPPORTED
    assert (decision.source_ref, decision.quote) == ("C1", "前调为柑橘与佛手柑")
    assert decision.rationale == "资料中有这句"


def test_quotes_survive_line_breaks_spaces_and_case() -> None:
    assert quote_appears_in("柑橘与佛手柑， 香调清新", SOURCES["C1"])
    assert quote_appears_in("EAU de parfum", "an eau  de\nParfum note")
    assert not quote_appears_in("", "anything")
    assert not quote_appears_in("不存在的句子", SOURCES["C1"])


@pytest.mark.parametrize(
    "overrides",
    [
        {"source_ref": "C9"},  # a source that was never offered
        {"source_ref": None},
        {"quote": "资料里没有这句话"},  # invented quote
        {"quote": None},
        {"quote": "   "},
        {"source_ref": "C2"},  # real source, but the quote is from another one
    ],
)
def test_unverifiable_support_is_downgraded_to_human_review(
    overrides: dict[str, object],
) -> None:
    decision = decide(_judgement(**overrides), SOURCES)
    assert decision.status is EvidenceStatus.NEEDS_HUMAN_REVIEW
    assert "无法核实" in decision.rationale


def test_insufficient_means_evidence_missing() -> None:
    decision = decide(
        _judgement(verdict="insufficient", source_ref=None, quote=None, rationale=""),
        SOURCES,
    )
    assert decision.status is EvidenceStatus.EVIDENCE_MISSING
    assert (
        decision.source_ref is None and decision.rationale
    )  # a default reason is filled in


def test_conflict_needs_a_person_and_keeps_only_real_sources() -> None:
    real = decide(_judgement(verdict="conflict", rationale="资料写的是中调"), SOURCES)
    assert real.status is EvidenceStatus.NEEDS_HUMAN_REVIEW and real.source_ref == "C1"
    invented = decide(
        _judgement(verdict="conflict", source_ref="C7", rationale=""), SOURCES
    )
    assert invented.source_ref is None and invented.rationale


def test_extracted_claims_are_cleaned_deduplicated_and_capped() -> None:
    claims = ExtractedClaims(
        claims=[
            " 前调为佛手柑 ",
            "前调为佛手柑",
            "",
            "  ",
            *[f"说法{i}" for i in range(20)],
        ]
    )
    assert claims.claims[0] == "前调为佛手柑"
    assert len(claims.claims) == MAX_CLAIMS and "" not in claims.claims
    assert ExtractedClaims().claims == []
    with pytest.raises(ValidationError):
        ExtractedClaims(claims=["x"] * 41)
    with pytest.raises(ValidationError):
        ClaimJudgement.model_validate({"verdict": "maybe"})


def test_prompts_carry_the_task_and_never_claim_truth() -> None:
    extract = build_extract_messages(["标题甲", "标题乙"], "正文内容", ["日常", "通勤"])
    assert (
        "标题甲" in extract[1].content
        and "正文内容" in extract[1].content
        and "日常" in extract[1].content
    )
    judge = build_judge_messages(
        "前调为佛手柑", [Candidate("C1", "资料一"), Candidate("C2", "资料二")]
    )
    assert (
        "说法：前调为佛手柑" in judge[1].content and "[C2] 资料二" in judge[1].content
    )
    assert "不表示说法本身是否属实" in JUDGE_SYSTEM
    assert "事实正确" not in JUDGE_SYSTEM
