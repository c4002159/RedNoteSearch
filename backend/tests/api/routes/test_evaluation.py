"""Evaluation: versioned datasets, runs with defined metrics, human ratings and agreement.

Needs the database. Models are scripted fakes; nothing calls a real model.
"""

import json
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.api.routes.evaluation import get_eval_llm_factory
from app.core.config import settings
from app.fakes.llm import FakeLlmClient
from app.main import app
from app.models import Brand, EvalRun, RunStatus, Tenant
from app.ports.llm import LlmRequest
from app.services.compliance import ensure_sample_rules
from app.services.errors import ModelUnavailableError
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR
GOOD_NOTE = json.dumps(
    {
        "title_candidates": ["通勤路上的清爽"],
        "body": "早上出门前喷一下，木质香调很柔和。",
        "hashtags": ["日常"],
        "cover_candidates": [],
    },
    ensure_ascii=False,
)
LONG_TITLE_NOTE = json.dumps(
    {"title_candidates": ["字" * 21], "body": "木质香调", "hashtags": ["日常"]},
    ensure_ascii=False,
)
SCORES = {"structure": 4, "tone": 3, "specificity": 5, "faithfulness": 4}


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_sample_rules(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


@pytest.fixture
def llm() -> Generator[FakeLlmClient]:
    fake = FakeLlmClient(responder=lambda _request: GOOD_NOTE)
    app.dependency_overrides[get_eval_llm_factory] = lambda: lambda _model: fake
    yield fake
    app.dependency_overrides.pop(get_eval_llm_factory, None)


def _dataset(
    client: TestClient,
    headers: dict[str, str],
    kind: str,
    cases: list[dict[str, Any]],
    **extra: Any,
) -> dict[str, Any]:
    r = client.post(
        f"{API}/evaluation/datasets",
        headers=headers,
        json={"name": f"{kind} 样本", "kind": kind, "cases": cases, **extra},
    )
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def _run(
    client: TestClient, headers: dict[str, str], dataset_id: str, **body: Any
) -> dict[str, Any]:
    r = client.post(
        f"{API}/evaluation/runs",
        headers=headers,
        json={"dataset_id": dataset_id, **body},
    )
    assert r.status_code == 202, r.text
    return client.get(f"{API}/evaluation/runs/{r.json()['id']}", headers=headers).json()  # type: ignore[no-any-return]


def _metrics(run: dict[str, Any], system: str) -> dict[str, Any]:
    return {m["name"]: m for m in run["metrics"][system]}


COMPLIANCE_CASES = [
    {"input": {"text": "这是最好的香水"}, "expected": {"hit_words": ["最好"]}},
    {
        "input": {"text": "它有美白功效"},
        "expected": {"hit_words": ["美白"]},
    },  # only the efficacy layer knows
    {"input": {"text": "味道清爽自然"}, "expected": {"hit_words": []}},
]


def test_models_and_rubric_endpoints(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    h = superuser_token_headers
    models = client.get(f"{API}/models", headers=h).json()["items"]
    assert [m["id"] for m in models] == ["deepseek-flash", "deepseek-v4-pro"]
    assert all(m["enabled"] == bool(settings.DEEPSEEK_API_KEY) for m in models)
    monkeypatch.setattr(settings, "DEEPSEEK_PRICE_IN_PER_1K", 0.002)
    monkeypatch.setattr(settings, "DEEPSEEK_PRICE_OUT_PER_1K", 0.008)
    monkeypatch.setattr(settings, "LLM_PRICE_VERSION", "2026-11")
    priced = client.get(f"{API}/models", headers=h).json()["items"][0]
    assert (
        priced["price_in_per_1k"],
        priced["price_out_per_1k"],
        priced["price_version"],
    ) == (0.002, 0.008, "2026-11")
    assert client.get(f"{API}/models").status_code == 401

    rubric = client.get(f"{API}/evaluation/rubrics", headers=h).json()
    assert rubric["rubric_version"] == "rubric-v1" and len(rubric["dimensions"]) == 4
    assert "不合并成一个总分" in rubric["note"]
    assert client.get(f"{API}/evaluation/rubrics").status_code == 401


def test_price_for_converts_per_thousand_to_per_million(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services.model_catalog import price_for

    assert (
        price_for("deepseek-flash") is None
        or settings.DEEPSEEK_PRICE_IN_PER_1K is not None
    )
    monkeypatch.setattr(settings, "DEEPSEEK_PRICE_IN_PER_1K", 0.002)
    monkeypatch.setattr(settings, "DEEPSEEK_PRICE_OUT_PER_1K", 0.008)
    monkeypatch.setattr(settings, "LLM_PRICE_VERSION", "v1")
    price = price_for("deepseek-flash")
    assert price is not None and (
        str(price.input_per_million),
        str(price.output_per_million),
    ) == ("2.000", "8.000")
    assert price.version == "v1" and price_for("unknown-model") is None
    monkeypatch.setattr(settings, "LLM_PRICE_VERSION", None)
    assert (
        price_for("deepseek-flash") is None
    )  # a price without a version is not trusted


def test_dataset_permissions_validation_and_versions(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    editor, editor_headers = _make_user(client, db)
    _add_member(client, h, brand["id"], editor, "editor")
    _, outsider_headers = _make_user(client, db)
    body = {
        "name": "x",
        "kind": "compliance",
        "brand_id": brand["id"],
        "cases": COMPLIANCE_CASES[:1],
    }

    assert (
        client.post(
            f"{API}/evaluation/datasets", headers=editor_headers, json=body
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{API}/evaluation/datasets",
            headers=outsider_headers,
            json={**body, "brand_id": None},
        ).status_code
        == 403
    )
    assert client.post(f"{API}/evaluation/datasets", json=body).status_code == 401

    v1 = client.post(f"{API}/evaluation/datasets", headers=h, json=body).json()
    assert (v1["version"], v1["case_count"], v1["brand_id"]) == (
        1,
        1,
        brand["id"],
    ) and len(v1["content_hash"]) == 64
    v2 = client.post(
        f"{API}/evaluation/datasets",
        headers=h,
        json={**body, "cases": COMPLIANCE_CASES, "previous_version_id": v1["id"]},
    ).json()
    assert (v2["version"], v2["group_id"], v2["case_count"]) == (2, v1["group_id"], 3)
    assert v2["content_hash"] != v1["content_hash"] and v2["id"] != v1["id"]
    cases = client.get(f"{API}/evaluation/datasets/{v1['id']}/cases", headers=h).json()
    assert cases["total"] == 1  # the first version did not change
    assert (
        client.get(
            f"{API}/evaluation/datasets/{v2['id']}/cases?page=2&page_size=2", headers=h
        ).json()["items"][0]["case_index"]
        == 2
    )

    mismatched = client.post(
        f"{API}/evaluation/datasets",
        headers=h,
        json={**body, "kind": "factcheck", "previous_version_id": v1["id"]},
    )
    assert mismatched.status_code == 422
    assert (
        client.post(
            f"{API}/evaluation/datasets",
            headers=h,
            json={**body, "previous_version_id": str(uuid.uuid4())},
        ).status_code
        == 404
    )

    visible = {
        d["id"]
        for d in client.get(f"{API}/evaluation/datasets", headers=h).json()["items"]
    }
    assert {v1["id"], v2["id"]} <= visible
    only = client.get(f"{API}/evaluation/datasets?kind=factcheck", headers=h).json()[
        "items"
    ]
    assert v1["id"] not in {d["id"] for d in only}
    assert (
        client.get(f"{API}/evaluation/datasets", headers=outsider_headers).json()[
            "items"
        ]
        == []
    )
    assert (
        client.get(f"{API}/evaluation/datasets", headers=editor_headers).json()["items"]
        == []
    )  # only admins
    for path in (
        f"/evaluation/datasets/{v1['id']}/cases",
        f"/evaluation/datasets/{uuid.uuid4()}/cases",
    ):
        assert client.get(f"{API}{path}", headers=outsider_headers).status_code == 404
        assert client.get(f"{API}{path}", headers=editor_headers).status_code == 404
    assert (
        client.get(
            f"{API}/evaluation/datasets/{v1['id']}/cases?page_size=101", headers=h
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    ("kind", "case"),
    [
        ("compliance", {"input": {"text": " "}, "expected": {}}),
        ("compliance", {"input": {"text": "x"}, "expected": {"hit_words": "最好"}}),
        (
            "factcheck",
            {
                "input": {"claim": "c", "sources": []},
                "expected": {"verdict": "supported"},
            },
        ),
        (
            "factcheck",
            {
                "input": {"claim": "c", "sources": ["s"]},
                "expected": {"verdict": "maybe"},
            },
        ),
        (
            "factcheck",
            {
                "input": {"claim": "", "sources": ["s"]},
                "expected": {"verdict": "supported"},
            },
        ),
        ("generation", {"input": {"product_name": "晨雾"}, "expected": {}}),
        (
            "generation",
            {
                "input": {"product_name": "a", "scene_name": "b", "facts": "x"},
                "expected": {},
            },
        ),
        ("brand_leak", {"input": {"x": 1}, "expected": {}}),
    ],
)
def test_cases_must_fit_their_dataset_kind(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    kind: str,
    case: dict[str, Any],
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    r = client.post(
        f"{API}/evaluation/datasets",
        headers=superuser_token_headers,
        json={"name": "x", "kind": kind, "brand_id": brand["id"], "cases": [case]},
    )
    assert r.status_code == 422, r.text
    assert (
        client.post(
            f"{API}/evaluation/datasets",
            headers=superuser_token_headers,
            json={"name": "x", "kind": kind, "brand_id": brand["id"], "cases": []},
        ).status_code
        == 422
    )


def test_compliance_run_is_deterministic_and_the_baseline_misses_efficacy_claims(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    dataset = _dataset(client, h, "compliance", COMPLIANCE_CASES, brand_id=brand["id"])
    run = _run(client, h, dataset["id"], baselines=["lexicon_only"])

    assert (
        run["status"] == "completed"
        and run["sample_count"] == 3
        and run["failures"] == []
    )
    assert run["versions"] == {
        "dataset_version": 1,
        "prompt_version": None,
        "checker_version": "constraints-v1",
        "rubric_version": "rubric-v1",
        "models": [],
        "baselines": ["lexicon_only"],
    }
    assert set(run["metrics"]) == {"full", "baseline:lexicon_only"}
    full, base = _metrics(run, "full"), _metrics(run, "baseline:lexicon_only")
    assert full["recall"]["value"] == 1.0 and full["exact_match_rate"]["value"] == 1.0
    assert base["recall"]["value"] == 0.5 and base["exact_match_rate"][
        "value"
    ] == pytest.approx(2 / 3)
    assert base["precision"]["value"] == 1.0
    assert all(
        m["definition"] and m["n"] >= 0 for ms in run["metrics"].values() for m in ms
    )
    assert not any(
        "overall" in name or "score" == name for name in full
    )  # no combined number
    results = client.get(f"{API}/evaluation/runs/{run['id']}/results", headers=h).json()
    assert results["total"] == 6 and {r["system"] for r in results["items"]} == {
        "full",
        "baseline:lexicon_only",
    }
    missed = next(
        r
        for r in results["items"]
        if r["system"] == "baseline:lexicon_only" and r["case_index"] == 1
    )
    assert missed["passed"] is False and missed["detail"] == {"tp": 0, "fp": 0, "fn": 1}

    again = _run(client, h, dataset["id"], baselines=["lexicon_only"])
    assert (
        _metrics(again, "full")["recall"]["value"] == 1.0
    )  # same dataset version, same rules: same result


def test_run_requests_are_validated_and_idempotent(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    dataset = _dataset(
        client, h, "compliance", COMPLIANCE_CASES[:1], brand_id=brand["id"]
    )
    url = f"{API}/evaluation/runs"
    body = {"dataset_id": dataset["id"]}

    assert (
        client.post(url, headers=h, json={**body, "model_ids": ["gpt-9"]}).status_code
        == 422
    )
    assert (
        client.post(
            url, headers=h, json={**body, "baselines": ["no_verification"]}
        ).status_code
        == 422
    )
    assert (
        client.post(
            url, headers=h, json={**body, "baselines": ["nonsense"]}
        ).status_code
        == 422
    )
    assert (
        client.post(url, headers=h, json={**body, "model_ids": ["m"] * 6}).status_code
        == 422
    )
    assert (
        client.post(url, headers=h, json={"dataset_id": str(uuid.uuid4())}).status_code
        == 404
    )
    assert client.post(url, json=body).status_code == 401
    assert (
        client.post(
            url, headers={**h, "Idempotency-Key": "k" * 101}, json=body
        ).status_code
        == 422
    )

    first = client.post(
        url, headers={**h, "Idempotency-Key": "run-1"}, json=body
    ).json()
    second = client.post(
        url, headers={**h, "Idempotency-Key": "run-1"}, json=body
    ).json()
    assert first["id"] == second["id"]
    runs = client.get(f"{url}?dataset_id={dataset['id']}", headers=h).json()
    assert runs["total"] == 1 and runs["items"][0]["id"] == first["id"]
    assert client.get(f"{url}?dataset_id={uuid.uuid4()}", headers=h).status_code == 404
    assert client.get(f"{url}?page_size=101", headers=h).status_code == 422
    other = client.post(url, headers=h, json=body).json()
    assert other["id"] != first["id"]  # no key: always a new run
    assert (
        client.get(f"{url}?dataset_id={dataset['id']}", headers=h).json()["total"] == 2
    )


def test_a_run_that_crashes_ends_as_failed(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    dataset = _dataset(
        client, h, "compliance", COMPLIANCE_CASES[:1], brand_id=brand["id"]
    )

    def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("secret detail")

    monkeypatch.setattr("app.services.evaluation_runner.run_compliance", boom)
    run = _run(client, h, dataset["id"])
    assert (run["status"], run["error"]) == ("failed", "RuntimeError")
    assert "secret" not in json.dumps(run)
    db.expire_all()
    stored = db.get(EvalRun, uuid.UUID(run["id"]))
    assert (
        stored is not None
        and stored.status == RunStatus.FAILED.value
        and stored.finished_at is not None
    )


def _factcheck_answer(request: LlmRequest) -> str | Exception:
    claim = request.messages[1].content
    if "获奖" in claim:
        return json.dumps(
            {
                "verdict": "supported",
                "source_ref": "C1",
                "quote": "编造的原文",
                "rationale": "x",
            },
            ensure_ascii=False,
        )
    if "不可用" in claim:
        return ModelUnavailableError("down")
    if "含有佛手柑" in claim:
        return json.dumps(
            {
                "verdict": "supported",
                "source_ref": "C1",
                "quote": "前调为佛手柑",
                "rationale": "有",
            },
            ensure_ascii=False,
        )
    return json.dumps(
        {"verdict": "insufficient", "rationale": "资料里没有"}, ensure_ascii=False
    )


def test_factcheck_run_measures_the_model_against_a_believe_everything_baseline(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    fake = FakeLlmClient(responder=_factcheck_answer)
    app.dependency_overrides[get_eval_llm_factory] = lambda: lambda _model: fake
    try:
        brand = _create_brand(client, h)
        source = ["前调为佛手柑，香调清新。"]
        cases = [
            {
                "input": {"claim": "含有佛手柑", "sources": source},
                "expected": {"verdict": "supported"},
            },
            {
                "input": {"claim": "获奖无数", "sources": source},
                "expected": {"verdict": "insufficient"},
            },  # forged quote
            {
                "input": {"claim": "产自法国", "sources": source},
                "expected": {"verdict": "insufficient"},
            },
            {
                "input": {"claim": "模型不可用的说法", "sources": source},
                "expected": {"verdict": "supported"},
            },
        ]
        dataset = _dataset(client, h, "factcheck", cases, brand_id=brand["id"])
        assert (
            client.post(
                f"{API}/evaluation/runs", headers=h, json={"dataset_id": dataset["id"]}
            ).status_code
            == 422
        )  # needs a model

        run = _run(
            client,
            h,
            dataset["id"],
            model_ids=["deepseek-flash"],
            baselines=["no_verification"],
        )
        assert (
            run["status"] == "completed"
            and run["versions"]["prompt_version"] == "evidence-v1"
        )
        model, base = (
            _metrics(run, "model:deepseek-flash"),
            _metrics(run, "baseline:no_verification"),
        )
        assert model["accuracy"]["value"] == pytest.approx(
            2 / 4
        )  # supported + insufficient right; forged and failed wrong
        assert (
            model["unsupported_accepted_rate"]["value"] == 0.0
        )  # the forged quote was downgraded, not accepted
        assert (
            base["unsupported_accepted_rate"]["value"] == 1.0
        )  # believing everything accepts every bad claim
        assert base["accuracy"]["value"] == pytest.approx(2 / 4)
        assert run["failures"] == [
            {
                "result_id": run["failures"][0]["result_id"],
                "case_index": 3,
                "system": "model:deepseek-flash",
                "error": "model_unavailable",
            }
        ]
        results = client.get(
            f"{API}/evaluation/runs/{run['id']}/results", headers=h
        ).json()["items"]
        forged = next(
            r
            for r in results
            if r["case_index"] == 1 and r["system"].startswith("model:")
        )
        assert (
            forged["output"] == {"verdict": "conflict"} and forged["passed"] is False
        )  # sent to a person
    finally:
        app.dependency_overrides.pop(get_eval_llm_factory, None)


def test_generation_run_reports_pass_rate_failures_latency_and_cost(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    answers = {"通勤": GOOD_NOTE, "超长": LONG_TITLE_NOTE, "乱码": "not json"}
    fake = FakeLlmClient(
        responder=lambda r: next(
            v for k, v in answers.items() if k in r.messages[1].content
        )
    )
    app.dependency_overrides[get_eval_llm_factory] = lambda: lambda _model: fake
    try:
        brand = _create_brand(client, h)
        base = {"scene_name": "种草", "required_terms": ["木质香调"]}
        cases = [
            {
                "input": {**base, "product_name": "晨雾", "brief": "通勤"},
                "expected": {},
            },
            {
                "input": {**base, "product_name": "晨雾", "brief": "超长"},
                "expected": {},
            },
            {
                "input": {**base, "product_name": "晨雾", "brief": "乱码"},
                "expected": {},
            },
        ]
        dataset = _dataset(client, h, "generation", cases, brand_id=brand["id"])
        run = _run(
            client, h, dataset["id"], model_ids=["deepseek-flash", "deepseek-v4-pro"]
        )
        assert run["status"] == "completed" and set(run["metrics"]) == {
            "model:deepseek-flash",
            "model:deepseek-v4-pro",
        }
        m = _metrics(run, "model:deepseek-flash")
        assert m["constraint_pass_rate"]["value"] == pytest.approx(1 / 3)
        assert m["failure_rate"]["value"] == pytest.approx(1 / 3)
        assert m["avg_latency_ms"]["value"] == 1.0 and m["avg_cost"][
            "value"
        ] == pytest.approx(0.0001)
        assert m["avg_tokens"]["value"] == 15
        assert len(run["failures"]) == 2 and {f["error"] for f in run["failures"]} == {
            "invalid_model_output"
        }
        results = client.get(
            f"{API}/evaluation/runs/{run['id']}/results?page_size=100", headers=h
        ).json()
        first = next(
            r
            for r in results["items"]
            if r["case_index"] == 0 and r["system"].endswith("flash")
        )
        assert (
            first["passed"] is True
            and first["cost"] == pytest.approx(0.0001)
            and first["output"]["body"].startswith("早上")
        )
    finally:
        app.dependency_overrides.pop(get_eval_llm_factory, None)


def test_ratings_and_agreement(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    second_admin, second_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, h, brand["id"], second_admin, "admin")
    dataset = _dataset(client, h, "compliance", COMPLIANCE_CASES, brand_id=brand["id"])
    run = _run(client, h, dataset["id"])
    results = client.get(
        f"{API}/evaluation/runs/{run['id']}/results", headers=h
    ).json()["items"]
    rate = lambda headers, index, **over: client.post(  # noqa: E731
        f"{API}/evaluation/runs/{run['id']}/ratings",
        headers=headers,
        json={
            "result_id": results[index]["id"],
            "scores": SCORES,
            "rubric_version": "rubric-v1",
            **over,
        },
    )

    empty = client.get(f"{API}/evaluation/runs/{run['id']}/agreement", headers=h).json()
    assert (empty["raters"], empty["rated_results"]) == (
        0,
        0,
    ) and "加权 Cohen" in empty["method"]
    assert all(d["weighted_kappa"] is None for d in empty["dimensions"])

    first = rate(h, 0, note="不错")
    assert (
        first.status_code == 201
        and first.json()["scores"] == SCORES
        and first.json()["note"] == "不错"
    )
    assert (
        rate(h, 0, scores={**SCORES, "tone": 5}).json()["scores"]["tone"] == 5
    )  # saving again replaces
    for index, (mine, theirs) in enumerate([(4, 4), (2, 3), (5, 5)]):
        rate(h, index, scores={**SCORES, "structure": mine})
        rate(second_headers, index, scores={**SCORES, "structure": theirs})

    agreement = client.get(
        f"{API}/evaluation/runs/{run['id']}/agreement", headers=h
    ).json()
    assert (
        agreement["raters"],
        agreement["rated_results"],
        agreement["rubric_version"],
    ) == (2, 3, "rubric-v1")
    structure = next(
        d for d in agreement["dimensions"] if d["dimension"] == "structure"
    )
    assert structure["rater_pairs"] == 1 and structure["samples"] == 3
    assert (
        structure["exact_agreement"] == pytest.approx(2 / 3)
        and structure["within_one"] == 1.0
    )
    assert structure["weighted_kappa"] is not None and structure["weighted_kappa"] > 0.8
    assert "overall" not in json.dumps(agreement)  # per dimension only

    assert rate(h, 0, rubric_version="rubric-v0").status_code == 422
    assert rate(h, 0, scores={"structure": 4}).status_code == 422
    assert rate(h, 0, scores={**SCORES, "tone": 9}).status_code == 422
    assert rate(h, 0, result_id=str(uuid.uuid4())).status_code == 404
    other_run = _run(client, h, dataset["id"])
    foreign = client.post(
        f"{API}/evaluation/runs/{other_run['id']}/ratings",
        headers=h,
        json={
            "result_id": results[0]["id"],
            "scores": SCORES,
            "rubric_version": "rubric-v1",
        },
    )
    assert foreign.status_code == 404  # a result of another run
    assert rate(outsider_headers, 0).status_code == 404
    assert (
        client.get(
            f"{API}/evaluation/runs/{run['id']}/agreement", headers=outsider_headers
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"{API}/evaluation/runs/{run['id']}", headers=outsider_headers
        ).status_code
        == 404
    )
    assert (
        client.get(f"{API}/evaluation/runs/{uuid.uuid4()}", headers=h).status_code
        == 404
    )
    assert (
        client.post(f"{API}/evaluation/runs/{run['id']}/ratings", json={}).status_code
        == 401
    )
    unused = select(EvalRun).where(EvalRun.id == uuid.UUID(run["id"]))
    assert db.exec(unused).first() is not None
