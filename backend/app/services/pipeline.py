"""The checking pipeline for a version: constraints, then evidence, then compliance hints.

``run_checks`` is the one place that decides a version's state after checking; generation, rechecking after
an edit and the automatic rewrite all use it. The result is a *process* state, never a verdict:

* ``constraint_failed``: the length, word or field rules failed (evidence and compliance are not run);
* ``needs_human_review``: some claim has no supported source and nobody confirmed it, or a block-level
  risk hint is still open;
* ``checks_completed``: nothing is open. A person still has to confirm the text before it is
  ``ready_to_copy``, and even then it is not "compliant".
"""

from dataclasses import dataclass

from pydantic import ValidationError
from sqlmodel import Session, func, select

from app.domain.compliance.engine import Hit, Layer, Severity
from app.domain.flow import FlowStatus
from app.domain.generation.evaluate import CHECKER_VERSION, evaluate_note
from app.domain.generation.rewrite import build_rewrite_messages, problems_from_hits
from app.domain.generation.schema import GeneratedNote
from app.models import (
    ClaimEvidence,
    ComplianceCheck,
    GenerationVersion,
    Product,
    Task,
    VersionOrigin,
)
from app.models.common import get_datetime_utc
from app.ports.knowledge import KnowledgeSearch
from app.ports.llm import LlmClient, LlmRequest
from app.ports.voice import VoiceProfileProvider
from app.services import compliance as compliance_service
from app.services import evidence as evidence_service
from app.services.audit import record_audit
from app.services.llm_structured import generate_structured

MAX_REWRITE_ROUNDS = 2
REWRITE_ATTEMPTS = 2


@dataclass(frozen=True)
class PipelineDeps:
    llm: LlmClient
    search: KnowledgeSearch
    voices: VoiceProfileProvider


@dataclass(frozen=True)
class CheckOutcome:
    status: FlowStatus
    constraints_passed: bool
    open_evidence: int  # claims without a supported source that nobody has confirmed
    open_blocks: int  # block-level risk hints nobody has dealt with


def constraint_terms(
    *, task: Task, product: Product, deps: PipelineDeps
) -> tuple[list[str], list[str]]:
    """Required and forbidden words for a task: the operator's required terms; the brand voice's
    forbidden words and the product's restricted claims."""
    voice = deps.voices.get_active(brand_id=task.brand_id)
    forbidden = [*(voice.forbidden_words if voice else ()), *product.restricted_claims]
    return list(task.required_terms), forbidden


def _note_of(version: GenerationVersion) -> GeneratedNote:
    return GeneratedNote(
        title_candidates=version.title_candidates,
        body=version.body,
        hashtags=version.hashtags,
        cover_candidates=version.cover_candidates,
    )


def _mirror(
    session: Session, task: Task, version: GenerationVersion, stage: str | None
) -> None:
    """Show the latest version's state on the task."""
    if task.latest_version_id in (None, version.id):
        task.flow_status = version.flow_status
        task.progress_stage = stage
        task.updated_at = get_datetime_utc()
        session.add(task)


def run_checks(
    *, session: Session, task: Task, version: GenerationVersion, deps: PipelineDeps
) -> CheckOutcome:
    """Check the version's current text and set its state. Commits at each stage so a model outage
    part-way leaves the version in ``checking`` (a recheck can finish the job)."""
    product = session.get(Product, task.product_id)
    assert product is not None
    required, forbidden = constraint_terms(task=task, product=product, deps=deps)
    try:
        report = evaluate_note(
            _note_of(version), required_words=required, forbidden_words=forbidden
        )
    except ValidationError:
        report = {
            "passed": False,
            "checker_version": CHECKER_VERSION,
            "titles": [],
            "note": {
                "counts": {},
                "issues": [
                    {
                        "field": "note",
                        "code": "missing_field",
                        "message": "标题或正文为空",
                        "details": {},
                    }
                ],
            },
        }
    version.constraint_checks = report
    version.checker_version = CHECKER_VERSION
    if not report["passed"]:
        version.flow_status = FlowStatus.CONSTRAINT_FAILED.value
        session.add(version)
        _mirror(session, task, version, None)
        session.commit()
        return CheckOutcome(FlowStatus.CONSTRAINT_FAILED, False, 0, 0)

    version.flow_status = FlowStatus.CHECKING.value
    session.add(version)
    _mirror(session, task, version, "evidence")
    session.commit()

    evidence_rows = evidence_service.check_evidence(
        session=session,
        version=version,
        task_id=task.id,
        deps=evidence_service.EvidenceDeps(llm=deps.llm, search=deps.search),
    )
    _mirror(session, task, version, "compliance")
    session.commit()

    checks = compliance_service.check_compliance(
        session=session, version=version, llm=deps.llm
    )
    return _finish(session, task, version, evidence_rows, checks)


