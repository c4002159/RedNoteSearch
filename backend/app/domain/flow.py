"""Process states of a task or a generation version and the rules for moving between them.

``ready_to_copy`` means an operator confirmed the text; it does not mean the text is compliant
(contract section 5). Everything here is a pure function over plain values.
"""

import enum
from dataclasses import dataclass


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


@dataclass(frozen=True)
class Blocker:
    """One reason a version cannot be confirmed: a stable ``code`` for the UI and a readable message."""

    code: str
    message: str


def confirm_blockers(
    *,
    status: FlowStatus,
    constraints_passed: bool,
    unresolved_block_risks: int,
    checks_run_on_final_text: bool,
    unconfirmed_claims: int = 0,
    rejected_claims: int = 0,
) -> list[Blocker]:
    """Reasons why a version cannot become ``ready_to_copy`` yet; empty means it may.

    Contract: only when constraints passed, no unresolved ``block``-level risk remains, and every check
    ran on the final text. Human in the loop: every claim without system support needs a person's
    decision. A person who vouches for a claim lets it through (and it is labelled as human-confirmed);
    a claim a person rejected, or nobody has decided on, blocks the confirmation.
    """
    blockers: list[Blocker] = []
    if not can_transition(status, FlowStatus.READY_TO_COPY):
        blockers.append(
            Blocker("status_not_confirmable", f"状态 {status.value} 不能确认")
        )
    if not checks_run_on_final_text:
        blockers.append(Blocker("checks_not_run", "检查尚未针对最终文本运行"))
    if not constraints_passed:
        blockers.append(Blocker("constraints_failed", "约束检查未通过"))
    if unresolved_block_risks > 0:
        blockers.append(
            Blocker(
                "open_block_risks",
                f"还有 {unresolved_block_risks} 条未处理的高风险提示",
            )
        )
    if rejected_claims > 0:
        blockers.append(
            Blocker(
                "rejected_claims",
                f"有 {rejected_claims} 条说法被人工判定为不成立，请改写后重新检查",
            )
        )
    if unconfirmed_claims > 0:
        blockers.append(
            Blocker(
                "unconfirmed_claims",
                f"还有 {unconfirmed_claims} 条没有依据的说法需要人工确认（或改写后重新检查）",
            )
        )
    return blockers
