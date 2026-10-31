"""Run one generation for a task: retrieve, prompt, call the model, check the constraints, store a version.

The flow (contract section 5): ``queued -> generating -> checking | constraint_failed``. This module
covers up to the constraint check; evidence and compliance checks are added by later steps, so a version
whose constraints pass is left in ``checking`` with the next stage named in the task's progress.

Bounded work (TC-018): at most ``MAX_ROUNDS`` rounds, each round at most ``STRUCTURED_ATTEMPTS`` model
calls, so a misbehaving model cannot cause endless calls.
"""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, func, select

from app.domain.constraints import ConstraintConfig
from app.domain.flow import FlowStatus
from app.domain.generation.evaluate import (
    CHECKER_VERSION,
    evaluate_note,
    problems_from_report,
)
from app.domain.generation.prompt import (
    PROMPT_VERSION,
    PromptInput,
    SourceSnippet,
    build_messages,
)
from app.domain.generation.schema import GeneratedNote
from app.models import (
    Brand,
    GenerationVersion,
    Product,
    ScenarioTemplate,
    Task,
    VersionOrigin,
)
from app.models.common import get_datetime_utc
from app.ports.knowledge import KnowledgeChunk, KnowledgeSearch
from app.ports.llm import LlmClient, LlmRequest
from app.ports.voice import VoiceProfile, VoiceProfileProvider
from app.services.audit import record_audit
from app.services.errors import InvalidStateError, ModelUnavailableError, NotFoundError
from app.services.llm_structured import LlmOutputError, generate_structured

MAX_ROUNDS = 3  # one first try and two corrections after a failed constraint check
STRUCTURED_ATTEMPTS = 2
SOURCE_LIMIT = 8
STARTABLE = (FlowStatus.QUEUED.value, FlowStatus.CONSTRAINT_FAILED.value)


@dataclass(frozen=True)
class GenerationDeps:
    llm: LlmClient
    search: KnowledgeSearch
    voices: VoiceProfileProvider


def begin_generation(
    *, session: Session, task: Task, idempotency_key: str | None
) -> bool:
    """Mark the task as generating. Returns False when the same request was already accepted.

    Raises ``InvalidStateError`` unless the task is queued or its last run failed the constraints.
    """
    if idempotency_key and task.idempotency_key == idempotency_key:
        return False
    if task.flow_status not in STARTABLE:
        raise InvalidStateError(
            f"A task in state {task.flow_status} cannot be generated"
        )
    task.flow_status = FlowStatus.GENERATING.value
    task.progress_stage = "retrieving"
    task.last_error = None
    task.idempotency_key = idempotency_key or task.idempotency_key
    task.updated_at = get_datetime_utc()
    session.add(task)
    session.commit()
    return True


def _snippets(chunks: list[KnowledgeChunk]) -> tuple[SourceSnippet, ...]:
    return tuple(
        SourceSnippet(ref=f"S{i}", level=c.source_level, text=c.content[:500])
        for i, c in enumerate(chunks, start=1)
    )


def _sources_snapshot(chunks: list[KnowledgeChunk]) -> list[dict[str, Any]]:
    return [
        {
            "ref": f"S{i}",
            "source_level": c.source_level,
            "document_id": str(c.document_id) if c.document_id else None,
            "document_version": c.document_version,
            "chunk_id": str(c.chunk_id),
            "snapshot_id": str(c.snapshot_id) if c.snapshot_id else None,
            "content_hash": c.content_hash,
            "score": round(c.score, 4),
            "excerpt": c.content[:200],
        }
        for i, c in enumerate(chunks, start=1)
    ]


def build_prompt_input(
    *,
    task: Task,
    product: Product,
    brand: Brand,
    scenario: ScenarioTemplate,
    voice: VoiceProfile | None,
    chunks: list[KnowledgeChunk],
) -> PromptInput:
    verified = tuple(
        p["text"] for p in product.selling_points if p.get("source_document_id")
    )
    unverified = tuple(
        p["text"] for p in product.selling_points if not p.get("source_document_id")
    )
    return PromptInput(
        brand_name=brand.name,
        product_name=product.name,
        product_line=product.product_line,
        category=product.category,
        notes=product.notes,
        verified_points=verified,
        unverified_points=unverified,
        restricted_claims=tuple(product.restricted_claims),
        scene_name=scenario.name,
        scene_structure=scenario.structure,
        style=task.style,
        brief=task.brief,
        required_terms=tuple(task.required_terms),
        persona=voice.persona if voice else None,
        tone_keywords=voice.tone_keywords if voice else (),
        preferred_words=voice.preferred_words if voice else (),
        forbidden_words=voice.forbidden_words if voice else (),
        sources=_snippets(chunks),
    )


