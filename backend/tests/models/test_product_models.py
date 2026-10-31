"""Structure and validation tests for product and voice profile (no database needed)."""

import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import Index, Table
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex
from sqlmodel import SQLModel

from app.models import (
    Product,
    ProductCreate,
    ProductStatus,
    SellingPoint,
    VoiceProfileCreate,
)
from app.services.products import to_public


def _table(name: str) -> Table:
    return SQLModel.metadata.tables[name]


def test_product_table_is_brand_scoped_and_constrained() -> None:
    table = _table("product")
    assert not table.c.brand_id.nullable
    assert {fk.column.table.name for fk in table.c.brand_id.foreign_keys} == {"brand"}
    names = {c.name for c in table.constraints}
    assert {"ck_product_category", "ck_product_status"} <= names
    assert {s.value for s in ProductStatus} == {"active", "archived"}


def test_voice_profile_allows_one_active_version_per_brand() -> None:
    table = _table("brand_voice_profile")
    assert {c.name for c in table.constraints} >= {"uq_voice_profile_version"}
    index = next(
        i
        for i in table.indexes
        if isinstance(i, Index) and i.name == "uq_voice_profile_one_active"
    )
    assert index.unique
    sql = str(CreateIndex(index).compile(dialect=postgresql.dialect()))
    assert "WHERE is_active" in sql


def test_selling_point_text_is_required() -> None:
    with pytest.raises(ValidationError):
        SellingPoint(text="")
    assert SellingPoint(text="前调佛手柑").source_document_id is None


def test_product_create_defaults_and_limits() -> None:
    product = ProductCreate(name="晨雾")
    assert product.category.value == "other"
    assert product.notes.top == [] and product.selling_points == []
    with pytest.raises(ValidationError):
        ProductCreate(name="")
    with pytest.raises(ValidationError):
        ProductCreate(name="x", category="furniture")  # type: ignore[arg-type]


def test_voice_profile_create_requires_a_persona() -> None:
    with pytest.raises(ValidationError):
        VoiceProfileCreate(persona="")
    assert VoiceProfileCreate(persona="温柔克制").forbidden_words == []


def test_selling_point_without_source_is_reported_as_draft() -> None:
    doc_id = str(uuid.uuid4())
    product = Product(
        brand_id=uuid.uuid4(),
        name="晨雾",
        category="perfume",
        notes={"top": ["佛手柑"]},
        selling_points=[
            {"text": "有来源", "source_document_id": doc_id, "source_chunk_id": None},
            {"text": "无来源"},
        ],
        restricted_claims=[],
    )
    points = to_public(product).selling_points
    assert [(p.text, p.evidence_status) for p in points] == [
        ("有来源", "linked"),
        ("无来源", "draft"),
    ]
