"""Compliance rules (editable by people) and risk-hint checks on versions.

The checks are hints for a human reviewer. Rules shipped with the project are samples: they carry
``is_sample`` and a source name saying so, and must be reviewed against real sources before anyone relies
on them.
"""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlmodel import Session, col, func, or_, select

from app.domain.compliance.engine import (
    ContextFindings,
    Hit,
    Layer,
    Rule,
    RuleType,
    Severity,
    apply_efficacy_basis,
    build_context_messages,
    locate_findings,
    pattern_problem,
    scan,
)
from app.models import (
    BrandMember,
    ClaimEvidence,
    ComplianceCheck,
    ComplianceRule,
    GenerationVersion,
    RuleCreate,
    RuleUpdate,
)
from app.models.common import get_datetime_utc
from app.ports.llm import LlmClient, LlmRequest
from app.services.audit import record_audit
from app.services.errors import InvalidInputError, NotFoundError
from app.services.llm_structured import generate_structured

SAMPLE_SOURCE = "示例规则（来源待人工核对，不是正式依据）"

# (layer, rule_type, pattern, is_regex, severity, suggestion)
_SAMPLES: tuple[tuple[Layer, RuleType, str, bool, Severity, str], ...] = (
    (
        Layer.LEXICON,
        RuleType.ABSOLUTE_TERM,
        "最好",
        False,
        Severity.BLOCK,
        "避免使用绝对化用语，改为具体的个人感受",
    ),
    (
        Layer.LEXICON,
        RuleType.ABSOLUTE_TERM,
        "第一",
        False,
        Severity.BLOCK,
        "避免使用绝对化用语",
    ),
    (
        Layer.LEXICON,
        RuleType.ABSOLUTE_TERM,
        "唯一",
        False,
        Severity.BLOCK,
        "避免使用绝对化用语",
    ),
    (
        Layer.LEXICON,
        RuleType.ABSOLUTE_TERM,
        "顶级",
        False,
        Severity.BLOCK,
        "避免使用绝对化用语",
    ),
    (
        Layer.LEXICON,
        RuleType.ABSOLUTE_TERM,
        "绝对",
        False,
        Severity.WARN,
        "避免使用绝对化用语",
    ),
    (
        Layer.LEXICON,
        RuleType.ABSOLUTE_TERM,
        "万能",
        False,
        Severity.WARN,
        "避免使用夸大的说法",
    ),
    (
        Layer.EFFICACY_BASIS,
        RuleType.EFFICACY_CLAIM,
        "美白",
        False,
        Severity.BLOCK,
        "功效说法需要有依据，没有依据请删除",
    ),
    (
        Layer.EFFICACY_BASIS,
        RuleType.EFFICACY_CLAIM,
        "祛斑",
        False,
        Severity.BLOCK,
        "功效说法需要有依据，没有依据请删除",
    ),
    (
        Layer.EFFICACY_BASIS,
        RuleType.EFFICACY_CLAIM,
        "抗皱",
        False,
        Severity.BLOCK,
        "功效说法需要有依据，没有依据请删除",
    ),
    (
        Layer.EFFICACY_BASIS,
        RuleType.EFFICACY_CLAIM,
        "修复",
        False,
        Severity.WARN,
        "功效说法需要有依据",
    ),
    (
        Layer.EFFICACY_BASIS,
        RuleType.MEDICAL_TERM,
        "治疗",
        False,
        Severity.BLOCK,
        "不要使用医疗用语",
    ),
    (
        Layer.EFFICACY_BASIS,
        RuleType.MEDICAL_TERM,
        "消炎",
        False,
        Severity.BLOCK,
        "不要使用医疗用语",
    ),
    (
        Layer.EFFICACY_BASIS,
        RuleType.DATA_CLAIM,
        r"\d+(\.\d+)?\s*%",
        True,
        Severity.WARN,
        "百分比等数据需要有来源",
    ),
    (
        Layer.LEXICON,
        RuleType.PLATFORM_RULE,
        "加微信",
        False,
        Severity.WARN,
        "避免引导站外联系",
    ),
    (
        Layer.LEXICON,
        RuleType.PLATFORM_RULE,
        "私信我",
        False,
        Severity.WARN,
        "避免引导站外交易",
    ),
)


def ensure_sample_rules(session: Session) -> int:
    """Create the missing sample rules (global, enabled). Idempotent; returns how many were added."""
    existing = {
        (r.layer, r.pattern)
        for r in session.exec(
            select(ComplianceRule).where(
                col(ComplianceRule.brand_id).is_(None),
                col(ComplianceRule.is_sample).is_(True),
            )
        ).all()
    }
    added = 0
    for layer, rule_type, pattern, is_regex, severity, suggestion in _SAMPLES:
        if (layer.value, pattern) in existing:
            continue
        session.add(
            ComplianceRule(
                layer=layer.value,
                rule_type=rule_type.value,
                pattern=pattern,
                is_regex=is_regex,
                severity=severity.value,
                suggestion=suggestion,
                source_name=SAMPLE_SOURCE,
                region_scope="CN",
                is_sample=True,
            )
        )
        added += 1
    if added:
        session.commit()
    return added


