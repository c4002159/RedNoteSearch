"""Find the factual claims in a version and judge them against the retrieved sources (F7).

Bounded work: one extraction call plus at most ``MAX_CLAIMS`` judgement calls, each with at most
``STRUCTURED_ATTEMPTS`` tries. A claim with no candidate source needs no model call at all.
"""

import uuid
from dataclasses import dataclass

from sqlmodel import Session, col, select

from app.domain.evidence.judge import (
    PROMPT_VERSION,
    Candidate,
    ClaimJudgement,
    EvidenceStatus,
    ExtractedClaims,
    build_extract_messages,
    build_judge_messages,
    decide,
)
from app.models import ClaimEvidence, GenerationVersion
from app.models.common import get_datetime_utc
from app.ports.knowledge import KnowledgeChunk, KnowledgeSearch
from app.ports.llm import LlmClient, LlmRequest
from app.services.audit import record_audit
from app.services.errors import NotFoundError
from app.services.llm_structured import generate_structured

CANDIDATES_PER_CLAIM = 3
STRUCTURED_ATTEMPTS = 2


@dataclass(frozen=True)
class EvidenceDeps:
    llm: LlmClient
    search: KnowledgeSearch


@dataclass(frozen=True)
class EvidenceSummary:
    total: int
    supported: int
    missing: int
    needs_review: int

    @property
    def all_supported(self) -> bool:
        return self.supported == self.total


def summarize(rows: list[ClaimEvidence]) -> EvidenceSummary:
    def count(status: EvidenceStatus) -> int:
        return sum(1 for r in rows if r.status == status.value)

    return EvidenceSummary(
        total=len(rows),
        supported=count(EvidenceStatus.SYSTEM_SUPPORTED),
        missing=count(EvidenceStatus.EVIDENCE_MISSING),
        needs_review=count(EvidenceStatus.NEEDS_HUMAN_REVIEW),
    )


def _row(
    version: GenerationVersion,
    claim: str,
    status: EvidenceStatus,
    chunk: KnowledgeChunk | None,
    quote: str | None,
    rationale: str,
) -> ClaimEvidence:
    return ClaimEvidence(
        version_id=version.id,
        brand_id=version.brand_id,
        claim_text=claim,
        status=status.value,
        source_level=chunk.source_level if chunk else None,
        document_id=chunk.document_id if chunk else None,
        document_version=chunk.document_version if chunk else None,
        chunk_id=chunk.chunk_id if chunk else None,
        snapshot_id=chunk.snapshot_id if chunk else None,
        quote=quote,
        rationale=rationale,
        prompt_version=PROMPT_VERSION,
    )


def check_evidence(
    *,
    session: Session,
    version: GenerationVersion,
    task_id: uuid.UUID,
    deps: EvidenceDeps,
) -> list[ClaimEvidence]:
    """Replace the version's evidence rows with a fresh judgement of its current text.

    Caller commits. Raises ``ModelUnavailableError`` / ``LlmOutputError`` from the model layer without
    having stored half a result.
    """
    extracted = generate_structured(
        deps.llm,
        LlmRequest(
            messages=build_extract_messages(
                version.title_candidates, version.body, version.hashtags
            ),
            temperature=0.0,
            purpose="claim_extraction",
        ),
        ExtractedClaims,
        max_attempts=STRUCTURED_ATTEMPTS,
    ).value.claims

    rows: list[ClaimEvidence] = []
    for claim in extracted:
        chunks = deps.search.search(
            brand_id=version.brand_id,
            query=claim,
            task_id=task_id,
            limit=CANDIDATES_PER_CLAIM,
        )
        if not chunks:
            rows.append(
                _row(
                    version,
                    claim,
                    EvidenceStatus.EVIDENCE_MISSING,
                    None,
                    None,
                    "没有检索到相关资料",
                )
            )
            continue
        candidates = [Candidate(f"C{i}", c.content) for i, c in enumerate(chunks, 1)]
        judged = generate_structured(
            deps.llm,
            LlmRequest(
                messages=build_judge_messages(claim, candidates),
                temperature=0.0,
                purpose="evidence_judgement",
            ),
            ClaimJudgement,
            max_attempts=STRUCTURED_ATTEMPTS,
        ).value
        decision = decide(judged, {c.ref: c.text for c in candidates})
        by_ref = {c.ref: chunk for c, chunk in zip(candidates, chunks, strict=True)}
        rows.append(
            _row(
                version,
                claim,
                decision.status,
                by_ref.get(decision.source_ref or ""),
                decision.quote,
                decision.rationale,
            )
        )

    previous = session.exec(
        select(ClaimEvidence).where(ClaimEvidence.version_id == version.id)
    ).all()
    # A person's decision about a claim survives a recheck as long as the claim's wording is unchanged.
    decisions = {e.claim_text: e for e in previous if e.human_confirmed is not None}
    for row in rows:
        kept = decisions.get(row.claim_text)
        if kept is not None:
            row.human_confirmed = kept.human_confirmed
            row.confirm_note = kept.confirm_note
            row.confirmed_by = kept.confirmed_by
            row.confirmed_at = kept.confirmed_at
    for old in previous:
        session.delete(old)
    session.flush()
    session.add_all(rows)
    session.flush()
    return rows


def list_evidence(*, session: Session, version_id: uuid.UUID) -> list[ClaimEvidence]:
    return list(
        session.exec(
            select(ClaimEvidence)
            .where(ClaimEvidence.version_id == version_id)
            .order_by(col(ClaimEvidence.created_at), col(ClaimEvidence.id))
        ).all()
    )


def get_evidence(*, session: Session, evidence_id: uuid.UUID) -> ClaimEvidence:
    row = session.get(ClaimEvidence, evidence_id)
    if row is None:
        raise NotFoundError("Evidence not found")
    return row


def confirm_evidence(
    *,
    session: Session,
    evidence: ClaimEvidence,
    human_confirmed: bool,
    note: str | None,
    user_id: uuid.UUID,
) -> ClaimEvidence:
    """Record a person's decision. The system's ``status`` is left exactly as it was."""
    evidence.human_confirmed = human_confirmed
    evidence.confirm_note = note
    evidence.confirmed_by = user_id
    evidence.confirmed_at = get_datetime_utc()
    session.add(evidence)
    record_audit(
        session,
        action="evidence.confirm",
        entity_type="claim_evidence",
        actor_id=user_id,
        brand_id=evidence.brand_id,
        entity_id=evidence.id,
        detail={"human_confirmed": human_confirmed, "status": evidence.status},
    )
    session.commit()
    session.refresh(evidence)
    return evidence
