import importlib.util
import uuid
from pathlib import Path
from unittest.mock import MagicMock, Mock

import jwt
import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.domain.knowledge_similarity import merge_similarities
from app.fakes.embedding import FakeEmbeddingProvider
from app.models import KbDocument
from app.models.knowledge import KnowledgeNoteCreate, KnowledgeTextVersion, ReviewCreate
from app.services import knowledge_similarity as sim


def document() -> KbDocument:
    return KbDocument(brand_id=uuid.uuid4(), title="来源标题", doc_type="sample_note")


def test_merge_max_score_title_reason_and_cap_without_invented_score() -> None:
    ids = [uuid.uuid4() for _ in range(12)]
    result = merge_similarities(
        [(ids[0], "标题")],
        [(ids[1], "相近", 0.91), (ids[1], "相近", 0.96)]
        + [(id_, "其他", 0.95) for id_ in ids[2:]],
    )
    assert len(result) == 10
    named = next(item for item in result if item.id == ids[0])
    assert named.similarity is None and named.reasons == ["title_match"]
    assert result[0].id == ids[1] and result[0].similarity == 0.96
    combined = merge_similarities([(ids[0], "标题")], [(ids[0], "标题", 0.98)])[0]
    assert combined.reasons == ["title_match", "content_near"]


def test_signed_snapshot_binds_document_brand_and_expiration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SECRET_KEY", "fixture-" * 8)
    doc, other = document(), document()
    token = sim.snapshot(doc, ["one"])
    assert sim.acknowledged(doc, token) == {"one"}
    assert not sim.acknowledged(other, token)
    assert not sim.acknowledged(doc, token + "broken")
    assert not sim.acknowledged(doc, None)
    expired = jwt.encode({"exp": 1}, settings.SECRET_KEY, algorithm="HS256")
    assert not sim.acknowledged(doc, expired)


def test_preview_limit_and_failure_never_write_vectors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doc = document()
    chunks = [Mock(content="资料", embedding=None) for _ in range(25)]
    monkeypatch.setattr(sim.kb, "_chunks_of", lambda *_: chunks)
    monkeypatch.setattr(sim, "compare_vectors", lambda *_: sim.unavailable())
    session = MagicMock()
    fake = FakeEmbeddingProvider()
    sim.preview(session, doc, fake)
    assert len(fake.calls[0]) == 20
    assert all(chunk.embedding is None for chunk in chunks)
    session.add.assert_not_called()
    session.commit.assert_not_called()
    assert (
        sim.preview(session, doc, FakeEmbeddingProvider(fail=True)).status
        == "unavailable"
    )


def test_query_scope_is_compilable_and_failure_degrades() -> None:
    doc = document()
    session = MagicMock()
    session.exec.side_effect = [Mock(all=lambda: []), Mock(all=lambda: [])]
    assert sim.compare_vectors(session, doc, [[0.0] * 1024]).status == "ready"
    sql = str(
        session.exec.call_args_list[1].args[0].compile(dialect=postgresql.dialect())
    )
    assert "kb_document.group_id !=" in sql
    assert "kb_document.brand_id =" in sql and "kb_chunk.brand_id =" in sql
    assert (
        "kb_document.is_current IS true" in sql and "kb_document.index_status =" in sql
    )
    assert "LIMIT" in sql
    session.exec.side_effect = SQLAlchemyError("not exposed")
    assert sim.compare_vectors(session, doc, []).status == "unavailable"


@pytest.mark.parametrize(
    "body",
    [
        {"title": "x", "source_description": " ", "text": "资料"},
        {"title": "x", "source_description": "口述", "text": " "},
        {
            "title": "x",
            "source_description": "口述",
            "text": "资料",
            "brand_id": "other",
        },
    ],
)
def test_note_requires_nonblank_source_and_text(body: dict) -> None:
    with pytest.raises(ValidationError):
        KnowledgeNoteCreate.model_validate(body)


@pytest.mark.parametrize(
    "body",
    [{}, {"text": None}, {"title": " "}, {"doc_type": None}, {"group_id": "other"}],
)
def test_text_versions_only_accept_explicit_edits(body: dict) -> None:
    with pytest.raises(ValidationError):
        KnowledgeTextVersion.model_validate(body)


@pytest.mark.parametrize(
    "body",
    [
        {"action": "cancel"},
        {"action": "approve", "similar_decision": "new_wins", "reason": "理由"},
        {"action": "approve", "related_document_ids": [str(uuid.uuid4())]},
        {"action": "reject", "reason": "理由", "similar_decision": "coexist"},
    ],
)
def test_review_decision_validation(body: dict) -> None:
    with pytest.raises(ValidationError):
        ReviewCreate.model_validate(body)


def test_migration_keeps_cancel_logs_instead_of_deleting_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = (
        Path(__file__).parents[2]
        / "app/alembic/versions/c3e7a1b5d9f2_knowledge_notes_similarity.py"
    )
    spec = importlib.util.spec_from_file_location("notes_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    operation = Mock()
    monkeypatch.setattr(module, "op", operation)
    module.upgrade()
    assert operation.add_column.call_count == 4
    operation.get_bind.return_value.execute.return_value.scalar.return_value = True
    with pytest.raises(RuntimeError):
        module.downgrade()
    operation.drop_column.assert_not_called()
    operation.get_bind.return_value.execute.return_value.scalar.return_value = False
    module.downgrade()
    assert operation.drop_column.call_count == 4
