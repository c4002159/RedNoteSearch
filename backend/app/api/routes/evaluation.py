import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.api.routes.knowledge import EmbedderDep
from app.core.db import engine
from app.domain.evaluation.agreement import METHOD
from app.domain.evaluation.rubric import RUBRIC_VERSION, rubric_payload
from app.infra.openai_compat import deepseek_client
from app.models import (
    AgreementPublic,
    CasePublic,
    CasesPublic,
    DatasetCreate,
    DatasetPublic,
    DatasetsPublic,
    DimensionAgreementPublic,
    EvalDataset,
    EvalKind,
    EvalRun,
    ModelsPublic,
    RatingCreate,
    RatingPublic,
    ResultPublic,
    ResultsPublic,
    RunCreate,
    RunPublic,
    RunsPublic,
    RunVersions,
)
from app.ports.embedding import EmbeddingProvider
from app.ports.llm import LlmClient
from app.services import evaluation as eval_service
from app.services import model_catalog
from app.services.evaluation_runner import LlmForModel, execute_run
from app.services.knowledge_search import DbKnowledgeSearch
from app.services.llm_log import DbLlmCallRecorder

logger = logging.getLogger(__name__)
router = APIRouter(tags=["evaluation"])


def get_eval_llm_factory() -> LlmForModel:
    """Builds the chat model for one model id. Tests override this with a scripted fake."""

    def build(model_id: str) -> LlmClient:
        return deepseek_client(
            model=model_id,
            price=model_catalog.price_for(model_id),
            recorder=DbLlmCallRecorder(lambda: Session(engine)),
        )

    return build


EvalLlmDep = Annotated[LlmForModel, Depends(get_eval_llm_factory)]


def _run_public(session: Session, run: EvalRun, dataset: EvalDataset) -> RunPublic:
    return RunPublic(
        id=run.id,
        dataset_id=run.dataset_id,
        kind=dataset.kind,
        status=run.status,
        sample_count=run.sample_count,
        versions=RunVersions(
            dataset_version=dataset.version,
            prompt_version=run.prompt_version,
            checker_version=run.checker_version,
            rubric_version=run.rubric_version,
            models=run.model_ids,
            baselines=run.baselines,
        ),
        metrics=run.metrics,
        failures=eval_service.failures_of(session, run),
        error=run.error,
        created_at=run.created_at,
        finished_at=run.finished_at,
    )


def _execute_in_background(
    run_id: uuid.UUID, llm_for: LlmForModel, embedder: EmbeddingProvider
) -> None:
    with Session(engine) as session:
        try:
            execute_run(
                session=session,
                run_id=run_id,
                llm_for=llm_for,
                search=DbKnowledgeSearch(session, embedder),
            )
        except (
            Exception
        ):  # the run stores its own failure; this only guards the background task
            logger.exception("Evaluation run %s crashed", run_id)


@router.get("/models", response_model=ModelsPublic)
def read_models(_: CurrentUser) -> ModelsPublic:
    """The models that can be called and their configured prices (``null`` when not configured)."""
    return ModelsPublic(items=model_catalog.list_models())


@router.get("/evaluation/rubrics")
def read_rubrics(_: CurrentUser) -> dict[str, object]:
    """The human rating rubric: dimensions, scale and version. Ratings are kept per dimension."""
    return rubric_payload()


@router.post("/evaluation/datasets", response_model=DatasetPublic, status_code=201)
def create_dataset(
    session: SessionDep, current_user: CurrentUser, body: DatasetCreate
) -> DatasetPublic:
    """Create a dataset (or the next version of one). Versions are fixed once created."""
    if not eval_service.can_create_for(session, current_user, body.brand_id):
        raise HTTPException(
            status_code=403,
            detail="Brand admin role required"
            if body.brand_id
            else "Platform administrator required",
        )
    dataset = eval_service.create_dataset(session=session, data=body, user=current_user)
    return DatasetPublic.model_validate(dataset, from_attributes=True)


@router.get("/evaluation/datasets", response_model=DatasetsPublic)
def read_datasets(
    session: SessionDep, current_user: CurrentUser, kind: EvalKind | None = None
) -> DatasetsPublic:
    rows = eval_service.list_datasets(
        session=session, user=current_user, kind=kind.value if kind else None
    )
    return DatasetsPublic(
        items=[DatasetPublic.model_validate(d, from_attributes=True) for d in rows]
    )


