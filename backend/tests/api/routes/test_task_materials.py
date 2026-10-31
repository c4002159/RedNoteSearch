import hashlib
import io
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, delete, select

from app.api.routes.knowledge import get_embedder
from app.core.config import settings
from app.core.db import engine
from app.fakes.embedding import FakeEmbeddingProvider
from app.main import app
from app.models import AuditLog, Brand, Task, TaskInput, TaskInputChunk, Tenant
from app.services import generation, task_materials
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user
from tests.api.routes.test_tasks import _product, _scenario_id, _task_body

API = settings.API_V1_STR


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(Tenant))
    db.commit()


@pytest.fixture(autouse=True)
def embedder() -> Generator[FakeEmbeddingProvider]:
    fake = FakeEmbeddingProvider()
    app.dependency_overrides[get_embedder] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_embedder, None)


def setup_task(
    client: TestClient, headers: dict[str, str], **extra: Any
) -> tuple[str, str]:
    brand = _create_brand(client, headers)
    product = _product(client, headers, brand["id"])
    response = client.post(
        f"{API}/tasks",
        headers=headers,
        json=_task_body(
            brand["id"], product["id"], _scenario_id(client, headers), **extra
        ),
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"]), str(brand["id"])


def test_upload_metadata_snapshots_and_pagination(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    headers = superuser_token_headers
    task_id, _ = setup_task(
        client, headers, task_materials=[{"filename": "paste.txt", "text": "粘贴资料"}]
    )
    url = f"{API}/tasks/{task_id}/materials"
    text = "甲😀\n" + "木" * 210
    r = client.post(
        url, headers=headers, files={"file": (r"C:\private\brief.txt", text.encode())}
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["filename"] == "brief.txt"
    assert data["char_count"] == len(text)
    assert data["content_hash"] == hashlib.sha256(text.encode()).hexdigest()
    assert data["excerpt"] == text[:200]
    assert "content" not in data and "text" not in data
    snapshot = db.get(TaskInput, uuid.UUID(data["id"]))
    assert snapshot and snapshot.content == text
    assert db.exec(
        select(TaskInputChunk).where(TaskInputChunk.task_input_id == snapshot.id)
    ).all()
    audit = db.exec(select(AuditLog).where(AuditLog.entity_id == snapshot.id)).one()
    assert audit.action == "task.material_add"
    assert audit.detail == {"filename": "brief.txt", "char_count": len(text)}
    first = client.get(url, headers=headers, params={"page_size": 1}).json()
    second = client.get(url, headers=headers, params={"page_size": 1, "page": 2}).json()
    assert first["total"] == second["total"] == 2
    assert first["items"][0]["filename"] == "paste.txt"
    assert second["items"][0]["id"] == data["id"]
    # A repeated upload is a new snapshot, even if a caller supplies an unrelated key header.
    again = client.post(
        url,
        headers={**headers, "Idempotency-Key": "ignored"},
        files={"file": ("brief.txt", text.encode())},
    )
    assert again.status_code == 201 and again.json()["id"] != data["id"]


@pytest.mark.parametrize(
    ("filename", "content", "code"),
    [
        ("no.exe", b"x", "UNSUPPORTED_FILE_TYPE"),
        ("large.txt", b"a" * (5 * 1024 * 1024 + 1), "FILE_TOO_LARGE"),
        ("bad.pdf", b"not a PDF", "PARSE_FAILED"),
        ("empty.md", b" \n", "PARSE_FAILED"),
        ("long.txt", ("木" * 50_001).encode(), "MATERIAL_TOO_LONG"),
    ],
    ids=["unsupported", "file-limit", "corrupt", "blank", "text-limit"],
)
def test_file_failures_leave_no_material(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    filename: str,
    content: bytes,
    code: str,
) -> None:
    task_id, _ = setup_task(client, superuser_token_headers)
    url = f"{API}/tasks/{task_id}/materials"
    r = client.post(
        url, headers=superuser_token_headers, files={"file": (filename, content)}
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == code, r.text
    assert r.json()["error"]["request_id"]
    if code == "MATERIAL_TOO_LONG":
        assert r.json()["error"]["details"] == {
            "char_count": 50_001,
            "limit_chars": 50_000,
        }
    assert client.get(url, headers=superuser_token_headers).json()["total"] == 0
    assert not db.exec(
        select(TaskInput).where(TaskInput.task_id == uuid.UUID(task_id))
    ).all()


def test_authorization_state_and_count_error_precedence(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    headers = superuser_token_headers
    task_id, brand_id = setup_task(
        client,
        headers,
        task_materials=[{"filename": f"{i}.txt", "text": "临时资料"} for i in range(5)],
    )
    url = f"{API}/tasks/{task_id}/materials"
    outsider, outsider_headers = _make_user(client, db)
    outsider.is_superuser = True
    db.add(outsider)
    db.commit()
    for h in (None, outsider_headers):
        expected = 401 if h is None else 404
        assert (
            client.post(url, headers=h, files={"file": ("bad.exe", b"")}).status_code
            == expected
        )
        assert client.get(url, headers=h).status_code == expected
    # A platform administrator with no membership cannot discover another brand's task.
    own_user, own_headers = _make_user(client, db)
    own_brand = _create_brand(client, headers)
    _add_member(client, headers, own_brand["id"], own_user, "admin")
    assert client.get(url, headers=own_headers).status_code == 404
    limit = client.post(url, headers=headers, files={"file": ("bad.exe", b"")})
    assert (
        limit.status_code == 422
        and limit.json()["error"]["code"] == "MATERIAL_LIMIT_EXCEEDED"
    )
    assert limit.json()["error"]["details"] == {"material_count": 5, "limit_count": 5}
    task = db.get(Task, uuid.UUID(task_id))
    assert task
    task.flow_status = "generating"
    db.add(task)
    db.commit()
    state = client.post(url, headers=headers, files={"file": ("bad.exe", b"")})
    assert (
        state.status_code == 409
        and state.json()["error"]["details"]["current_state"] == "generating"
    )
    assert client.get(url, headers=headers).json()["total"] == 5
    assert brand_id


def test_editor_can_upload_and_embedding_failure_is_atomic(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    embedder: FakeEmbeddingProvider,
) -> None:
    task_id, brand_id = setup_task(client, superuser_token_headers)
    editor, headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand_id, editor, "editor")
    url = f"{API}/tasks/{task_id}/materials"
    embedder.fail = True
    r = client.post(url, headers=headers, files={"file": ("short.txt", b"text")})
    assert r.status_code == 503 and r.json()["error"]["code"] == "MODEL_UNAVAILABLE"
    assert client.get(url, headers=headers).json()["total"] == 0
    db.expire_all()
    task = db.get(Task, uuid.UUID(task_id))
    assert task and task.flow_status == "queued"
    embedder.fail = False
    r = client.post(
        url, headers=headers, files={"file": ("short.txt", "😀\n" * 25_000)}
    )
    assert r.status_code == 201 and r.json()["char_count"] == 50_000


def test_material_form_and_pagination_validation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    task_id, _ = setup_task(client, superuser_token_headers)
    url = f"{API}/tasks/{task_id}/materials"
    for files in (
        [("file", ("a.txt", b"one")), ("file", ("b.txt", b"two"))],
        [("file", ("a" * 301 + ".txt", b"one"))],
    ):
        r = client.post(url, headers=superuser_token_headers, files=files)
        assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.post(url, headers=superuser_token_headers).status_code == 422
    assert (
        client.get(
            url, headers=superuser_token_headers, params={"page_size": 101}
        ).status_code
        == 422
    )


def test_upload_holds_task_lock_against_generate_and_other_uploads(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task_id, _ = setup_task(client, superuser_token_headers)
    task = db.get(Task, uuid.UUID(task_id))
    assert task
    actor = task.created_by
    blocked: list[str] = []

    def probe_parse(_filename: str, content: bytes) -> str:
        for operation in ("generate", "upload"):
            with Session(engine) as other:
                other.exec(sql_text("SET LOCAL lock_timeout = '100ms'"))  # type: ignore[call-overload]
                stale_task = other.get(Task, uuid.UUID(task_id))
                assert stale_task
                with pytest.raises(OperationalError):
                    if operation == "generate":
                        generation.begin_generation(
                            session=other, task=stale_task, idempotency_key=None
                        )
                    else:
                        task_materials.add_file(
                            session=other,
                            task=stale_task,
                            user_id=actor,
                            filename="other.txt",
                            stream=io.BytesIO(b"other"),
                            embedder=FakeEmbeddingProvider(),
                        )
                other.rollback()
                blocked.append(operation)
        return content.decode()

    monkeypatch.setattr(task_materials, "parse_document", probe_parse)
    r = client.post(
        f"{API}/tasks/{task_id}/materials",
        headers=superuser_token_headers,
        files={"file": ("locked.txt", b"lock test")},
    )
    assert r.status_code == 201, r.text
    assert blocked == ["generate", "upload"]
    assert (
        client.get(
            f"{API}/tasks/{task_id}/materials", headers=superuser_token_headers
        ).json()["total"]
        == 1
    )
    assert (
        client.get(
            f"{API}/tasks/{uuid.uuid4()}/materials", headers=superuser_token_headers
        ).status_code
        == 404
    )