def _finish(
    session: Session,
    task: Task,
    version: GenerationVersion,
    evidence_rows: list[ClaimEvidence],
    checks: list[ComplianceCheck],
) -> CheckOutcome:
    open_evidence = sum(
        1
        for e in evidence_rows
        if e.status != "system_supported" and e.human_confirmed is not True
    )
    open_blocks = compliance_service.summarize(checks).unresolved_block
    status = (
        FlowStatus.NEEDS_HUMAN_REVIEW
        if open_evidence or open_blocks
        else FlowStatus.CHECKS_COMPLETED
    )
    version.flow_status = status.value
    session.add(version)
    _mirror(session, task, version, "done")
    session.commit()
    return CheckOutcome(status, True, open_evidence, open_blocks)


def _open_block_hits(checks: list[ComplianceCheck]) -> list[Hit]:
    return [
        Hit(
            rule_id=str(c.rule_id) if c.rule_id else None,
            rule_version=c.rule_version,
            layer=Layer(c.layer),
            rule_type=c.rule_type,
            severity=Severity(c.severity),
            field=c.field,
            start=c.span_start,
            end=c.span_end,
            matched_text=c.matched_text,
            suggestion=c.suggestion,
            source_name=c.source_name,
            source_clause=c.source_clause,
            region_scope=c.region_scope,
        )
        for c in checks
        if not c.resolved and c.severity == Severity.BLOCK.value
    ]


def new_version_from(
    *,
    session: Session,
    task: Task,
    parent: GenerationVersion,
    note: GeneratedNote,
    origin: VersionOrigin,
    model: str | None,
) -> GenerationVersion:
    """A new version with the given text. It copies the parent's retrieval snapshot and versions of
    template, prompt and voice; nothing of the parent changes."""
    next_no = (
        session.exec(
            select(func.coalesce(func.max(GenerationVersion.version_no), 0)).where(
                GenerationVersion.task_id == task.id
            )
        ).one()
        + 1
    )
    version = GenerationVersion(
        task_id=task.id,
        brand_id=task.brand_id,
        version_no=next_no,
        parent_version_id=parent.id,
        origin=origin.value,
        flow_status=FlowStatus.CHECKING.value,
        title_candidates=note.title_candidates,
        body=note.body,
        hashtags=note.hashtags,
        cover_candidates=note.cover_candidates,
        retrieved_sources=parent.retrieved_sources,
        template_version=parent.template_version,
        prompt_version=parent.prompt_version,
        voice_version=parent.voice_version,
        checker_version=CHECKER_VERSION,
        model=model or parent.model,
    )
    session.add(version)
    session.flush()
    task.latest_version_id = version.id
    return version


def rewrite_version(
    *,
    session: Session,
    task: Task,
    version: GenerationVersion,
    problems: list[str],
    llm: LlmClient,
    instruction: str = "",
) -> GenerationVersion:
    """Ask the model to fix the listed problems and store the result as a new ``rewritten`` version."""
    result = generate_structured(
        llm,
        LlmRequest(
            messages=build_rewrite_messages(_note_of(version), problems, instruction),
            temperature=0.5,
            purpose="rewrite",
        ),
        GeneratedNote,
        max_attempts=REWRITE_ATTEMPTS,
    )
    rewritten = new_version_from(
        session=session,
        task=task,
        parent=version,
        note=result.value,
        origin=VersionOrigin.REWRITTEN,
        model=result.responses[-1].model,
    )
    session.commit()
    return rewritten


def run_pipeline(
    *, session: Session, task: Task, version: GenerationVersion, deps: PipelineDeps
) -> tuple[GenerationVersion, CheckOutcome]:
    """Check the version; while block-level risk hints remain, rewrite and check again, at most
    ``MAX_REWRITE_ROUNDS`` times. Returns the last version and its outcome."""
    outcome = run_checks(session=session, task=task, version=version, deps=deps)
    for _ in range(MAX_REWRITE_ROUNDS):
        if (
            outcome.status is not FlowStatus.NEEDS_HUMAN_REVIEW
            or not outcome.open_blocks
        ):
            break
        _mirror(session, task, version, "rewriting")
        session.commit()
        problems = problems_from_hits(
            _open_block_hits(
                compliance_service.list_checks(session=session, version_id=version.id)
            )
        )
        version = rewrite_version(
            session=session, task=task, version=version, problems=problems, llm=deps.llm
        )
        record_audit(
            session,
            action="version.auto_rewrite",
            entity_type="generation_version",
            actor_id=None,
            brand_id=task.brand_id,
            entity_id=version.id,
            detail={
                "parent": str(version.parent_version_id),
                "problems": len(problems),
            },
        )
        session.commit()
        outcome = run_checks(session=session, task=task, version=version, deps=deps)
    return version, outcome
