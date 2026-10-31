"""Authorised-scope rule imports. Planning is pure; all writes and audit commit together."""

import hashlib
import uuid
from typing import Any, NoReturn

from sqlalchemy import text
from sqlmodel import Session, col, select

from app.domain.compliance.import_rules import (
    COLUMNS,
    ExistingRule,
    FileFormat,
    FileProblem,
    Mode,
    check_file,
    export_file,
    parse_file,
    plan_import,
)
from app.models import ComplianceRule
from app.models.common import get_datetime_utc
from app.services.audit import record_audit
from app.services.errors import (
    ConflictError,
    FileTooLargeError,
    InvalidInputError,
    ParseError,
    UnsupportedFileTypeError,
)


def file_error(problem: FileProblem, mode: Mode, dry_run: bool) -> NoReturn:
    errors = {
        "VALIDATION_ERROR": InvalidInputError,
        "CONFLICT": ConflictError,
        "FILE_TOO_LARGE": FileTooLargeError,
        "UNSUPPORTED_FILE_TYPE": UnsupportedFileTypeError,
        "PARSE_FAILED": ParseError,
    }
    details: dict[str, Any] = dict(problem.details)
    if problem.code in {"VALIDATION_ERROR", "CONFLICT"}:
        details.update(dry_run=dry_run, mode=mode)
    if problem.code == "VALIDATION_ERROR":
        details.update(created=0, updated=0, unchanged=0, disabled=0)
    raise errors[problem.code](problem.message, details)


def validate_file(filename: str, size: int, mode: Mode, dry_run: bool) -> None:
    try:
        check_file(filename, size)
    except FileProblem as exc:
        file_error(exc, mode, dry_run)


def scope_lock_key(brand_id: uuid.UUID | None) -> int:
    scope = str(brand_id) if brand_id else "global"
    return int.from_bytes(
        hashlib.sha256(f"compliance.import:{scope}".encode()).digest()[:8],
        "big",
        signed=True,
    )


def scope_rows(session: Session, brand_id: uuid.UUID | None) -> list[ComplianceRule]:
    scope = (
        col(ComplianceRule.brand_id).is_(None)
        if brand_id is None
        else ComplianceRule.brand_id == brand_id
    )
    return list(
        session.exec(
            select(ComplianceRule)
            .where(scope)
            .execution_options(populate_existing=True)
        ).all()
    )


def snapshot(row: ComplianceRule) -> ExistingRule:
    return ExistingRule(
        row.id, {key: getattr(row, key) for key in COLUMNS if key != "id"}
    )


def import_rules(
    *,
    session: Session,
    brand_id: uuid.UUID | None,
    user_id: uuid.UUID,
    filename: str,
    content: bytes,
    mode: Mode,
    dry_run: bool,
) -> dict[str, Any]:
    try:
        rules = parse_file(filename, content)
        session.connection().execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": scope_lock_key(brand_id)},
        )
        rows = scope_rows(session, brand_id)
        plan = plan_import(rules, [snapshot(r) for r in rows], mode)
        result: dict[str, Any] = {
            "dry_run": dry_run,
            "mode": mode,
            **plan.counts(),
            "errors": [],
        }
        if dry_run:
            session.rollback()  # releases the transaction lock without any audit/write
            return result
        by_id = {row.id: row for row in rows}
        for rule in plan.created:
            session.add(
                ComplianceRule(
                    brand_id=brand_id,
                    created_by=user_id,
                    is_sample=False,
                    **rule.editable(),
                )
            )
        for rule_id, rule in plan.updated:
            row = by_id[rule_id]
            for key, value in rule.editable().items():
                setattr(row, key, value)
            row.rule_version += 1
            row.updated_at = get_datetime_utc()
            row.is_sample = False
            session.add(row)
        for rule_id in plan.disabled:
            row = by_id[rule_id]
            row.enabled = False
            row.rule_version += 1
            row.updated_at = get_datetime_utc()
            session.add(row)
        record_audit(
            session,
            action="compliance.import",
            entity_type="compliance_rule",
            actor_id=user_id,
            brand_id=brand_id,
            detail={
                "scope": str(brand_id) if brand_id else "global",
                "mode": mode,
                **plan.counts(),
                "filename": filename[:300],
            },
        )
        session.commit()
        return result
    except FileProblem as exc:
        session.rollback()
        file_error(exc, mode, dry_run)
    except Exception:
        session.rollback()
        raise


def export_rules(
    session: Session, brand_id: uuid.UUID | None, format: FileFormat
) -> bytes:
    return export_file([snapshot(r) for r in scope_rows(session, brand_id)], format)
