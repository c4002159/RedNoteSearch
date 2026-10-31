"""Process states of a task or a generation version and the rules for moving between them.

``ready_to_copy`` means an operator confirmed the text; it does not mean the text is compliant
(contract section 5). Everything here is a pure function over plain values.
"""

import enum


class FlowStatus(enum.StrEnum):
    """Process state of a task or version. It never means "compliant" (contract section 5)."""

    QUEUED = "queued"
    GENERATING = "generating"
    CHECKING = "checking"
    CHECKS_COMPLETED = "checks_completed"
    NEEDS_HUMAN_REVIEW = "needs_human_review"
    CONSTRAINT_FAILED = "constraint_failed"
    EDITED_PENDING_RECHECK = "edited_pending_recheck"
    READY_TO_COPY = "ready_to_copy"


S = FlowStatus

# A version only moves forward through checking. Editing never changes a version in place: it creates a
# new version in ``edited_pending_recheck``, so ``ready_to_copy`` has no outgoing transition.
_TRANSITIONS: dict[FlowStatus, frozenset[FlowStatus]] = {
    S.QUEUED: frozenset({S.GENERATING}),
    S.GENERATING: frozenset({S.CHECKING, S.CONSTRAINT_FAILED}),
    S.CHECKING: frozenset(
        {S.CHECKS_COMPLETED, S.NEEDS_HUMAN_REVIEW, S.CONSTRAINT_FAILED}
    ),
    S.CHECKS_COMPLETED: frozenset({S.READY_TO_COPY, S.EDITED_PENDING_RECHECK}),
    S.NEEDS_HUMAN_REVIEW: frozenset(
        {S.CHECKS_COMPLETED, S.READY_TO_COPY, S.EDITED_PENDING_RECHECK}
    ),
    S.CONSTRAINT_FAILED: frozenset({S.GENERATING, S.EDITED_PENDING_RECHECK}),
    S.EDITED_PENDING_RECHECK: frozenset({S.CHECKING}),
    S.READY_TO_COPY: frozenset(),
}


def can_transition(current: FlowStatus, target: FlowStatus) -> bool:
    return target in _TRANSITIONS[current]


def allowed_transitions(current: FlowStatus) -> frozenset[FlowStatus]:
    return _TRANSITIONS[current]


def confirm_blockers(
    *,
    status: FlowStatus,
    constraints_passed: bool,
    unresolved_block_risks: int,
    checks_run_on_final_text: bool,
) -> list[str]:
    """Reasons why a version cannot become ``ready_to_copy`` yet; empty means it may.

    Contract: only when constraints passed, no unresolved ``block``-level risk remains, and every check
    ran on the final text.
    """
    reasons: list[str] = []
    if not can_transition(status, FlowStatus.READY_TO_COPY):
        reasons.append(f"状态 {status.value} 不能确认")
    if not checks_run_on_final_text:
        reasons.append("检查尚未针对最终文本运行")
    if not constraints_passed:
        reasons.append("约束检查未通过")
    if unresolved_block_risks > 0:
        reasons.append(f"还有 {unresolved_block_risks} 条未处理的高风险提示")
    return reasons
