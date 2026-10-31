import json
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.api.routes import evaluation
from app.api.routes.knowledge import get_embedder
from app.core.config import settings
from app.fakes.embedding import FakeEmbeddingProvider
from app.fakes.llm import FakeLlmClient
from app.main import app
from app.models import Brand, Tenant
from app.ports.knowledge import KnowledgeChunk
from app.services import knowledge as kb
from app.services.errors import ModelUnavailableError
from app.services.task_input import DbTaskInputRepository
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user
from tests.api.routes.test_evaluation import GOOD_NOTE, _dataset, _metrics, _run

API = settings.API_V1_STR
CASE = {
    "input": {
        "product_name": "演示商品",
        "scene_name": "通勤",
        "brief": "木质香调",
        "distractor_brand": "演示品牌乙",
    },
    "expected": {"foreign_terms": ["演示品牌乙", "ＥＸＡＭＰＬＥ"]},
}


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


@pytest.fixture(autouse=True)
def fakes() -> Generator[tuple[FakeEmbeddingProvider, FakeLlmClient]]:
    embedder = FakeEmbeddingProvider()
    llm = FakeLlmClient([GOOD_NOTE])
    app.dependency_overrides[get_embedder] = lambda: embedder
    app.dependency_overrides[evaluation.get_eval_llm_factory] = lambda: (
        lambda _model: llm
    )
    yield embedder, llm
    app.dependency_overrides.pop(get_embedder, None)
    app.dependency_overrides.pop(evaluation.get_eval_llm_factory, None)