def _to_rule(row: ComplianceRule) -> Rule:
    return Rule(
        id=str(row.id),
        rule_version=row.rule_version,
        layer=Layer(row.layer),
        rule_type=RuleType(row.rule_type),
        pattern=row.pattern,
        is_regex=row.is_regex,
        severity=Severity(row.severity),
        suggestion=row.suggestion,
        source_name=row.source_name,
        source_clause=row.source_clause,
        region_scope=row.region_scope,
        effective_from=row.effective_from,
        effective_to=row.effective_to,
        enabled=row.enabled,
    )


# ---- rule management ----
def _validate(layer: str, pattern: str, is_regex: bool) -> None:
    if layer == Layer.CONTEXT.value:
        raise InvalidInputError("语境层由模型判断，不能用规则内容配置")
    problem = pattern_problem(pattern, is_regex)
    if problem:
        raise InvalidInputError(problem)


def create_rule(
    *,
    session: Session,
    data: RuleCreate,
    brand_id: uuid.UUID | None,
    user_id: uuid.UUID,
) -> ComplianceRule:
    _validate(data.layer.value, data.pattern, data.is_regex)
    row = ComplianceRule(
        brand_id=brand_id,
        layer=data.layer.value,
        rule_type=data.rule_type.value,
        pattern=data.pattern.strip(),
        is_regex=data.is_regex,
        severity=data.severity.value,
        suggestion=data.suggestion,
        source_name=data.source_name,
        source_url=data.source_url,
        source_clause=data.source_clause,
        region_scope=data.region_scope,
        effective_from=data.effective_from,
        effective_to=data.effective_to,
        enabled=data.enabled,
        created_by=user_id,
    )
    session.add(row)
    session.flush()
    record_audit(
        session,
        action="compliance_rule.create",
        entity_type="compliance_rule",
        actor_id=user_id,
        brand_id=brand_id,
        entity_id=row.id,
        detail={"pattern": row.pattern, "severity": row.severity},
    )
    session.commit()
    session.refresh(row)
    return row


def update_rule(
    *, session: Session, row: ComplianceRule, data: RuleUpdate, user_id: uuid.UUID
) -> ComplianceRule:
    changes = data.model_dump(exclude_unset=True)
    reason = changes.pop("reason", None)
    required = {
        "layer",
        "rule_type",
        "pattern",
        "is_regex",
        "severity",
        "source_name",
        "enabled",
    }
    for key, value in changes.items():
        if value is None and key in required:
            continue
        setattr(row, key, value.value if hasattr(value, "value") else value)
    _validate(row.layer, row.pattern, row.is_regex)
    if (
        row.effective_from
        and row.effective_to
        and row.effective_from > row.effective_to
    ):
        raise InvalidInputError("生效日期不能晚于失效日期")
    row.is_sample = (
        False if changes else row.is_sample
    )  # an edited sample is now a reviewed rule
    row.rule_version += 1
    row.updated_at = get_datetime_utc()
    session.add(row)
    record_audit(
        session,
        action="compliance_rule.update",
        entity_type="compliance_rule",
        actor_id=user_id,
        brand_id=row.brand_id,
        entity_id=row.id,
        detail={
            "rule_version": row.rule_version,
            "fields": sorted(changes),
            **(
                {"reason": reason} if reason and changes.get("enabled") is False else {}
            ),
        },
    )
    session.commit()
    session.refresh(row)
    return row


def get_rule(*, session: Session, rule_id: uuid.UUID) -> ComplianceRule:
    row = session.get(ComplianceRule, rule_id)
    if row is None:
        raise NotFoundError("Rule not found")
    return row


