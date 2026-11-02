"""Scope-fixed state changes, one transaction per item; never physically delete rules."""

import uuid

from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from app.models import ComplianceRule
from app.models.common import get_datetime_utc
from app.models.rule_batch import RuleBatchItem, RuleBatchResult, RuleBatchState
from app.services.audit import record_audit


def batch_state(
    *,
    session: Session,
    brand_id: uuid.UUID | None,
    actor_id: uuid.UUID,
    data: RuleBatchState,
) -> RuleBatchResult:
    results: list[RuleBatchItem] = []
    for rule_id in data.ids:
        try:
            row = session.exec(
                select(ComplianceRule)
                .where(
                    ComplianceRule.id == rule_id, ComplianceRule.brand_id == brand_id
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            ).first()
            if row is None:
                session.rollback()
                results.append(
                    RuleBatchItem(
                        id=rule_id,
                        success=False,
                        status_code=404,
                        error_code="NOT_FOUND",
                        message="没有找到这个规则",
                    )
                )
                continue
            changed = row.enabled != data.enabled
            if changed:
                row.enabled = data.enabled
                row.rule_version += 1
                row.updated_at = get_datetime_utc()
                session.add(row)
            version = row.rule_version
            record_audit(
                session,
                action="compliance_rule.batch_state",
                entity_type="compliance_rule",
                actor_id=actor_id,
                brand_id=brand_id,
                entity_id=row.id,
                detail={
                    "enabled": data.enabled,
                    "changed": changed,
                    "rule_version": version,
                    "reason": data.reason,
                },
            )
            session.commit()
            results.append(
                RuleBatchItem(
                    id=rule_id, success=True, changed=changed, rule_version=version
                )
            )
        except SQLAlchemyError:
            session.rollback()
            results.append(
                RuleBatchItem(
                    id=rule_id,
                    success=False,
                    status_code=500,
                    error_code="INTERNAL_ERROR",
                    message="这条规则处理失败，请稍后重试",
                )
            )
    return RuleBatchResult(items=results)