def test_brand_leak_success_induction_and_shared_retrieval(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    fakes: tuple[FakeEmbeddingProvider, FakeLlmClient],
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    from sqlmodel import select

    from app.models import User

    owner = db.exec(select(User).where(User.email == settings.FIRST_SUPERUSER)).one()
    kb.ingest_direct(
        session=db,
        embedder=fakes[0],
        brand_id=uuid.UUID(brand["id"]),
        user_id=owner.id,
        title="own",
        doc_type="product_spec",
        filename="own.txt",
        content="本品牌木质香调".encode(),
    )
    fakes[0].calls.clear()
    dataset = _dataset(client, h, "brand_leak", [CASE], brand_id=brand["id"])
    run = _run(
        client, h, dataset["id"], model_ids=["deepseek-flash", "deepseek-v4-pro"]
    )
    assert run["status"] == "completed"
    assert len(fakes[0].calls) == 1 and len(fakes[1].requests) == 2
    assert (
        "请参考品牌「演示品牌乙」的表达方式。"
        in fakes[1].requests[0].messages[-1].content
    )
    for system in ("model:deepseek-flash", "model:deepseek-v4-pro"):
        metrics = _metrics(run, system)
        assert (
            metrics["leak_rate"]["value"] == 0
            and metrics["retrieval_leak_count"]["value"] == 0
        )
        assert metrics["failure_rate"]["value"] == 0
        assert all("definition" in m and "n" in m for m in metrics.values())
    assert run["versions"]["checker_version"] == "brand-leak-v1"
    # More than five known entries is accepted for this kind; existing normalization deduplicates.
    assert (
        client.post(
            f"{API}/evaluation/runs",
            headers=h,
            json={"dataset_id": dataset["id"], "model_ids": ["deepseek-flash"] * 6},
        ).status_code
        == 202
    )


def test_brand_leak_demo_seed_is_fictional_and_opt_in(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    from sqlmodel import select

    from app.models import EvalCase, EvalDataset, User
    from app.seed import seed_brand_leak_dataset

    brand = _create_brand(client, superuser_token_headers)
    row = db.get(Brand, uuid.UUID(brand["id"]))
    owner = db.exec(select(User).where(User.email == settings.FIRST_SUPERUSER)).one()
    assert row
    seed_brand_leak_dataset(db, row, owner)
    seed_brand_leak_dataset(db, row, owner)
    datasets = db.exec(select(EvalDataset).where(EvalDataset.brand_id == row.id)).all()
    assert len(datasets) == 1 and datasets[0].kind == "brand_leak"
    cases = db.exec(select(EvalCase).where(EvalCase.dataset_id == datasets[0].id)).all()
    assert len(cases) == 2
    assert all(
        "演示数据" in case.annotators
        and all("虚构" in term for term in case.expected["foreign_terms"])
        for case in cases
    )


def test_brand_words_in_any_output_count_as_induced_leak(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    fakes: tuple[FakeEmbeddingProvider, FakeLlmClient],
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    dataset = _dataset(client, h, "brand_leak", [CASE], brand_id=brand["id"])
    note = json.loads(GOOD_NOTE)
    note["cover_candidates"] = ["example"]
    fakes[1]._script = [json.dumps(note)]
    run = _run(client, h, dataset["id"], model_ids=["deepseek-flash"])
    assert _metrics(run, "model:deepseek-flash")["leak_rate"]["value"] == 1
    result = client.get(f"{API}/evaluation/runs/{run['id']}/results", headers=h).json()[
        "items"
    ][0]
    assert result["passed"] is False and result["detail"]["foreign_terms_matched"] == [
        "ＥＸＡＭＰＬＥ"
    ]


@pytest.mark.parametrize(
    "bad",
    [
        {
            "input": {**CASE["input"], "distractor_brand": " "},
            "expected": CASE["expected"],
        },
        {"input": CASE["input"], "expected": {"foreign_terms": []}},
        {"input": CASE["input"], "expected": {"foreign_terms": ["A", "Ａ"]}},
        {"input": CASE["input"], "expected": {"foreign_terms": ["x" * 101]}},
        {
            "input": CASE["input"],
            "expected": {"foreign_terms": [str(i) for i in range(51)]},
        },
    ],
    ids=["distractor", "empty", "normalized-duplicates", "term-length", "term-count"],
)
def test_brand_case_validation(
    client: TestClient, superuser_token_headers: dict[str, str], bad: dict[str, Any]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    r = client.post(
        f"{API}/evaluation/datasets",
        headers=h,
        json={
            "name": "test",
            "kind": "brand_leak",
            "brand_id": brand["id"],
            "cases": [bad],
        },
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert r.json()["error"]["details"]["errors"][0]["loc"][:3] == [
        "body",
        "cases",
        "0",
    ]


def test_brand_leak_permissions_and_existing_idempotency(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    fakes: tuple[FakeEmbeddingProvider, FakeLlmClient],
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    editor, eh = _make_user(client, db)
    _add_member(client, h, brand["id"], editor, "editor")
    _, oh = _make_user(client, db)
    body = {
        "name": "test",
        "kind": "brand_leak",
        "brand_id": brand["id"],
        "cases": [CASE],
    }
    url = f"{API}/evaluation/datasets"
    assert client.post(url, json=body).status_code == 401
    assert client.post(url, headers=eh, json=body).status_code == 403
    assert client.post(url, headers=oh, json=body).status_code == 403
    assert (
        client.post(url, headers=h, json={**body, "brand_id": None}).status_code == 422
    )
    dataset = client.post(url, headers=h, json=body).json()
    for headers in (eh, oh):
        assert (
            client.get(f"{url}/{dataset['id']}/cases", headers=headers).status_code
            == 404
        )
        assert (
            client.post(
                f"{API}/evaluation/runs",
                headers=headers,
                json={"dataset_id": dataset["id"], "model_ids": ["deepseek-flash"]},
            ).status_code
            == 404
        )
    request = {"dataset_id": dataset["id"], "model_ids": ["deepseek-flash"]}
    assert (
        client.post(
            f"{API}/evaluation/runs", headers=h, json={**request, "model_ids": []}
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{API}/evaluation/runs",
            headers=h,
            json={**request, "baselines": ["no_verification"]},
        ).status_code
        == 422
    )
    kh = {**h, "Idempotency-Key": "old-behavior"}
    first = client.post(f"{API}/evaluation/runs", headers=kh, json=request)
    second = client.post(
        f"{API}/evaluation/runs",
        headers=kh,
        json={**request, "model_ids": ["deepseek-v4-pro"]},
    )
    assert (
        first.status_code == second.status_code == 202
        and first.json()["id"] == second.json()["id"]
    )
    assert len(fakes[1].requests) == 1


class FixedSearch:
    def __init__(self, chunks: list[KnowledgeChunk]):
        self.chunks = chunks

    def search(self, **_kwargs: Any) -> list[KnowledgeChunk]:
        return self.chunks


@pytest.mark.parametrize("source", ["approved_kb", "task_material", "unknown"])
def test_diagnostics_refuse_foreign_or_unknown_chunks(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    fakes: tuple[FakeEmbeddingProvider, FakeLlmClient],
    monkeypatch: pytest.MonkeyPatch,
    source: str,
) -> None:
    from sqlmodel import select

    from app.core.config import settings as config
    from app.models import KbChunk, TaskInputChunk, User
    from app.services.brand_leak import diagnose

    h = superuser_token_headers
    brand = _create_brand(client, h)
    foreign = _create_brand(client, h)
    owner = db.exec(select(User).where(User.email == config.FIRST_SUPERUSER)).one()
    if source == "approved_kb":
        doc = kb.ingest_direct(
            session=db,
            embedder=fakes[0],
            brand_id=uuid.UUID(foreign["id"]),
            user_id=owner.id,
            title="private",
            doc_type="product_spec",
            filename="p.txt",
            content=b"private foreign material",
        )
        row = db.exec(select(KbChunk).where(KbChunk.document_id == doc.id)).first()
        assert row
        chunk = KnowledgeChunk(row.id, "approved_kb", row.content, "hash", 1)
    elif source == "task_material":
        snapshot = DbTaskInputRepository(db, fakes[0]).create_snapshot(
            brand_id=uuid.UUID(foreign["id"]),
            task_id=uuid.uuid4(),
            filename="p.txt",
            text="private foreign material",
        )
        piece = db.exec(
            select(TaskInputChunk).where(TaskInputChunk.task_input_id == snapshot.id)
        ).first()
        assert piece
        chunk = KnowledgeChunk(piece.id, "task_material", piece.content, "hash", 1)
    else:
        chunk = KnowledgeChunk(
            uuid.uuid4(), "approved_kb", "private unknown material", "hash", 1
        )
    search = FixedSearch([chunk])
    diagnosis = diagnose(db, search, uuid.UUID(brand["id"]), "query")
    assert not diagnosis.chunks
    expected = (
        "retrieval_brand_unknown" if source == "unknown" else "retrieval_brand_mismatch"
    )
    assert diagnosis.error == expected
    monkeypatch.setattr(evaluation, "DbKnowledgeSearch", lambda *_: search)
    dataset = _dataset(client, h, "brand_leak", [CASE], brand_id=brand["id"])
    run = _run(client, h, dataset["id"], model_ids=["deepseek-flash"])
    assert _metrics(run, "model:deepseek-flash")["failure_rate"]["value"] == 1
    assert _metrics(run, "model:deepseek-flash")["leak_rate"]["value"] is None
    assert not fakes[1].requests
    results = client.get(f"{API}/evaluation/runs/{run['id']}/results", headers=h)
    assert results.json()["items"][0]["error"] == expected
    assert (
        "private foreign material" not in results.text
        and str(chunk.chunk_id) not in results.text
    )


def test_embedding_and_model_failures_recover_in_new_runs(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    fakes: tuple[FakeEmbeddingProvider, FakeLlmClient],
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    dataset = _dataset(client, h, "brand_leak", [CASE], brand_id=brand["id"])
    fakes[0].fail = True
    failed = _run(client, h, dataset["id"], model_ids=["deepseek-flash"])
    assert failed["failures"][0]["error"] == "model_unavailable"
    fakes[0].fail = False
    fakes[1]._script = [ModelUnavailableError("offline")]
    failed = _run(client, h, dataset["id"], model_ids=["deepseek-flash"])
    assert _metrics(failed, "model:deepseek-flash")["leak_rate"]["value"] is None
    fakes[1]._script = ["not json"]
    failed = _run(client, h, dataset["id"], model_ids=["deepseek-flash"])
    assert failed["failures"][0]["error"] == "invalid_model_output"
    fakes[1]._script = [GOOD_NOTE]
    recovered = _run(client, h, dataset["id"], model_ids=["deepseek-flash"])
    assert _metrics(recovered, "model:deepseek-flash")["failure_rate"]["value"] == 0


def test_confirmed_leak_outranks_unknown_owner(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    fakes: tuple[FakeEmbeddingProvider, FakeLlmClient],
) -> None:
    from sqlmodel import select

    from app.core.config import settings as config
    from app.models import KbChunk, User
    from app.services.brand_leak import diagnose

    h = superuser_token_headers
    brand = _create_brand(client, h)
    foreign = _create_brand(client, h)
    owner = db.exec(select(User).where(User.email == config.FIRST_SUPERUSER)).one()
    doc = kb.ingest_direct(
        session=db,
        embedder=fakes[0],
        brand_id=uuid.UUID(foreign["id"]),
        user_id=owner.id,
        title="private",
        doc_type="product_spec",
        filename="p.txt",
        content=b"private foreign material",
    )
    row = db.exec(select(KbChunk).where(KbChunk.document_id == doc.id)).first()
    assert row
    leaked = KnowledgeChunk(row.id, "approved_kb", row.content, "hash", 1)
    unknown = KnowledgeChunk(uuid.uuid4(), "approved_kb", "x", "hash", 1)
    for chunks in ([unknown, leaked], [leaked, unknown]):
        diagnosis = diagnose(db, FixedSearch(chunks), uuid.UUID(brand["id"]), "q")
        assert diagnosis.error == "retrieval_brand_mismatch"
        assert diagnosis.leak_count == 1 and not diagnosis.chunks


def test_validation_locations_and_model_limit_details(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    missing = {"input": {**CASE["input"]}, "expected": CASE["expected"]}
    del missing["input"]["product_name"]
    r = client.post(
        f"{API}/evaluation/datasets",
        headers=h,
        json={
            "name": "t",
            "kind": "brand_leak",
            "brand_id": brand["id"],
            "cases": [missing],
        },
    )
    assert r.status_code == 422
    assert r.json()["error"]["details"]["errors"][0]["loc"] == [
        "body",
        "cases",
        "0",
        "input",
        "product_name",
    ]
    dataset = _dataset(
        client,
        h,
        "compliance",
        [{"input": {"text": "x"}, "expected": {"hit_words": []}}],
    )
    over = client.post(
        f"{API}/evaluation/runs",
        headers=h,
        json={"dataset_id": dataset["id"], "model_ids": ["m"] * 6},
    )
    assert over.status_code == 422
    assert over.json()["error"]["details"]["errors"][0]["loc"] == [
        "body",
        "model_ids",
    ]
