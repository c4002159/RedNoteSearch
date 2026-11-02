import json
import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.routes.viral import get_viral_llm_factory
from app.core.db import engine
from app.fakes.llm import FakeLlmClient
from app.main import app
from app.models import AuditLog
from app.models.viral import ViralPattern, ViralSample
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user
from tests.api.routes.test_viral import API, analyze, sample
from tests.domain.test_viral import ANALYSIS


def test_text_revision_link_only_and_reanalysis(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    row = sample(client, h, brand["id"])
    fake = FakeLlmClient([json.dumps(ANALYSIS, ensure_ascii=False)] * 4)
    app.dependency_overrides[get_viral_llm_factory] = lambda: (
        lambda _brand, _model: fake
    )
    try:
        analyze(client, h, row["id"])
        url = f"{API}/viral-samples/{row['id']}"
        assert (
            client.patch(
                url, headers=h, json={"source_url": "https://example.invalid/source"}
            ).json()["structures_stale"]
            is False
        )
        assert len(fake.requests) == 1
        response = client.patch(
            url, headers=h, json={"text": "修改后的自编香氛笔记，描述日常感受。"}
        )
        assert (
            response.status_code == 200 and response.json()["structures_stale"] is True
        )
        assert len(fake.requests) == 1
        assert (
            client.get(f"{API}/brands/{brand['id']}/viral-samples", headers=h).json()[
                "items"
            ][0]["structures_stale"]
            is True
        )
        assert (
            client.patch(url, headers=h, json={"source_url": None}).json()[
                "structures_stale"
            ]
            is True
        )
        analyze(client, h, row["id"])
        assert client.get(url, headers=h).json()["structures_stale"] is False
        db.expire_all()
        stored = db.get(ViralSample, uuid.UUID(row["id"]))
        assert stored is not None and stored.revision == 1
        patterns = db.exec(
            select(ViralPattern).where(ViralPattern.sample_id == stored.id)
        ).all()
        assert sorted(
            item.sample_revision
            for item in patterns
            if item.sample_revision is not None
        ) == [0, 1]
        logs = db.exec(
            select(AuditLog).where(
                AuditLog.action == "viral.sample_update",
                AuditLog.entity_id == stored.id,
            )
        ).all()
        assert len(logs) == 3
        assert all(
            set(log.detail) == {"fields", "text_changed", "revision", "char_count"}
            for log in logs
        )
        for body in (
            {},
            {"text": None},
            {"text": " "},
            {"text": "字" * 5001},
            {"source_url": "ftp://example.invalid"},
        ):
            assert client.patch(url, headers=h, json=body).status_code == 422
    finally:
        app.dependency_overrides.pop(get_viral_llm_factory, None)


def test_patch_resource_authorization(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    row = sample(client, h, brand["id"])
    url = f"{API}/viral-samples/{row['id']}"
    body = {"text": "更新样本"}
    assert client.patch(url, json=body).status_code == 401
    editor, editor_h = _make_user(client, db)
    _add_member(client, h, brand["id"], editor, "editor")
    assert client.patch(url, headers=editor_h, json=body).status_code == 403
    outsider, outsider_h = _make_user(client, db)
    other = _create_brand(client, h)
    _add_member(client, h, other["id"], outsider, "admin")
    assert client.patch(url, headers=outsider_h, json=body).status_code == 404
    assert (
        client.patch(
            f"{API}/viral-samples/{uuid.uuid4()}", headers=h, json=body
        ).status_code
        == 404
    )


def test_edit_while_analyzing_keeps_captured_revision(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    row = sample(client, h, brand["id"])

    def respond(_request):  # type: ignore[no-untyped-def]
        with Session(engine) as concurrent:
            current = concurrent.get(ViralSample, uuid.UUID(row["id"]))
            assert current is not None
            current.text = "分析期间更新的样本"
            current.revision += 1
            concurrent.add(current)
            concurrent.commit()
        return json.dumps(ANALYSIS, ensure_ascii=False)

    fake = FakeLlmClient(responder=respond)
    app.dependency_overrides[get_viral_llm_factory] = lambda: (
        lambda _brand, _model: fake
    )
    try:
        analyze(client, h, row["id"])
        assert (
            client.get(f"{API}/viral-samples/{row['id']}", headers=h).json()[
                "structures_stale"
            ]
            is True
        )
    finally:
        app.dependency_overrides.pop(get_viral_llm_factory, None)
