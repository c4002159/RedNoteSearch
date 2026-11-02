from fastapi import APIRouter, Response

from app.api.brand_deps import BrandAccessDep, BrandAdminDep
from app.api.deps import SessionDep
from app.models import (
    CreativeTypeCreate,
    CreativeTypePublic,
    CreativeTypesPublic,
)
from app.services import creative_types as service

router = APIRouter(tags=["creative-types"])


@router.get("/brands/{brand_id}/creative-types", response_model=CreativeTypesPublic)
def read_creative_types(
    access: BrandAccessDep, session: SessionDep
) -> CreativeTypesPublic:
    """The six built-in types, then the brand's own."""
    return CreativeTypesPublic(items=service.list_types(session, access.brand_id))


@router.post(
    "/brands/{brand_id}/creative-types",
    response_model=CreativeTypePublic,
    status_code=201,
)
def create_creative_type(
    access: BrandAdminDep, session: SessionDep, body: CreativeTypeCreate
) -> CreativeTypePublic:
    """Brand admins only. The name may not repeat a built-in or an existing own type (409)."""
    row = service.create_type(
        session, brand_id=access.brand_id, name=body.name, actor_id=access.user_id
    )
    return CreativeTypePublic(
        key=row.key, name=row.name, builtin=False, template_count=0
    )


@router.patch(
    "/brands/{brand_id}/creative-types/{key}", response_model=CreativeTypePublic
)
def rename_creative_type(
    access: BrandAdminDep, session: SessionDep, key: str, body: CreativeTypeCreate
) -> CreativeTypePublic:
    """Brand admins only. Templates keep using the type under its new name."""
    row = service.rename_type(
        session,
        brand_id=access.brand_id,
        key=key,
        name=body.name,
        actor_id=access.user_id,
    )
    count = next(
        t.template_count
        for t in service.list_types(session, access.brand_id)
        if t.key == row.key
    )
    return CreativeTypePublic(
        key=row.key, name=row.name, builtin=False, template_count=count
    )


@router.delete("/brands/{brand_id}/creative-types/{key}", status_code=204)
def delete_creative_type(
    access: BrandAdminDep, session: SessionDep, key: str
) -> Response:
    """Brand admins only. A type that templates or confirmed notes use cannot be deleted (409)."""
    service.delete_type(
        session, brand_id=access.brand_id, key=key, actor_id=access.user_id
    )
    return Response(status_code=204)
