"""Structure tests for task_input, audit_log and the seed content (no database needed)."""

from typing import Any

from sqlmodel import SQLModel

from app.fakes.embedding import FakeEmbeddingProvider
from app.models import DocumentType
from app.ports.knowledge import KnowledgeSearch
from app.ports.task_input import TaskInputRepository
from app.ports.voice import VoiceProfileProvider
from app.seed import DOCUMENTS, MARK, VOICE
from app.services.chunking import MAX_CHARS, chunk_text
from app.services.knowledge_search import DbKnowledgeSearch
from app.services.task_input import DbTaskInputRepository
from app.services.voice_profiles import DbVoiceProfileProvider


def _table(name: str) -> Any:
    return SQLModel.metadata.tables[name]


def test_task_input_tables_are_brand_scoped() -> None:
    for name in ("task_input", "task_input_chunk"):
        table = _table(name)
        assert not table.c.brand_id.nullable
        assert {fk.column.table.name for fk in table.c.brand_id.foreign_keys} == {
            "brand"
        }
    snapshot = _table("task_input")
    assert not snapshot.c.task_id.nullable
    assert not snapshot.c.task_id.foreign_keys  # the task table belongs to member B
    assert "ix_task_input_brand_task" in {i.name for i in snapshot.indexes}
    chunk = _table("task_input_chunk")
    assert "ix_task_input_chunk_embedding_hnsw" in {i.name for i in chunk.indexes}


def test_audit_log_keeps_history_when_brand_or_user_is_deleted() -> None:
    table = _table("audit_log")
    rules = {
        fk.parent.name: fk.ondelete for column in table.c for fk in column.foreign_keys
    }
    assert rules == {"brand_id": "SET NULL", "actor_id": "SET NULL"}
    assert table.c.brand_id.nullable and table.c.actor_id.nullable


def test_real_implementations_satisfy_the_ports() -> None:
    embedder = FakeEmbeddingProvider()
    # runtime_checkable only checks the method names, so no session is needed here.
    assert isinstance(DbKnowledgeSearch(None, embedder), KnowledgeSearch)  # type: ignore[arg-type]
    assert isinstance(DbTaskInputRepository(None, embedder), TaskInputRepository)  # type: ignore[arg-type]
    assert isinstance(DbVoiceProfileProvider(None), VoiceProfileProvider)  # type: ignore[arg-type]


def test_seed_content_is_marked_as_demo_data_and_well_formed() -> None:
    valid_types = {t.value for t in DocumentType}
    assert len({d.doc_type for d in DOCUMENTS}) == len(DOCUMENTS)
    for doc in DOCUMENTS:
        assert doc.doc_type in valid_types and doc.title.endswith("（演示）")
        assert MARK in doc.text
        chunks = chunk_text(doc.text)
        assert chunks and all(len(c) <= MAX_CHARS for c in chunks)
    assert {"product_spec", "brand_story"} <= {d.doc_type for d in DOCUMENTS}
    assert VOICE.persona and VOICE.forbidden_words
