import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.brand_deps import BrandAccessDep, BrandAdminDep
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    BrandMember,
    MemberRole,
    Product,
    ProductCreate,
    ProductPublic,
    ProductsPublic,
    ProductStatus,
    ProductUpdate,
)
from app.services import products as product_service

router = APIRouter(tags=["products"])


def get_product_for_admin(
    product_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Product:
    """Load a product for modification: the caller must be an admin of the product's brand.

    The brand comes from the stored product, never from the request body. A missing product and a
    product of a brand the caller does not administer both give 403, so existence is not revealed.
    """
    product = session.get(Product, product_id)
    member = (
        session.get(BrandMember, (product.brand_id, current_user.id))
        if product is not None
        else None
    )
    if product is None or member is None or member.role != MemberRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Brand admin role required")
    return product


ProductAdminDep = Annotated[Product, Depends(get_product_for_admin)]


@router.get("/brands/{brand_id}/products", response_model=ProductsPublic)
def read_products(
    access: BrandAccessDep,
    session: SessionDep,
    status: ProductStatus = ProductStatus.ACTIVE,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ProductsPublic:
    rows, total = product_service.list_products(
        session=session,
        brand_id=access.brand_id,
        status=status,
        page=page,
        page_size=page_size,
    )
    return ProductsPublic(
        items=[product_service.to_public(p) for p in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/brands/{brand_id}/products", response_model=ProductPublic, status_code=201
)
def create_product(
    access: BrandAdminDep, session: SessionDep, body: ProductCreate
) -> ProductPublic:
    product = product_service.create_product(
        session=session, brand_id=access.brand_id, data=body
    )
    return product_service.to_public(product)


@router.patch("/products/{product_id}", response_model=ProductPublic)
def update_product(
    product: ProductAdminDep, session: SessionDep, body: ProductUpdate
) -> ProductPublic:
    updated = product_service.update_product(
        session=session, product=product, data=body
    )
    return product_service.to_public(updated)


@router.post("/products/{product_id}/archive", response_model=ProductPublic)
def archive_product(product: ProductAdminDep, session: SessionDep) -> ProductPublic:
    """Soft delete: the product stays so tasks that referenced it keep working."""
    archived = product_service.archive_product(session=session, product=product)
    return product_service.to_public(archived)
