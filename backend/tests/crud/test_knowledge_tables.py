"""Database tests for the brand and knowledge base tables (need PostgreSQL with the vector extension)."""

import uuid
from collections.abc import Generator

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.models import (
    EMBEDDING_DIMENSIONS,
    Brand,
    KbChunk,
    KbDocument,
    KbReview,
    Tenant,
)


@pytest.fixture
def brand_with_document(db: Session) -> Generator[tuple[Brand, KbDocument]]:
    tenant = Tenant(name="test tenant")
    db.add(tenant)
    db.flush()
    brand = Brand(
        tenant_id=tenant.id, name="Test brand", slug=f"b-{uuid.uuid4().hex[:10]}"
    )
    db.add(brand)
    db.flush()
    document = KbDocument(
        brand_id=brand.id,
        title="Spec",
        doc_type="product_spec",
        status="approved",
        is_current=True,
        index_status="ready",
    )
    db.add(document)
    db.commit()
    yield brand, document
    db.rollback()
    db.delete(tenant)  # cascades to brand, documents, chunks and reviews
    db.commit()


def _vector(*leading: float) -> list[float]:
    return list(leading) + [0.0] * (EMBEDDING_DIMENSIONS - len(leading))


def test_vector_search_orders_by_cosine_distance(
    db: Session, brand_with_document: tuple[Brand, KbDocument]
) -> None:
    brand, document = brand_with_document
    db.add(
        KbChunk(
            brand_id=brand.id,
            document_id=document.id,
            chunk_index=0,
            content="far",
            embedding=_vector(0.0, 1.0),
        )
    )
    db.add(
        KbChunk(
            brand_id=brand.id,
            document_id=document.id,
            chunk_index=1,
            content="near",
            embedding=_vector(1.0, 0.1),
        )
    )
    db.commit()

    statement = (
        select(KbChunk)
        .where(KbChunk.brand_id == brand.id)
        .order_by(col(KbChunk.embedding).cosine_distance(_vector(1.0)))
        .limit(2)
    )
    results = db.exec(statement).all()
    assert [c.content for c in results] == ["near", "far"]
    assert len(results[0].embedding or []) == EMBEDDING_DIMENSIONS
    assert results[0].meta == {}


def test_invalid_document_status_is_rejected_by_the_database(
    db: Session, brand_with_document: tuple[Brand, KbDocument]
) -> None:
    brand, _ = brand_with_document
    db.add(
        KbDocument(
            brand_id=brand.id,
            title="Bad",
            doc_type="product_spec",
            status="published",  # not an allowed status
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_document_version_must_be_unique_within_a_group(
    db: Session, brand_with_document: tuple[Brand, KbDocument]
) -> None:
    brand, document = brand_with_document
    db.add(
        KbDocument(
            brand_id=brand.id,
            group_id=document.group_id,
            version=document.version,  # same group and version as the existing row
            title="Duplicate",
            doc_type="product_spec",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_deleting_a_brand_removes_its_documents_chunks_and_reviews(
    db: Session, brand_with_document: tuple[Brand, KbDocument]
) -> None:
    brand, document = brand_with_document
    brand_id, document_id = (
        brand.id,
        document.id,
    )  # the instances are gone after the delete
    db.add(
        KbChunk(
            brand_id=brand.id,
            document_id=document.id,
            chunk_index=0,
            content="x",
            embedding=_vector(1.0),
        )
    )
    db.add(KbReview(document_id=document.id, action="submit"))
    db.commit()

    db.delete(db.get(Brand, brand_id))
    db.commit()

    db.expire_all()
    assert (
        db.exec(
            select(func.count())
            .select_from(KbDocument)
            .where(KbDocument.brand_id == brand_id)
        ).one()
        == 0
    )
    assert (
        db.exec(
            select(func.count())
            .select_from(KbChunk)
            .where(KbChunk.brand_id == brand_id)
        ).one()
        == 0
    )
    assert (
        db.exec(
            select(func.count())
            .select_from(KbReview)
            .where(KbReview.document_id == document_id)
        ).one()
        == 0
    )
