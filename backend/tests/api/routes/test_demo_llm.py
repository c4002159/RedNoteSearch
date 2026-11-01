import json
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.api.routes.knowledge import get_embedder
from app.api.routes.tasks import get_llm_factory
from app.core.config import settings
from app.fakes.demo_llm import MODEL_NAME, DemoLlmClient
from app.fakes.embedding import FakeEmbeddingProvider
from app.main import app
from app.models import Brand, ComplianceRule, Tenant
from app.ports.llm import LlmMessage, LlmRequest
from app.services.compliance import ensure_sample_rules
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_frontend_contract import _generated

API = settings.API_V1_STR


def _ask(purpose: str, user: str) -> dict[str, object]:
    reply = DemoLlmClient().complete(
        LlmRequest(messages=(LlmMessage("user", user),), purpose=purpose)
    )
    assert reply.model == MODEL_NAME
    return json.loads(reply.text)


def test_generate_copies_sentences_from_the_sources() -> None:
    prompt = (
        "商品：晨雾淡香水（日常系列），品类 perfume\n"
        "参考资料：\n[C1]（已审核资料）前调为柑橘与佛手柑，香调清新。中调为白茶。\n"
    )
    note = _ask("generate", prompt)
    assert "前调为柑橘与佛手柑，香调清新。" in str(note["body"])
    assert str(note["title_candidates"][0]).startswith("晨雾淡香水")  # type: ignore[index]


def test_generate_without_sources_writes_no_facts() -> None:
    note = _ask(
        "generate",
        "商品：夜色身体乳，品类 skincare\n参考资料：（没有检索到资料，只能写场景和感受）\n",
    )
    assert "演示用假模型" in str(note["body"])
    claims = _ask("claim_extraction", f"标题候选：\n- x\n\n正文：\n{note['body']}")
    assert claims["claims"] == []


def test_judge_supports_only_what_the_sources_say() -> None:
    sources = "资料：\n[C1] 前调为柑橘与佛手柑，香调清新。"
    yes = _ask("evidence_judgement", f"说法：前调为柑橘与佛手柑\n\n{sources}")
    assert yes["verdict"] == "supported" and yes["source_ref"] == "C1"
    no = _ask("evidence_judgement", f"说法：荣获年度大奖\n\n{sources}")
    assert no["verdict"] == "insufficient"


@pytest.fixture
def demo_mode() -> Generator[None]:
    embedder = FakeEmbeddingProvider()
    app.dependency_overrides[get_llm_factory] = lambda: lambda _b, _t: DemoLlmClient()
    app.dependency_overrides[get_embedder] = lambda: embedder
    yield
    app.dependency_overrides.pop(get_llm_factory, None)
    app.dependency_overrides.pop(get_embedder, None)


@pytest.fixture(autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    ensure_sample_rules(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(ComplianceRule).where(ComplianceRule.is_sample.is_(False)))  # type: ignore[attr-defined]
    db.execute(delete(Tenant))
    db.commit()


@pytest.mark.usefixtures("demo_mode")
def test_a_full_generation_runs_with_the_demo_model(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    result = _generated(client, superuser_token_headers)
    versions = client.get(
        f"{API}/tasks/{result['task']}/versions", headers=superuser_token_headers
    ).json()["items"]
    assert versions
    assert all(v["model"] == MODEL_NAME for v in versions)
    assert versions[0]["flow_status"] in {
        "checks_completed",
        "needs_human_review",
        "constraint_failed",
    }


def test_the_mode_switch_selects_the_demo_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import uuid

    monkeypatch.setattr(settings, "LLM_MODE", "demo_fake")
    assert isinstance(get_llm_factory()(uuid.uuid4(), uuid.uuid4()), DemoLlmClient)
    monkeypatch.setattr(settings, "LLM_MODE", "real")
    assert not isinstance(get_llm_factory()(uuid.uuid4(), uuid.uuid4()), DemoLlmClient)
