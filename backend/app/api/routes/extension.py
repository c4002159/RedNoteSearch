import uuid
from typing import Annotated

from fastapi import APIRouter, Header, Response

from app.api.brand_deps import BrandAdminDep
from app.api.deps import SessionDep
from app.models import (
    ExtensionKeyCreate,
    ExtensionKeyCreated,
    ExtensionKeyPublic,
    ExtensionKeysPublic,
    ExtensionMetric,
    ExtensionRecorded,
)
from app.services import extension as service

router = APIRouter(tags=["extension"])


@router.post(
    "/brands/{brand_id}/extension-keys",
    response_model=ExtensionKeyCreated,
    status_code=201,
)
def create_extension_key(
    access: BrandAdminDep, session: SessionDep, body: ExtensionKeyCreate
) -> ExtensionKeyCreated:
    """Brand admins only. The key is in this response and nowhere else: it cannot be read again."""
    row, key = service.create_key(
        session, brand_id=access.brand_id, label=body.label, actor_id=access.user_id
    )
    return ExtensionKeyCreated(
        **ExtensionKeyPublic.model_validate(row).model_dump(), key=key
    )


@router.get("/brands/{brand_id}/extension-keys", response_model=ExtensionKeysPublic)
def read_extension_keys(
    access: BrandAdminDep, session: SessionDep
) -> ExtensionKeysPublic:
    return ExtensionKeysPublic(
        items=[
            ExtensionKeyPublic.model_validate(r)
            for r in service.list_keys(session, access.brand_id)
        ]
    )


@router.delete("/brands/{brand_id}/extension-keys/{key_id}", status_code=204)
def revoke_extension_key(
    access: BrandAdminDep, session: SessionDep, key_id: uuid.UUID
) -> Response:
    service.revoke_key(
        session, brand_id=access.brand_id, key_id=key_id, actor_id=access.user_id
    )
    return Response(status_code=204)


@router.post("/extension/metrics", response_model=ExtensionRecorded, status_code=201)
def record_extension_metric(
    session: SessionDep,
    body: ExtensionMetric,
    x_extension_key: Annotated[str | None, Header()] = None,
) -> ExtensionRecorded:
    """For the browser extension only: adds one reading to the confirmed note of the key's brand whose
    saved post link has the same note id. The key cannot read anything."""
    key = service.authenticate(session, x_extension_key)
    return service.record_reading(session, key=key, data=body)
