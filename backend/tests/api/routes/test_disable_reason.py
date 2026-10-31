import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.routes.knowledge import get_embedder
from app.core.config import settings
from app.fakes.embedding import FakeEmbeddingProvider
from app.main import app
from app.models import AuditLog, KbReview
from tests.api.routes.test_brands import _create_brand
from tests.api.routes.test_compliance import RULE
from tests.api.routes.test_knowledge import _ingest

API = settings.API_V1_STR


@pytest.fixture
def embedder() -> Generator[FakeEmbeddingProvider]:
    fake = FakeEmbeddingProvider()
    app.dependency_overrides[get_embedder] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_embedder, None)


def _audit(db: Session, action: str, entity_id: str) -> AuditLog:
    db.expire_all()
    return db.exec(
        select(AuditLog).where(
            AuditLog.action == action, AuditLog.entity_id == uuid.UUID(entity_id)
        )
    ).one()


def test_rule_switch_off_reason_goes_to_audit_only(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    rule = client.post(
        f"{API}/brands/{brand['id']}/compliance-rules",
        headers=h,
        json={**RULE, "pattern": f"禁词{uuid.uuid4().hex[:6]}"},
    ).json()
    url = f"{API}/compliance-rules/{rule['id']}"
    off = client.patch(
        url, headers=h, json={"enabled": False, "reason": "客户要求停用"}
    )
    assert off.status_code == 200 and off.json()["enabled"] is False
    assert "reason" not in off.json()
    detail = _audit(db, "compliance_rule.update", rule["id"]).detail
    assert detail["reason"] == "客户要求停用" and "reason" not in detail["fields"]
    too_long = client.patch(
        url, headers=h, json={"enabled": False, "reason": "x" * 501}
    )
    assert too_long.status_code == 422
    assert client.patch(url, headers=h, json={"enabled": False}).status_code == 200


@pytest.mark.usefixtures("embedder")
def test_document_deactivate_reason_is_optional_and_recorded(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    first = _ingest(client, h, brand["id"], f"短语{uuid.uuid4().hex[:8]}")
    second = _ingest(client, h, brand["id"], f"短语{uuid.uuid4().hex[:8]}")
    bad = client.post(
        f"{API}/knowledge-documents/{first['id']}/deactivate",
        headers=h,
        json={"reason": "x" * 501},
    )
    assert bad.status_code == 422
    ok = client.post(
        f"{API}/knowledge-documents/{first['id']}/deactivate",
        headers=h,
        json={"reason": "资料已过期"},
    )
    assert ok.status_code == 200 and ok.json()["status"] == "deactivated"
    db.expire_all()
    review = db.exec(
        select(KbReview).where(
            KbReview.document_id == uuid.UUID(first["id"]),
            KbReview.action == "deactivate",
        )
    ).one()
    assert review.reason == "资料已过期"
    assert (
        _audit(db, "knowledge.deactivate", first["id"]).detail["reason"] == "资料已过期"
    )
    plain = client.post(
        f"{API}/knowledge-documents/{second['id']}/deactivate", headers=h
    )
    assert plain.status_code == 200
    assert "reason" not in _audit(db, "knowledge.deactivate", second["id"]).detail