def _fail(session: Session, task: Task, *, status: str, error: str) -> None:
    session.rollback()
    task = session.get(Task, task.id) or task
    task.flow_status = status
    task.progress_stage = None
    task.last_error = error
    task.updated_at = get_datetime_utc()
    session.add(task)
    record_audit(
        session,
        action="task.generate_failed",
        entity_type="task",
        actor_id=None,
        brand_id=task.brand_id,
        entity_id=task.id,
        detail={"error": error},
    )
    session.commit()


def run_generation(
    *, session: Session, task_id: uuid.UUID, deps: GenerationDeps
) -> GenerationVersion:
    """Generate and store the next version of a task that ``begin_generation`` already started."""
    task = session.get(Task, task_id)
    if task is None:
        raise NotFoundError("Task not found")
    product = session.get(Product, task.product_id)
    scenario = session.get(ScenarioTemplate, task.scenario_id)
    brand = session.get(Brand, task.brand_id)
    if product is None or scenario is None or brand is None:
        raise NotFoundError("The task refers to something that no longer exists")
    previous_status = (
        FlowStatus.CONSTRAINT_FAILED.value
        if task.latest_version_id
        else FlowStatus.QUEUED.value
    )

    try:
        voice = deps.voices.get_active(brand_id=task.brand_id)
        chunks = deps.search.search(
            brand_id=task.brand_id,
            query=" ".join(filter(None, [product.name, task.brief])),
            product_id=product.id,
            task_id=task.id,
            limit=SOURCE_LIMIT,
        )
        prompt_input = build_prompt_input(
            task=task,
            product=product,
            brand=brand,
            scenario=scenario,
            voice=voice,
            chunks=chunks,
        )
        forbidden = [
            *(voice.forbidden_words if voice else ()),
            *product.restricted_claims,
        ]
        required = list(task.required_terms)

        task.progress_stage = "generating"
        session.add(task)
        session.commit()

        note: GeneratedNote | None = None
        report: dict[str, Any] = {}
        problems: list[str] = []
        model_name = ""
        for _ in range(MAX_ROUNDS):
            result = generate_structured(
                deps.llm,
                LlmRequest(
                    messages=build_messages(prompt_input, problems),
                    temperature=0.7,
                    purpose="generate",
                ),
                GeneratedNote,
                max_attempts=STRUCTURED_ATTEMPTS,
            )
            note = result.value
            model_name = result.responses[-1].model
            report = evaluate_note(
                note,
                required_words=required,
                forbidden_words=forbidden,
                config=ConstraintConfig(),
            )
            if report["passed"]:
                break
            problems = problems_from_report(report)
    except ModelUnavailableError:
        _fail(session, task, status=previous_status, error="model_unavailable")
        raise
    except LlmOutputError:
        _fail(
            session,
            task,
            status=FlowStatus.CONSTRAINT_FAILED.value,
            error="invalid_model_output",
        )
        raise

    assert note is not None
    passed = bool(report["passed"])
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
        origin=VersionOrigin.GENERATED.value,
        flow_status=(
            FlowStatus.CHECKING if passed else FlowStatus.CONSTRAINT_FAILED
        ).value,
        title_candidates=note.title_candidates,
        body=note.body,
        hashtags=note.hashtags,
        cover_candidates=note.cover_candidates,
        constraint_checks=report,
        retrieved_sources=_sources_snapshot(chunks),
        template_version=scenario.template_version,
        prompt_version=PROMPT_VERSION,
        voice_version=voice.version if voice else None,
        checker_version=CHECKER_VERSION,
        model=model_name,
    )
    session.add(version)
    session.flush()
    task.flow_status = version.flow_status
    # The constraint check is done; evidence and compliance are the next stages.
    task.progress_stage = "evidence" if passed else None
    task.latest_version_id = version.id
    task.last_error = None
    task.updated_at = get_datetime_utc()
    session.add(task)
    record_audit(
        session,
        action="task.generate",
        entity_type="generation_version",
        actor_id=None,
        brand_id=task.brand_id,
        entity_id=version.id,
        detail={"version_no": next_no, "constraints_passed": passed},
    )
    session.commit()
    session.refresh(version)
    return version
