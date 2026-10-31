"""Evaluation datasets, runs, human ratings and agreement.

Datasets are versioned and never edited. A run records every version it used (dataset, prompt, checker,
rubric) and reports each metric with its definition; there is no combined score.
"""

import hashlib
import json
import uuid
from collections import defaultdict
from typing import Any

from sqlmodel import Session, col, func, or_, select

from app.domain.evaluation.agreement import DimensionAgreement, dimension_agreement
from app.domain.evaluation.metrics import VERDICT_TO_STATUS, normalize_brand_term
from app.domain.evaluation.rubric import DIMENSIONS, RUBRIC_VERSION, validate_scores
from app.domain.evidence.judge import PROMPT_VERSION as EVIDENCE_PROMPT_VERSION
from app.domain.generation.evaluate import CHECKER_VERSION
from app.domain.generation.prompt import PROMPT_VERSION as GENERATION_PROMPT_VERSION
from app.models import (
    BrandMember,
    CaseIn,
    DatasetCreate,
    EvalCase,
    EvalDataset,
    EvalKind,
    EvalRating,
    EvalResult,
    EvalRun,
    MemberRole,
    RatingCreate,
    RunCreate,
    User,
)
from app.services.audit import record_audit
from app.services.errors import InvalidInputError, NotFoundError

ALLOWED_BASELINES = {
    EvalKind.COMPLIANCE.value: {"lexicon_only"},
    EvalKind.FACTCHECK.value: {"no_verification"},
    EvalKind.GENERATION.value: set(),
    EvalKind.BRAND_LEAK.value: set(),
}
NEEDS_MODEL = {
    EvalKind.FACTCHECK.value,
    EvalKind.GENERATION.value,
    EvalKind.BRAND_LEAK.value,
}