@router.get("/evaluation/datasets/{dataset_id}/cases", response_model=CasesPublic)
def read_cases(
    dataset_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> CasesPublic:
    dataset = eval_service.get_visible_dataset(
        session=session, dataset_id=dataset_id, user=current_user
    )
    rows, total = eval_service.list_cases(
        session=session, dataset=dataset, page=page, page_size=page_size
    )
    return CasesPublic(
        items=[CasePublic.model_validate(c, from_attributes=True) for c in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/evaluation/runs", response_model=RunPublic, status_code=202)
def create_run(
    session: SessionDep,
    current_user: CurrentUser,
    background: BackgroundTasks,
    llm_for: EvalLlmDep,
    embedder: EmbedderDep,
    body: RunCreate,
    idempotency_key: Annotated[str | None, Header(max_length=100)] = None,
) -> RunPublic:
    """Start an evaluation run; poll ``GET /evaluation/runs/{id}``. A repeated ``Idempotency-Key``
    returns the first run instead of starting another."""
    dataset = eval_service.get_visible_dataset(
        session=session, dataset_id=body.dataset_id, user=current_user
    )
    eval_service.validate_run_request(
        dataset=dataset, data=body, known_models=model_catalog.known_model_ids()
    )
    run, is_new = eval_service.create_run(
        session=session,
        dataset=dataset,
        data=body,
        user=current_user,
        idempotency_key=idempotency_key,
    )
    if is_new:
        background.add_task(_execute_in_background, run.id, llm_for, embedder)
    session.refresh(run)
    return _run_public(session, run, dataset)


@router.get("/evaluation/runs", response_model=RunsPublic)
def read_runs(
    session: SessionDep,
    current_user: CurrentUser,
    dataset_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> RunsPublic:
    rows, total = eval_service.list_runs(
        session=session,
        user=current_user,
        dataset_id=dataset_id,
        page=page,
        page_size=page_size,
    )
    return RunsPublic(
        items=[_run_public(session, r, d) for r, d in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/evaluation/runs/{run_id}", response_model=RunPublic)
def read_run(
    run_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> RunPublic:
    run, dataset = eval_service.get_run(
        session=session, run_id=run_id, user=current_user
    )
    return _run_public(session, run, dataset)


@router.get("/evaluation/runs/{run_id}/results", response_model=ResultsPublic)
def read_results(
    run_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ResultsPublic:
    run, _ = eval_service.get_run(session=session, run_id=run_id, user=current_user)
    rows, total = eval_service.list_results(
        session=session, run=run, page=page, page_size=page_size
    )
    return ResultsPublic(
        items=[
            ResultPublic(
                id=r.id,
                case_id=r.case_id,
                case_index=c.case_index,
                system=r.system,
                output=r.output,
                detail=r.detail,
                passed=r.passed,
                error=r.error,
                latency_ms=r.latency_ms,
                cost=float(r.cost) if r.cost is not None else None,
            )
            for r, c in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/evaluation/runs/{run_id}/ratings", response_model=RatingPublic, status_code=201
)
def rate(
    run_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
    body: RatingCreate,
) -> RatingPublic:
    """Save the logged-in user's scores for one result. Saving again replaces their earlier scores."""
    run, _ = eval_service.get_run(session=session, run_id=run_id, user=current_user)
    rating = eval_service.rate_result(
        session=session, run=run, data=body, user=current_user
    )
    return RatingPublic(
        id=rating.id,
        run_id=rating.run_id,
        result_id=rating.result_id,
        rater_id=rating.rater_id,
        scores={k: int(v) for k, v in rating.scores.items()},
        rubric_version=rating.rubric_version,
        note=rating.note,
    )


@router.get("/evaluation/runs/{run_id}/agreement", response_model=AgreementPublic)
def read_agreement(
    run_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> AgreementPublic:
    run, _ = eval_service.get_run(session=session, run_id=run_id, user=current_user)
    raters, rated, dims = eval_service.agreement_for(session=session, run=run)
    return AgreementPublic(
        run_id=run.id,
        rubric_version=RUBRIC_VERSION,
        raters=raters,
        rated_results=rated,
        method=METHOD,
        dimensions=[
            DimensionAgreementPublic(
                dimension=d.dimension,
                rater_pairs=d.pairs,
                samples=d.samples,
                exact_agreement=d.exact,
                within_one=d.within_one,
                weighted_kappa=d.weighted_kappa,
            )
            for d in dims
        ],
    )
