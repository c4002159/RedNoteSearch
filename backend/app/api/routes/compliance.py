import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import col, select

from app.api.brand_deps import BrandAccess, BrandAdminDep, get_brand_access
from app.api.deps import CurrentUser, SessionDep, get_current_active_superuser
from app.api.routes.tasks import VersionAccessDep, _member_access
from app.domain.compliance.engine import Layer, RuleType, Severity
from app.models import (
    BrandMember,
    ComplianceCheck,
    ComplianceCheckPublic,
    ComplianceChecksPublic,
    ComplianceRule,
    MemberRole,
    ResolveCheck,
    RuleCreate,
    RulePublic,
    RulesPublic,
    RuleUpdate,
)
from app.services import compliance as compliance_service

router = APIRouter(tags=["compliance"])


def get_rule_for_read(
    rule_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> ComplianceRule:
    """Global rules are visible to every user; a brand's rules only to its members (404 otherwise)."""
    row = session.get(ComplianceRule, rule_id)
    if row is None or (
        row.brand_id is not None
        and session.get(BrandMember, (row.brand_id, current_user.id)) is None
    ):
        raise HTTPException(status_code=404, detail="Rule not found")
    return row


def get_rule_for_edit(
    row: Annotated[ComplianceRule, Depends(get_rule_for_read)],
    session: SessionDep,
    current_user: CurrentUser,
) -> ComplianceRule:
    """Global rules are edited by platform administrators, a brand's rules by that brand's admins."""
    if row.brand_id is None:
        if not current_user.is_superuser:
            raise HTTPException(
                status_code=403, detail="Platform administrator required"
            )
        return row
    member = session.get(BrandMember, (row.brand_id, current_user.id))
    if member is None or member.role != MemberRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Brand admin role required")
    return row


RuleReadDep = Annotated[ComplianceRule, Depends(get_rule_for_read)]
RuleEditDep = Annotated[ComplianceRule, Depends(get_rule_for_edit)]


def _urls(
    session: SessionDep, rows: list[ComplianceCheck]
) -> dict[uuid.UUID, str | None]:
    ids = {r.rule_id for r in rows if r.rule_id}
    if not ids:
        return {}
    found = session.exec(
        select(ComplianceRule).where(col(ComplianceRule.id).in_(ids))
    ).all()
    return {rule.id: rule.source_url for rule in found}


def _check_public(
    row: ComplianceCheck, urls: dict[uuid.UUID, str | None] | None = None
) -> ComplianceCheckPublic:
    return ComplianceCheckPublic(
        id=row.id,
        version_id=row.version_id,
        rule_id=row.rule_id,
        rule_version=row.rule_version,
        layer=row.layer,
        rule_type=row.rule_type,
        severity=row.severity,
        field=row.field,
        span=[row.span_start, row.span_end],
        matched_text=row.matched_text,
        suggestion=row.suggestion,
        source_name=row.source_name,
        source_clause=row.source_clause,
        source_url=(urls or {}).get(row.rule_id) if row.rule_id else None,
        region_scope=row.region_scope,
        basis=row.basis,
        resolved=row.resolved,
        resolved_note=row.resolved_note,
    )


@router.get("/compliance-rules", response_model=RulesPublic)
def read_rules(
    session: SessionDep,
    current_user: CurrentUser,
    brand_id: uuid.UUID | None = None,
    layer: Layer | None = None,
    rule_type: RuleType | None = None,
    severity: Severity | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> RulesPublic:
    if brand_id is not None:
        get_brand_access(
            brand_id, session, current_user
        )  # asking about a brand needs membership
    rows, total = compliance_service.list_rules(
        session=session,
        user_id=current_user.id,
        brand_id=brand_id,
        layer=layer.value if layer else None,
        rule_type=rule_type.value if rule_type else None,
        severity=severity.value if severity else None,
        page=page,
        page_size=page_size,
    )
    return RulesPublic(
        items=[RulePublic.model_validate(r, from_attributes=True) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/compliance-rules/{rule_id}", response_model=RulePublic)
def read_rule(row: RuleReadDep) -> RulePublic:
    return RulePublic.model_validate(row, from_attributes=True)


@router.post(
    "/compliance-rules",
    response_model=RulePublic,
    status_code=201,
    dependencies=[Depends(get_current_active_superuser)],
)
def create_global_rule(
    session: SessionDep, current_user: CurrentUser, body: RuleCreate
) -> RulePublic:
    row = compliance_service.create_rule(
        session=session, data=body, brand_id=None, user_id=current_user.id
    )
    return RulePublic.model_validate(row, from_attributes=True)


@router.post(
    "/brands/{brand_id}/compliance-rules", response_model=RulePublic, status_code=201
)
def create_brand_rule(
    access: BrandAdminDep, session: SessionDep, body: RuleCreate
) -> RulePublic:
    row = compliance_service.create_rule(
        session=session, data=body, brand_id=access.brand_id, user_id=access.user_id
    )
    return RulePublic.model_validate(row, from_attributes=True)


@router.patch("/compliance-rules/{rule_id}", response_model=RulePublic)
def update_rule(
    row: RuleEditDep,
    session: SessionDep,
    current_user: CurrentUser,
    body: RuleUpdate,
) -> RulePublic:
    """Edit or switch off (``enabled = false``) a rule. Each edit raises its ``rule_version``."""
    updated = compliance_service.update_rule(
        session=session, row=row, data=body, user_id=current_user.id
    )
    return RulePublic.model_validate(updated, from_attributes=True)


@router.get(
    "/generation-versions/{version_id}/compliance",
    response_model=ComplianceChecksPublic,
)
def read_version_compliance(
    access: VersionAccessDep, session: SessionDep
) -> ComplianceChecksPublic:
    rows = compliance_service.list_checks(session=session, version_id=access[0].id)
    return ComplianceChecksPublic(
        items=[_check_public(r, _urls(session, rows)) for r in rows],
        unresolved_block=compliance_service.summarize(rows).unresolved_block,
    )


def get_check_access(
    check_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> tuple[ComplianceCheck, BrandAccess]:
    row = session.get(ComplianceCheck, check_id)
    access = _member_access(session, current_user, row.brand_id) if row else None
    if row is None or access is None:
        raise HTTPException(status_code=404, detail="Check not found")
    return row, access


@router.post(
    "/compliance-checks/{check_id}/resolve", response_model=ComplianceCheckPublic
)
def resolve_check(
    access: Annotated[tuple[ComplianceCheck, BrandAccess], Depends(get_check_access)],
    session: SessionDep,
    body: ResolveCheck,
) -> ComplianceCheckPublic:
    """Record that a person dealt with the hint. This does not make the text compliant."""
    row, brand_access = access
    saved = compliance_service.resolve_check(
        session=session, check=row, note=body.note, user_id=brand_access.user_id
    )
    return _check_public(saved, _urls(session, [saved]))