# ---- access ----
def admin_brand_ids(session: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    rows = session.exec(
        select(BrandMember.brand_id).where(
            BrandMember.user_id == user_id, BrandMember.role == MemberRole.ADMIN.value
        )
    ).all()
    return set(rows)


def can_see(dataset: EvalDataset, user: User, admin_brands: set[uuid.UUID]) -> bool:
    """Brand datasets are for that brand's admins; global ones for platform administrators and for
    admins of any brand."""
    if dataset.brand_id is None:
        return user.is_superuser or bool(admin_brands)
    return dataset.brand_id in admin_brands


def can_create_for(session: Session, user: User, brand_id: uuid.UUID | None) -> bool:
    """Global datasets are created by platform administrators, a brand's by that brand's admins."""
    if brand_id is None:
        return user.is_superuser
    return brand_id in admin_brand_ids(session, user.id)


def get_visible_dataset(
    *, session: Session, dataset_id: uuid.UUID, user: User
) -> EvalDataset:
    """Missing and not-allowed look the same (404)."""
    dataset = session.get(EvalDataset, dataset_id)
    if dataset is None or not can_see(dataset, user, admin_brand_ids(session, user.id)):
        raise NotFoundError("Dataset not found")
    return dataset


# ---- case validation ----
def _text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _strings(value: Any, *, minimum: int = 0, maximum: int = 50) -> bool:
    return (
        isinstance(value, list)
        and minimum <= len(value) <= maximum
        and all(_text(v) for v in value)
    )


def validate_case(kind: str, case: CaseIn) -> str | None:
    """Why a case does not fit its dataset kind, or ``None``."""
    data, expected = case.input, case.expected
    if kind == EvalKind.BRAND_LEAK.value:
        problem = validate_case(EvalKind.GENERATION.value, case)
        if problem:
            return problem
        distractor = data.get("distractor_brand")
        if not isinstance(distractor, str) or not 1 <= len(distractor.strip()) <= 100:
            return "input.distractor_brand 需要 1 到 100 字"
        terms = expected.get("foreign_terms")
        if not isinstance(terms, list) or not _strings(terms, minimum=1, maximum=50):
            return "expected.foreign_terms 需要 1 到 50 个非空词"
        if any(len(term.strip()) > 100 for term in terms):
            return "expected.foreign_terms 每个词最多 100 字"
        normalized = [normalize_brand_term(term.strip()) for term in terms]
        if len(set(normalized)) != len(normalized):
            return "expected.foreign_terms 不允许规范化后的重复词"
    elif kind == EvalKind.COMPLIANCE.value:
        if not _text(data.get("text")):
            return "input.text 不能为空"
        if not _strings(expected.get("hit_words", []), maximum=50):
            return "expected.hit_words 必须是文字列表"
    elif kind == EvalKind.FACTCHECK.value:
        if not _text(data.get("claim")):
            return "input.claim 不能为空"
        if not _strings(data.get("sources"), minimum=1, maximum=5):
            return "input.sources 需要 1 到 5 段资料"
        if expected.get("verdict") not in VERDICT_TO_STATUS:
            return "expected.verdict 必须是 supported、insufficient 或 conflict"
    elif kind == EvalKind.GENERATION.value:
        if not _text(data.get("product_name")) or not _text(data.get("scene_name")):
            return "input.product_name 和 input.scene_name 不能为空"
        for key in ("required_terms", "facts"):
            if not _strings(data.get(key, []), maximum=20):
                return f"input.{key} 必须是文字列表"
        if not _strings(expected.get("forbidden_words", []), maximum=50):
            return "expected.forbidden_words 必须是文字列表"
    return None


def _content_hash(kind: str, cases: list[CaseIn]) -> str:
    canonical = json.dumps(
        {"kind": kind, "cases": [c.model_dump() for c in cases]},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---- datasets ----
def create_dataset(*, session: Session, data: DatasetCreate, user: User) -> EvalDataset:
    if data.kind is EvalKind.BRAND_LEAK and data.brand_id is None:
        raise InvalidInputError(
            "brand_leak 必须属于一个品牌",
            {
                "errors": [
                    {
                        "loc": ["body", "brand_id"],
                        "msg": "brand_id is required",
                        "type": "value_error",
                    }
                ]
            },
        )
    for index, case in enumerate(data.cases):
        problem = validate_case(data.kind.value, case)
        if problem:
            raise InvalidInputError(
                f"第 {index + 1} 条样本：{problem}",
                {
                    "errors": [
                        {
                            "loc": [
                                "body",
                                "cases",
                                str(index),
                                *problem.split()[0].split("."),
                            ],
                            "msg": problem,
                            "type": "value_error",
                        }
                    ]
                }
                if data.kind is EvalKind.BRAND_LEAK
                else None,
            )
    group_id, version = uuid.uuid4(), 1
    if data.previous_version_id is not None:
        previous = get_visible_dataset(
            session=session, dataset_id=data.previous_version_id, user=user
        )
        if previous.kind != data.kind.value or previous.brand_id != data.brand_id:
            raise InvalidInputError("新版本的类型和所属品牌必须与上一版本相同")
        latest = session.exec(
            select(func.max(EvalDataset.version)).where(
                EvalDataset.group_id == previous.group_id
            )
        ).one()
        group_id, version = previous.group_id, (latest or 0) + 1

    dataset = EvalDataset(
        group_id=group_id,
        version=version,
        name=data.name,
        kind=data.kind.value,
        brand_id=data.brand_id,
        content_hash=_content_hash(data.kind.value, data.cases),
        case_count=len(data.cases),
        created_by=user.id,
    )
    session.add(dataset)
    session.flush()
    session.add_all(
        EvalCase(
            dataset_id=dataset.id,
            case_index=i,
            input=c.input,
            expected=c.expected,
            annotators=c.annotators,
        )
        for i, c in enumerate(data.cases)
    )
    record_audit(
        session,
        action="eval_dataset.create",
        entity_type="eval_dataset",
        actor_id=user.id,
        brand_id=data.brand_id,
        entity_id=dataset.id,
        detail={"kind": dataset.kind, "version": version, "cases": len(data.cases)},
    )
    session.commit()
    session.refresh(dataset)
    return dataset


def list_datasets(
    *, session: Session, user: User, kind: str | None
) -> list[EvalDataset]:
    admins = admin_brand_ids(session, user.id)
    scope = [col(EvalDataset.brand_id).in_(admins)] if admins else []
    if user.is_superuser or admins:
        scope.append(col(EvalDataset.brand_id).is_(None))
    if not scope:
        return []
    where: list[Any] = [or_(*scope)]
    if kind:
        where.append(EvalDataset.kind == kind)
    return list(
        session.exec(
            select(EvalDataset)
            .where(*where)
            .order_by(col(EvalDataset.created_at).desc(), col(EvalDataset.id))
        ).all()
    )


def list_cases(
    *, session: Session, dataset: EvalDataset, page: int, page_size: int
) -> tuple[list[EvalCase], int]:
    rows = session.exec(
        select(EvalCase)
        .where(EvalCase.dataset_id == dataset.id)
        .order_by(col(EvalCase.case_index))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), dataset.case_count


# ---- models ----
def validate_run_request(
    *, dataset: EvalDataset, data: RunCreate, known_models: set[str]
) -> None:
    if dataset.kind != EvalKind.BRAND_LEAK.value and len(data.model_ids) > 5:
        raise InvalidInputError("这类评测最多选择五个模型")
    unknown = sorted(set(data.model_ids) - known_models)
    if unknown:
        raise InvalidInputError(f"未知的模型：{', '.join(unknown)}")
    if dataset.kind in NEEDS_MODEL and not data.model_ids:
        raise InvalidInputError("这类评测至少需要选择一个模型")
    bad = sorted(set(data.baselines) - ALLOWED_BASELINES.get(dataset.kind, set()))
    if bad:
        raise InvalidInputError(f"这类评测不支持基线：{', '.join(bad)}")


# ---- runs ----
def create_run(
    *,
    session: Session,
    dataset: EvalDataset,
    data: RunCreate,
    user: User,
    idempotency_key: str | None,
) -> tuple[EvalRun, bool]:
    """Returns the run and whether it is new. A repeated ``Idempotency-Key`` returns the first run."""
    if idempotency_key:
        existing = session.exec(
            select(EvalRun).where(
                EvalRun.dataset_id == dataset.id,
                EvalRun.created_by == user.id,
                EvalRun.idempotency_key == idempotency_key,
            )
        ).first()
        if existing is not None:
            return existing, False
    prompt = data.prompt_version or {
        EvalKind.GENERATION.value: GENERATION_PROMPT_VERSION,
        EvalKind.FACTCHECK.value: EVIDENCE_PROMPT_VERSION,
        EvalKind.BRAND_LEAK.value: "brand-leak-v1",
    }.get(dataset.kind)
    run = EvalRun(
        dataset_id=dataset.id,
        model_ids=list(dict.fromkeys(data.model_ids)),
        baselines=list(dict.fromkeys(data.baselines)),
        prompt_version=prompt,
        checker_version="brand-leak-v1"
        if dataset.kind == EvalKind.BRAND_LEAK.value
        else CHECKER_VERSION,
        rubric_version=None
        if dataset.kind == EvalKind.BRAND_LEAK.value
        else RUBRIC_VERSION,
        idempotency_key=idempotency_key,
        sample_count=dataset.case_count,
        created_by=user.id,
    )
    session.add(run)
    record_audit(
        session,
        action="eval_run.create",
        entity_type="eval_run",
        actor_id=user.id,
        brand_id=dataset.brand_id,
        entity_id=run.id,
        detail={
            "kind": dataset.kind,
            "models": run.model_ids,
            "baselines": run.baselines,
        },
    )
    session.commit()
    session.refresh(run)
    return run, True


def get_run(
    *, session: Session, run_id: uuid.UUID, user: User
) -> tuple[EvalRun, EvalDataset]:
    run = session.get(EvalRun, run_id)
    if run is None:
        raise NotFoundError("Run not found")
    dataset = get_visible_dataset(session=session, dataset_id=run.dataset_id, user=user)
    return run, dataset


def list_runs(
    *,
    session: Session,
    user: User,
    dataset_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> tuple[list[tuple[EvalRun, EvalDataset]], int]:
    visible = {d.id: d for d in list_datasets(session=session, user=user, kind=None)}
    if dataset_id is not None:
        if dataset_id not in visible:
            raise NotFoundError("Dataset not found")
        wanted = [dataset_id]
    else:
        wanted = list(visible)
    if not wanted:
        return [], 0
    where = col(EvalRun.dataset_id).in_(wanted)
    total = session.exec(select(func.count()).select_from(EvalRun).where(where)).one()
    runs = session.exec(
        select(EvalRun)
        .where(where)
        .order_by(col(EvalRun.created_at).desc(), col(EvalRun.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [(r, visible[r.dataset_id]) for r in runs], total


def failures_of(session: Session, run: EvalRun) -> list[dict[str, Any]]:
    rows = session.exec(
        select(EvalResult, EvalCase)
        .join(EvalCase, col(EvalResult.case_id) == col(EvalCase.id))
        .where(EvalResult.run_id == run.id, col(EvalResult.error).is_not(None))
        .order_by(col(EvalCase.case_index), col(EvalResult.system))
    ).all()
    return [
        {
            "result_id": str(r.id),
            "case_index": c.case_index,
            "system": r.system,
            "error": r.error,
        }
        for r, c in rows
    ]


def list_results(
    *, session: Session, run: EvalRun, page: int, page_size: int
) -> tuple[list[tuple[EvalResult, EvalCase]], int]:
    total = session.exec(
        select(func.count()).select_from(EvalResult).where(EvalResult.run_id == run.id)
    ).one()
    rows = session.exec(
        select(EvalResult, EvalCase)
        .join(EvalCase, col(EvalResult.case_id) == col(EvalCase.id))
        .where(EvalResult.run_id == run.id)
        .order_by(col(EvalCase.case_index), col(EvalResult.system))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


# ---- ratings and agreement ----
def rate_result(
    *, session: Session, run: EvalRun, data: RatingCreate, user: User
) -> EvalRating:
    """Store (or replace) this rater's scores for one result of the run."""
    if data.rubric_version != RUBRIC_VERSION:
        raise InvalidInputError(f"评分表版本必须是 {RUBRIC_VERSION}")
    problem = validate_scores(data.scores)
    if problem:
        raise InvalidInputError(problem)
    result = session.get(EvalResult, data.result_id)
    if result is None or result.run_id != run.id:
        raise NotFoundError("Result not found in this run")
    rating = session.exec(
        select(EvalRating).where(
            EvalRating.result_id == result.id, EvalRating.rater_id == user.id
        )
    ).first()
    if rating is None:
        rating = EvalRating(
            run_id=run.id,
            result_id=result.id,
            rater_id=user.id,
            scores=dict(data.scores),
            rubric_version=data.rubric_version,
            note=data.note,
        )
    else:
        rating.scores = dict(data.scores)
        rating.rubric_version = data.rubric_version
        rating.note = data.note
    session.add(rating)
    record_audit(
        session,
        action="eval_rating.save",
        entity_type="eval_result",
        actor_id=user.id,
        entity_id=result.id,
        detail={"run": str(run.id)},
    )
    session.commit()
    session.refresh(rating)
    return rating


def agreement_for(
    *, session: Session, run: EvalRun
) -> tuple[int, int, list[DimensionAgreement]]:
    ratings = session.exec(select(EvalRating).where(EvalRating.run_id == run.id)).all()
    raters = {r.rater_id for r in ratings}
    rated = {r.result_id for r in ratings}
    dimensions: list[DimensionAgreement] = []
    for dim in DIMENSIONS:
        by_rater: dict[str, dict[str, int]] = defaultdict(dict)
        for rating in ratings:
            if dim.key in rating.scores:
                by_rater[str(rating.rater_id)][str(rating.result_id)] = int(
                    rating.scores[dim.key]
                )
        dimensions.append(dimension_agreement(dim.key, by_rater))
    return len(raters), len(rated), dimensions