def list_rules(
    *,
    session: Session,
    user_id: uuid.UUID,
    brand_id: uuid.UUID | None,
    layer: str | None,
    rule_type: str | None,
    severity: str | None,
    page: int,
    page_size: int,
    scope_filter: str | None = None,
) -> tuple[list[ComplianceRule], int]:
    """Global rules plus the brand rules the user may see (one brand when ``brand_id`` is given).

    ``scope_filter`` narrows that to ``global`` (brand_id is null) or ``brand`` (the given brand only).
    """
    scope: Any
    if scope_filter == "global":
        scope = col(ComplianceRule.brand_id).is_(None)
    elif scope_filter == "brand":
        assert brand_id is not None  # the route rejects ``brand`` without a brand_id
        scope = ComplianceRule.brand_id == brand_id
    elif brand_id is not None:
        scope = or_(
            col(ComplianceRule.brand_id).is_(None), ComplianceRule.brand_id == brand_id
        )
    else:
        mine = select(BrandMember.brand_id).where(BrandMember.user_id == user_id)
        scope = or_(
            col(ComplianceRule.brand_id).is_(None),
            col(ComplianceRule.brand_id).in_(mine),
        )
    where: list[Any] = [scope]
    if layer:
        where.append(ComplianceRule.layer == layer)
    if rule_type:
        where.append(ComplianceRule.rule_type == rule_type)
    if severity:
        where.append(ComplianceRule.severity == severity)
    total = session.exec(
        select(func.count()).select_from(ComplianceRule).where(*where)
    ).one()
    rows = session.exec(
        select(ComplianceRule)
        .where(*where)
        .order_by(col(ComplianceRule.created_at), col(ComplianceRule.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def active_rules(session: Session, brand_id: uuid.UUID | None) -> list[Rule]:
    """Enabled global rules plus, when given, those of the brand (what a real check would use)."""
    scope: Any = col(ComplianceRule.brand_id).is_(None)
    if brand_id is not None:
        scope = or_(scope, ComplianceRule.brand_id == brand_id)
    return [
        _to_rule(r)
        for r in session.exec(
            select(ComplianceRule).where(col(ComplianceRule.enabled).is_(True), scope)
        ).all()
    ]


# ---- checks on a version ----
@dataclass(frozen=True)
class ComplianceSummary:
    total: int
    unresolved_block: int
    unresolved_warn: int


def note_fields(version: GenerationVersion) -> dict[str, str]:
    fields = {f"title.{i}": t for i, t in enumerate(version.title_candidates)}
    fields["body"] = version.body
    fields["hashtags"] = " ".join(version.hashtags)
    fields.update({f"cover.{i}": c for i, c in enumerate(version.cover_candidates)})
    return fields


def summarize(rows: list[ComplianceCheck]) -> ComplianceSummary:
    open_rows = [r for r in rows if not r.resolved]
    return ComplianceSummary(
        total=len(rows),
        unresolved_block=sum(
            1 for r in open_rows if r.severity == Severity.BLOCK.value
        ),
        unresolved_warn=sum(1 for r in open_rows if r.severity == Severity.WARN.value),
    )


def _row(version: GenerationVersion, hit: Hit) -> ComplianceCheck:
    return ComplianceCheck(
        version_id=version.id,
        brand_id=version.brand_id,
        rule_id=uuid.UUID(hit.rule_id) if hit.rule_id else None,
        rule_version=hit.rule_version,
        layer=hit.layer.value,
        rule_type=hit.rule_type,
        severity=hit.severity.value,
        field=hit.field,
        span_start=hit.start,
        span_end=hit.end,
        matched_text=hit.matched_text,
        suggestion=hit.suggestion,
        source_name=hit.source_name,
        source_clause=hit.source_clause,
        region_scope=hit.region_scope,
        basis=hit.basis,
    )


def check_compliance(
    *,
    session: Session,
    version: GenerationVersion,
    llm: LlmClient | None,
    today: date | None = None,
) -> list[ComplianceCheck]:
    """Replace the version's risk hints with a fresh scan of its current text. Caller commits.

    The context layer runs only when ``llm`` is given. A model failure is raised before anything is
    stored, so the previous hints stay in place.
    """
    rules = [
        _to_rule(r)
        for r in session.exec(
            select(ComplianceRule).where(
                col(ComplianceRule.enabled).is_(True),
                or_(
                    col(ComplianceRule.brand_id).is_(None),
                    ComplianceRule.brand_id == version.brand_id,
                ),
            )
        ).all()
    ]
    fields = note_fields(version)
    supported = [
        e.claim_text
        for e in session.exec(
            select(ClaimEvidence).where(ClaimEvidence.version_id == version.id)
        ).all()
        if e.status == "system_supported" or e.human_confirmed is True
    ]
    hits = apply_efficacy_basis(
        scan(fields, rules, today=today or date.today()), fields, supported
    )
    if llm is not None:
        findings = generate_structured(
            llm,
            LlmRequest(
                messages=build_context_messages(fields),
                temperature=0.0,
                purpose="compliance_context",
            ),
            ContextFindings,
            max_attempts=2,
        ).value.findings
        hits += locate_findings(findings, fields)

    for old in session.exec(
        select(ComplianceCheck).where(ComplianceCheck.version_id == version.id)
    ).all():
        session.delete(old)
    session.flush()
    rows = [_row(version, h) for h in hits]
    session.add_all(rows)
    session.flush()
    return rows


def list_checks(*, session: Session, version_id: uuid.UUID) -> list[ComplianceCheck]:
    return list(
        session.exec(
            select(ComplianceCheck)
            .where(ComplianceCheck.version_id == version_id)
            .order_by(col(ComplianceCheck.field), col(ComplianceCheck.span_start))
        ).all()
    )


def get_check(*, session: Session, check_id: uuid.UUID) -> ComplianceCheck:
    row = session.get(ComplianceCheck, check_id)
    if row is None:
        raise NotFoundError("Check not found")
    return row


def resolve_check(
    *, session: Session, check: ComplianceCheck, note: str, user_id: uuid.UUID
) -> ComplianceCheck:
    """A person says they dealt with the hint (for example by judging it harmless). The hint stays."""
    check.resolved = True
    check.resolved_note = note
    check.resolved_by = user_id
    check.resolved_at = get_datetime_utc()
    session.add(check)
    record_audit(
        session,
        action="compliance_check.resolve",
        entity_type="compliance_check",
        actor_id=user_id,
        brand_id=check.brand_id,
        entity_id=check.id,
        detail={"severity": check.severity, "layer": check.layer},
    )
    session.commit()
    session.refresh(check)
    return check
