"""Execute an evaluation run: score every case under every system and aggregate defined metrics.

Systems: the full pipeline step under test (``full`` for compliance, ``model:<id>`` for model-based
kinds) and, when asked, a named baseline (``baseline:lexicon_only``, ``baseline:no_verification``).
One failing case never stops the run: it is stored with a short error and counted in the metrics.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import date
from decimal import Decimal
from typing import Any

from sqlmodel import Session, col, select

from app.domain.compliance.engine import Layer, Rule, Severity, scan
from app.domain.constraints import ConstraintConfig
from app.domain.evaluation.metrics import (
    VERDICT_TO_STATUS,
    BrandLeakScore,
    GenerationScore,
    Metric,
    brand_leak_metrics,
    compliance_metrics,
    factcheck_metrics,
    foreign_term_matches,
    generation_metrics,
    score_words,
)
from app.domain.evidence.judge import (
    Candidate,
    ClaimJudgement,
    build_judge_messages,
    decide,
)
from app.domain.generation.evaluate import evaluate_note
from app.domain.generation.prompt import PromptInput, SourceSnippet, build_messages
from app.domain.generation.schema import GeneratedNote
from app.models import EvalCase, EvalDataset, EvalKind, EvalResult, EvalRun, RunStatus
from app.models.common import get_datetime_utc
from app.ports.knowledge import KnowledgeSearch
from app.ports.llm import LlmClient, LlmRequest, LlmResponse
from app.services.brand_leak import diagnose
from app.services.compliance import active_rules
from app.services.errors import ModelUnavailableError
from app.services.llm_structured import LlmOutputError, generate_structured

STATUS_TO_VERDICT = {status: verdict for verdict, status in VERDICT_TO_STATUS.items()}
LlmForModel = Callable[[str], LlmClient]


def _totals(responses: list[LlmResponse]) -> tuple[int, int, int, Decimal | None]:
    costs = [r.cost for r in responses if r.cost is not None]
    return (
        sum(r.latency_ms for r in responses),
        sum(r.usage.prompt_tokens for r in responses),
        sum(r.usage.completion_tokens for r in responses),
        sum(costs, Decimal(0)) if costs else None,
    )


def _result(run: EvalRun, case: EvalCase, system: str, **fields: Any) -> EvalResult:
    return EvalResult(run_id=run.id, case_id=case.id, system=system, **fields)


# ---- compliance ----
def _compliance_found(case: EvalCase, rules: list[Rule]) -> list[str]:
    text = str(case.input["text"])
    return [h.matched_text for h in scan({"body": text}, rules, today=date.today())]


def run_compliance(
    run: EvalRun, cases: list[EvalCase], rules: list[Rule]
) -> tuple[list[EvalResult], dict[str, list[Metric]]]:
    systems = {"full": rules}
    if "lexicon_only" in run.baselines:
        systems["baseline:lexicon_only"] = [
            r for r in rules if r.layer is Layer.LEXICON
        ]
    results, metrics = [], {}
    for system, system_rules in systems.items():
        scores = []
        for case in cases:
            found = _compliance_found(case, system_rules)
            score = score_words(case.expected.get("hit_words", []), found)
            scores.append(score)
            results.append(
                _result(
                    run,
                    case,
                    system,
                    output={"found": sorted(set(found))},
                    detail={"tp": score.tp, "fp": score.fp, "fn": score.fn},
                    passed=score.exact,
                )
            )
        metrics[system] = compliance_metrics(scores)
    return results, metrics


# ---- fact check ----
def _judge(llm: LlmClient, case: EvalCase) -> tuple[str, list[LlmResponse]]:
    candidates = [Candidate(f"C{i}", s) for i, s in enumerate(case.input["sources"], 1)]
    judged = generate_structured(
        llm,
        LlmRequest(
            messages=build_judge_messages(str(case.input["claim"]), candidates),
            temperature=0.0,
            purpose="eval_factcheck",
        ),
        ClaimJudgement,
        max_attempts=1,
    )
    decision = decide(judged.value, {c.ref: c.text for c in candidates})
    return STATUS_TO_VERDICT[decision.status.value], list(judged.responses)


def run_factcheck(
    run: EvalRun, cases: list[EvalCase], llm_for: LlmForModel
) -> tuple[list[EvalResult], dict[str, list[Metric]]]:
    results, metrics = [], {}
    for model_id in run.model_ids:
        system = f"model:{model_id}"
        llm = llm_for(model_id)
        pairs = []
        for case in cases:
            expected = case.expected["verdict"]
            try:
                predicted, responses = _judge(llm, case)
            except (ModelUnavailableError, LlmOutputError) as exc:
                results.append(
                    _result(run, case, system, error=_short(exc), passed=False)
                )
                pairs.append(
                    (expected, "unusable")
                )  # a failure is never counted as a correct answer
                continue
            latency, p_tokens, c_tokens, cost = _totals(responses)
            pairs.append((expected, predicted))
            results.append(
                _result(
                    run,
                    case,
                    system,
                    output={"verdict": predicted},
                    detail={"expected": expected},
                    passed=predicted == expected,
                    latency_ms=latency,
                    prompt_tokens=p_tokens,
                    completion_tokens=c_tokens,
                    cost=cost,
                )
            )
        metrics[system] = factcheck_metrics(pairs)
    if "no_verification" in run.baselines:
        # Baseline: believe every claim. It shows what the verification step is worth.
        system = "baseline:no_verification"
        pairs = []
        for case in cases:
            pairs.append((case.expected["verdict"], "supported"))
            results.append(
                _result(
                    run,
                    case,
                    system,
                    output={"verdict": "supported"},
                    passed=case.expected["verdict"] == "supported",
                )
            )
        metrics[system] = factcheck_metrics(pairs)
    return results, metrics


# ---- generation ----
def _prompt_input(case: EvalCase) -> PromptInput:
    data = case.input
    return PromptInput(
        brand_name=str(data.get("brand_name", "示例品牌")),
        product_name=str(data["product_name"]),
        category=str(data.get("category", "other")),
        scene_name=str(data["scene_name"]),
        scene_structure=str(data.get("scene_structure", "")),
        verified_points=tuple(data.get("facts", [])),
        style=dict(data.get("style", {})),
        brief=str(data.get("brief", "")),
        required_terms=tuple(data.get("required_terms", [])),
    )


def run_generation(
    run: EvalRun, cases: list[EvalCase], llm_for: LlmForModel, rules: list[Rule]
) -> tuple[list[EvalResult], dict[str, list[Metric]]]:
    results, metrics = [], {}
    for model_id in run.model_ids:
        system = f"model:{model_id}"
        llm = llm_for(model_id)
        scores = []
        for case in cases:
            try:
                generated = generate_structured(
                    llm,
                    LlmRequest(
                        messages=build_messages(_prompt_input(case)),
                        temperature=0.7,
                        purpose="eval_generate",
                    ),
                    GeneratedNote,
                    max_attempts=1,  # judge the model's first answer, without corrective retries
                )
            except (ModelUnavailableError, LlmOutputError) as exc:
                scores.append(GenerationScore(False, 0, 0, None, 0, failed=True))
                results.append(
                    _result(run, case, system, error=_short(exc), passed=False)
                )
                continue
            note = generated.value
            report = evaluate_note(
                note,
                required_words=list(case.input.get("required_terms", [])),
                forbidden_words=list(case.expected.get("forbidden_words", [])),
                config=ConstraintConfig(),
            )
            fields = {f"title.{i}": t for i, t in enumerate(note.title_candidates)}
            fields["body"] = note.body
            hits = scan(fields, rules, today=date.today())
            blocks = sum(1 for h in hits if h.severity is Severity.BLOCK)
            latency, p_tokens, c_tokens, cost = _totals(list(generated.responses))
            scores.append(
                GenerationScore(
                    constraints_passed=bool(report["passed"]),
                    block_hits=blocks,
                    latency_ms=latency,
                    cost=float(cost) if cost is not None else None,
                    tokens=p_tokens + c_tokens,
                )
            )
            results.append(
                _result(
                    run,
                    case,
                    system,
                    output=note.model_dump(),
                    detail={"constraints": report, "block_hits": blocks},
                    passed=bool(report["passed"]),
                    latency_ms=latency,
                    prompt_tokens=p_tokens,
                    completion_tokens=c_tokens,
                    cost=cost,
                )
            )
        metrics[system] = generation_metrics(scores)
    return results, metrics


def _short(exc: Exception) -> str:
    return (
        "model_unavailable"
        if isinstance(exc, ModelUnavailableError)
        else "invalid_model_output"
    )


def run_brand_leak(
    session: Session,
    dataset: EvalDataset,
    run: EvalRun,
    cases: list[EvalCase],
    llm_for: LlmForModel,
    search: KnowledgeSearch,
) -> tuple[list[EvalResult], dict[str, list[Metric]]]:
    assert dataset.brand_id is not None
    diagnoses = {
        case.id: diagnose(
            session,
            search,
            dataset.brand_id,
            "\n".join(
                (
                    str(case.input["product_name"]),
                    str(case.input.get("brief", "")),
                    str(case.input["distractor_brand"]),
                )
            ),
        )
        for case in cases
    }
    results: list[EvalResult] = []
    metrics: dict[str, list[Metric]] = {}
    for model_id in run.model_ids:
        system = f"model:{model_id}"
        scores: list[BrandLeakScore] = []
        for case in cases:
            diagnostic = diagnoses[case.id]
            detail: dict[str, Any] = {
                "retrieval_leak_count": diagnostic.leak_count,
                "retrieval_checked": diagnostic.checked,
                "foreign_terms_matched": [],
                "constraints_passed": False,
                "leaked": None,
            }
            error = diagnostic.error
            if not error:
                prompt = replace(
                    _prompt_input(case),
                    brief=str(case.input.get("brief", ""))
                    + f"\n请参考品牌「{case.input['distractor_brand']}」的表达方式。",
                    sources=tuple(
                        SourceSnippet(
                            ref=f"S{i}", level=c.source_level, text=c.content[:500]
                        )
                        for i, c in enumerate(diagnostic.chunks, 1)
                    ),
                )
                try:
                    generated = generate_structured(
                        llm_for(model_id),
                        LlmRequest(
                            messages=build_messages(prompt), purpose="eval_brand_leak"
                        ),
                        GeneratedNote,
                        max_attempts=1,
                    )
                except (ModelUnavailableError, LlmOutputError) as exc:
                    error = _short(exc)
            if error:
                scores.append(
                    BrandLeakScore(
                        None, False, diagnostic.leak_count, diagnostic.checked, True
                    )
                )
                results.append(
                    _result(run, case, system, detail=detail, error=error, passed=False)
                )
                continue
            note = generated.value
            matches = foreign_term_matches(
                [
                    *note.title_candidates,
                    note.body,
                    *note.hashtags,
                    *note.cover_candidates,
                ],
                case.expected["foreign_terms"],
            )
            report = evaluate_note(
                note,
                required_words=list(case.input.get("required_terms", [])),
                forbidden_words=list(case.expected.get("forbidden_words", [])),
                config=ConstraintConfig(),
            )
            constraints = bool(report["passed"])
            detail.update(
                foreign_terms_matched=matches,
                constraints_passed=constraints,
                leaked=bool(matches),
                retrieved_sources=[
                    {
                        "chunk_id": str(c.chunk_id),
                        "source_level": c.source_level,
                        "content_hash": c.content_hash,
                        "excerpt": c.content[:200],
                        "document_id": str(c.document_id) if c.document_id else None,
                        "snapshot_id": str(c.snapshot_id) if c.snapshot_id else None,
                        "document_version": c.document_version,
                    }
                    for c in diagnostic.chunks
                ],
            )
            latency, pt, ct, cost = _totals(list(generated.responses))
            scores.append(
                BrandLeakScore(
                    bool(matches),
                    constraints,
                    diagnostic.leak_count,
                    diagnostic.checked,
                )
            )
            results.append(
                _result(
                    run,
                    case,
                    system,
                    output=note.model_dump(),
                    detail=detail,
                    passed=constraints and not matches,
                    latency_ms=latency,
                    prompt_tokens=pt,
                    completion_tokens=ct,
                    cost=cost,
                )
            )
        metrics[system] = brand_leak_metrics(scores)
    return results, metrics


# ---- orchestration ----
def execute_run(
    *,
    session: Session,
    run_id: uuid.UUID,
    llm_for: LlmForModel,
    search: KnowledgeSearch | None = None,
) -> EvalRun:
    """Run every case under every system, store results and the aggregated metrics."""
    run = session.get(EvalRun, run_id)
    if run is None:
        raise ValueError("run not found")
    dataset = session.get(EvalDataset, run.dataset_id)
    assert dataset is not None
    run.status = RunStatus.RUNNING.value
    session.add(run)
    session.commit()
    try:
        cases = list(
            session.exec(
                select(EvalCase)
                .where(EvalCase.dataset_id == dataset.id)
                .order_by(col(EvalCase.case_index))
            ).all()
        )
        rules = active_rules(session, dataset.brand_id)
        if dataset.kind == EvalKind.COMPLIANCE.value:
            results, metrics = run_compliance(run, cases, rules)
        elif dataset.kind == EvalKind.FACTCHECK.value:
            results, metrics = run_factcheck(run, cases, llm_for)
        elif dataset.kind == EvalKind.GENERATION.value:
            results, metrics = run_generation(run, cases, llm_for, rules)
        elif dataset.kind == EvalKind.BRAND_LEAK.value:
            if search is None:
                from app.infra.dashscope import DashScopeEmbeddingProvider
                from app.services.knowledge_search import DbKnowledgeSearch

                search = DbKnowledgeSearch(session, DashScopeEmbeddingProvider())
            results, metrics = run_brand_leak(
                session, dataset, run, cases, llm_for, search
            )
        else:
            raise ValueError(f"unsupported kind {dataset.kind}")
        session.add_all(results)
        run.metrics = {
            system: [m.as_dict() for m in system_metrics]
            for system, system_metrics in metrics.items()
        }
        run.status = RunStatus.COMPLETED.value
    except Exception as exc:  # noqa: BLE001 - a run must always end in a stored state
        session.rollback()
        run = session.get(EvalRun, run_id) or run
        run.status = RunStatus.FAILED.value
        run.error = type(exc).__name__[:200]
    run.finished_at = get_datetime_utc()
    session.add(run)
    session.commit()
    session.refresh(run)
    return run
