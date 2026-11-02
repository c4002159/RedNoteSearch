import uuid

from fastapi import APIRouter, HTTPException

from app.api.brand_deps import BrandAccessDep, BrandAdminDep
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    BrandMember,
    MemberRole,
    ScenarioCreate,
    ScenarioPublic,
    ScenariosPublic,
    ScenarioTemplate,
    ScenarioUpdate,
)
from app.services import scenarios as scenario_service
from app.services.errors import NotFoundError

router = APIRouter(tags=["scenarios"])


@router.get("/brands/{brand_id}/scenario-templates", response_model=ScenariosPublic)
def read_brand_templates(
    access: BrandAccessDep, session: SessionDep
) -> ScenariosPublic:
    """Global templates (enabled) and every version of the brand's own, for the management page."""
    rows = scenario_service.list_templates_for_brand(
        session=session, brand_id=access.brand_id
    )
    return ScenariosPublic(items=scenario_service.to_public(session, rows))


@router.post(
    "/brands/{brand_id}/scenario-templates",
    response_model=ScenarioPublic,
    status_code=201,
)
def create_brand_template(
    access: BrandAdminDep, session: SessionDep, user: CurrentUser, body: ScenarioCreate
) -> ScenarioPublic:
    """Brand admins only. Saving a scene and name that already exist creates the next version."""
    row = scenario_service.create_brand_template(
        session,
        brand_id=access.brand_id,
        scene=body.scene.value,
        name=body.name.strip(),
        structure=body.structure.strip(),
        actor_id=user.id,
    )
    return scenario_service.to_public(session, [row])[0]


@router.patch("/scenario-templates/{template_id}", response_model=ScenarioPublic)
def update_template(
    template_id: uuid.UUID,
    body: ScenarioUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> ScenarioPublic:
    """Switch a brand template on or off. Global templates and other brands' templates look missing."""
    row = session.get(ScenarioTemplate, template_id)
    if row is None or row.brand_id is None:
        raise NotFoundError("Template not found")
    member = session.get(BrandMember, (row.brand_id, user.id))
    if member is None:
        raise NotFoundError("Template not found")
    if member.role != MemberRole.ADMIN:
        raise HTTPException(status_code=403, detail="Brand admin role required")
    row = scenario_service.set_template_enabled(
        session, row=row, enabled=body.enabled, actor_id=user.id
    )
    return scenario_service.to_public(session, [row])[0]
