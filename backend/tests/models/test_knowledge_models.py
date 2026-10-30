"""Structure tests for the brand and knowledge base tables. They need no database."""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from pgvector.sqlalchemy import Vector
from sqlalchemy import Table
from sqlmodel import SQLModel

from app.models import (
    EMBEDDING_DIMENSIONS,
    BrandCategory,
    DocumentStatus,
    DocumentType,
    IndexStatus,
    MemberRole,
    ReviewAction,
)


def _table(name: str) -> Table:
    return SQLModel.metadata.tables[name]


def _check_sql(table: Table, name: str) -> str:
    for constraint in table.constraints:
        if constraint.name == name:
            return str(constraint.sqltext)  # type: ignore[attr-defined]
    raise AssertionError(f"constraint {name} not found on {table.name}")


def test_all_new_tables_are_registered() -> None:
    names = set(SQLModel.metadata.tables)
    assert {
        "tenant",
        "brand",
        "brand_member",
        "kb_document",
        "kb_review",
        "kb_chunk",
    } <= names


def test_embedding_column_is_vector_1024() -> None:
    assert EMBEDDING_DIMENSIONS == 1024
    column = _table("kb_chunk").c.embedding
    assert isinstance(column.type, Vector)
    assert column.type.dim == 1024
    assert column.nullable


def test_chunk_uses_meta_not_the_reserved_metadata_name() -> None:
    columns = _table("kb_chunk").c
    assert "meta" in columns
    assert "metadata" not in columns


def test_chunk_has_an_hnsw_cosine_index() -> None:
    indexes = {ix.name: ix for ix in _table("kb_chunk").indexes}
    hnsw = indexes["ix_kb_chunk_embedding_hnsw"]
    assert hnsw.dialect_options["postgresql"]["using"] == "hnsw"
    assert hnsw.dialect_options["postgresql"]["ops"] == {
        "embedding": "vector_cosine_ops"
    }
    assert "ix_kb_chunk_brand_id" in indexes


def test_check_constraints_match_the_enums() -> None:
    document = _table("kb_document")
    for value in DocumentStatus:
        assert f"'{value.value}'" in _check_sql(document, "ck_kb_document_status")
    for doc_type in DocumentType:
        assert f"'{doc_type.value}'" in _check_sql(document, "ck_kb_document_type")
    for index_status in IndexStatus:
        assert f"'{index_status.value}'" in _check_sql(
            document, "ck_kb_document_index_status"
        )
    for action in ReviewAction:
        assert f"'{action.value}'" in _check_sql(
            _table("kb_review"), "ck_kb_review_action"
        )
    for role in MemberRole:
        assert f"'{role.value}'" in _check_sql(
            _table("brand_member"), "ck_brand_member_role"
        )
    for category in BrandCategory:
        assert f"'{category.value}'" in _check_sql(_table("brand"), "ck_brand_category")


def test_foreign_key_delete_rules() -> None:
    def rule(table: str, column: str) -> str | None:
        fk = next(iter(_table(table).c[column].foreign_keys))
        return fk.ondelete

    assert rule("kb_chunk", "document_id") == "CASCADE"
    assert rule("kb_chunk", "brand_id") == "CASCADE"
    assert rule("kb_review", "document_id") == "CASCADE"
    assert rule("kb_document", "brand_id") == "CASCADE"
    assert rule("kb_document", "submitted_by") == "SET NULL"
    assert rule("kb_document", "supersedes_id") == "SET NULL"
    assert rule("brand_member", "user_id") == "CASCADE"


def test_document_version_is_unique_per_group() -> None:
    names = {c.name for c in _table("kb_document").constraints}
    assert "uq_kb_document_group_version" in names


def test_alembic_history_has_a_single_head() -> None:
    backend = Path(__file__).resolve().parents[2]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "app" / "alembic"))
    script = ScriptDirectory.from_config(config)
    assert len(script.get_heads()) == 1
