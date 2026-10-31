import uuid
from typing import Any

from sqlmodel import Session, col, func, select

from app.models import (
    KbChunk,
    KbDocument,
    Product,
    ProductCreate,
    ProductPublic,
    ProductStatus,
    ProductUpdate,
    SellingPoint,
    SellingPointPublic,
)
from app.models.common import get_datetime_utc
from app.models.knowledge import DocumentStatus
from app.services.errors import ConflictError, NotFoundError

_REQUIRED = {"name", "category", "notes", "selling_points", "restricted_claims"}


def _validate_sources(
    *, session: Session, brand_id: uuid.UUID, points: list[SellingPoint]
) -> None:
    """A selling point's source must be a current, approved document (and chunk) of the same brand."""
    for point in points:
        if point.source_chunk_id and not point.source_document_id:
            raise ConflictError("source_chunk_id requires source_document_id")
        if point.source_document_id is None:
            continue
        doc = session.get(KbDocument, point.source_document_id)
        if (
            doc is None
            or doc.brand_id != brand_id
            or doc.status != DocumentStatus.APPROVED.value
            or not doc.is_current
        ):
            raise ConflictError(
                "Selling point source must be a current, approved document of this brand"
            )
        if point.source_chunk_id is not None:
            chunk = session.get(KbChunk, point.source_chunk_id)
            if (
                chunk is None
                or chunk.document_id != doc.id
                or chunk.brand_id != brand_id
            ):
                raise ConflictError(
                    "Selling point chunk does not belong to the document"
                )


def to_public(product: Product) -> ProductPublic:
    points = [
        SellingPointPublic(
            **p, evidence_status="linked" if p.get("source_document_id") else "draft"
        )
        for p in product.selling_points
    ]
    return ProductPublic.model_validate(
        {
            "id": product.id,
            "brand_id": product.brand_id,
            "name": product.name,
            "product_line": product.product_line,
            "category": product.category,
            "notes": product.notes,
            "selling_points": points,
            "restricted_claims": product.restricted_claims,
            "status": product.status,
        }
    )


def _points_json(points: list[SellingPoint]) -> list[dict[str, Any]]:
    return [p.model_dump(mode="json") for p in points]


def list_products(
    *,
    session: Session,
    brand_id: uuid.UUID,
    status: ProductStatus,
    page: int,
    page_size: int,
) -> tuple[list[Product], int]:
    where = (Product.brand_id == brand_id, Product.status == status.value)
    total = session.exec(select(func.count()).select_from(Product).where(*where)).one()
    rows = session.exec(
        select(Product)
        .where(*where)
        .order_by(col(Product.created_at), col(Product.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def get_product(*, session: Session, product_id: uuid.UUID) -> Product:
    product = session.get(Product, product_id)
    if product is None:
        raise NotFoundError("Product not found")
    return product


def create_product(
    *, session: Session, brand_id: uuid.UUID, data: ProductCreate
) -> Product:
    _validate_sources(session=session, brand_id=brand_id, points=data.selling_points)
    product = Product(
        brand_id=brand_id,
        name=data.name,
        product_line=data.product_line,
        category=data.category.value,
        notes=data.notes.model_dump(),
        selling_points=_points_json(data.selling_points),
        restricted_claims=data.restricted_claims,
    )
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


def update_product(
    *, session: Session, product: Product, data: ProductUpdate
) -> Product:
    if data.selling_points is not None:
        _validate_sources(
            session=session, brand_id=product.brand_id, points=data.selling_points
        )
    changes: dict[str, Any] = {}
    for key in data.model_fields_set:
        value = getattr(data, key)
        if value is None and key in _REQUIRED:
            continue  # null never clears a required field
        if key == "category":
            value = value.value
        elif key == "notes":
            value = value.model_dump()
        elif key == "selling_points":
            value = _points_json(value)
        changes[key] = value
    for key, value in changes.items():
        setattr(product, key, value)
    product.updated_at = get_datetime_utc()
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


def archive_product(*, session: Session, product: Product) -> Product:
    product.status = ProductStatus.ARCHIVED.value
    product.updated_at = get_datetime_utc()
    session.add(product)
    session.commit()
    session.refresh(product)
    return product
