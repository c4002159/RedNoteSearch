"""Task and version states: allowed moves and the conditions for confirming (contract section 5)."""

import pytest

from app.domain.flow import (
    Blocker,
    FlowStatus,
    allowed_transitions,
    can_transition,
    confirm_blockers,
)

S = FlowStatus


def test_every_status_has_a_transition_entry() -> None:
    for status in FlowStatus:
        assert isinstance(allowed_transitions(status), frozenset)


@pytest.mark.parametrize(
    ("current", "target"),
    [
        (S.QUEUED, S.GENERATING),
        (S.GENERATING, S.CHECKING),
        (S.GENERATING, S.CONSTRAINT_FAILED),
        (S.CHECKING, S.CHECKS_COMPLETED),
        (S.CHECKING, S.NEEDS_HUMAN_REVIEW),
        (S.CHECKS_COMPLETED, S.READY_TO_COPY),
        (S.CHECKS_COMPLETED, S.EDITED_PENDING_RECHECK),
        (S.CONSTRAINT_FAILED, S.GENERATING),
        (S.EDITED_PENDING_RECHECK, S.CHECKING),
    ],
)
def test_allowed_moves(current: FlowStatus, target: FlowStatus) -> None:
    assert can_transition(current, target)


@pytest.mark.parametrize(
    ("current", "target"),
    [
        (
            S.QUEUED,
            S.READY_TO_COPY,
        ),  # nothing is confirmed before it was generated and checked
        (S.GENERATING, S.READY_TO_COPY),
        (S.CHECKING, S.READY_TO_COPY),
        (S.CONSTRAINT_FAILED, S.READY_TO_COPY),
        (S.EDITED_PENDING_RECHECK, S.READY_TO_COPY),  # an edit must be rechecked first
        (S.READY_TO_COPY, S.GENERATING),
        (S.READY_TO_COPY, S.CHECKING),
        (S.QUEUED, S.QUEUED),
    ],
)
def test_forbidden_moves(current: FlowStatus, target: FlowStatus) -> None:
    assert not can_transition(current, target)


def test_a_confirmed_version_is_final() -> None:
    assert allowed_transitions(S.READY_TO_COPY) == frozenset()


def test_only_checked_statuses_can_reach_ready_to_copy() -> None:
    reaching = {s for s in FlowStatus if can_transition(s, S.READY_TO_COPY)}
    assert reaching == {S.CHECKS_COMPLETED, S.NEEDS_HUMAN_REVIEW}


def _blockers(**overrides: object) -> list[Blocker]:
    base: dict[str, object] = {
        "status": S.CHECKS_COMPLETED,
        "constraints_passed": True,
        "unresolved_block_risks": 0,
        "checks_run_on_final_text": True,
    }
    return confirm_blockers(**(base | overrides))  # type: ignore[arg-type]


def test_confirm_is_allowed_when_everything_is_in_order() -> None:
    assert _blockers() == []
    assert _blockers(status=S.NEEDS_HUMAN_REVIEW) == []


def test_confirm_reports_every_reason() -> None:
    assert len(_blockers(constraints_passed=False)) == 1
    assert len(_blockers(unresolved_block_risks=2)) == 1
    assert "2" in _blockers(unresolved_block_risks=2)[0].message
    assert len(_blockers(checks_run_on_final_text=False)) == 1
    assert len(_blockers(status=S.GENERATING)) == 1
    everything = _blockers(
        status=S.EDITED_PENDING_RECHECK,
        constraints_passed=False,
        unresolved_block_risks=1,
        checks_run_on_final_text=False,
    )
    assert len(everything) == 4


def test_blockers_have_stable_codes_for_the_interface() -> None:
    everything = _blockers(
        status=S.EDITED_PENDING_RECHECK,
        constraints_passed=False,
        unresolved_block_risks=1,
        checks_run_on_final_text=False,
        unconfirmed_claims=2,
        rejected_claims=1,
    )
    assert [b.code for b in everything] == [
        "status_not_confirmable",
        "checks_not_run",
        "constraints_failed",
        "open_block_risks",
        "rejected_claims",
        "unconfirmed_claims",
    ]
    assert all(b.message for b in everything)


def test_claims_without_support_need_a_person_before_confirming() -> None:
    assert [b.code for b in _blockers(unconfirmed_claims=3)] == ["unconfirmed_claims"]
    assert "3" in _blockers(unconfirmed_claims=3)[0].message
    assert [b.code for b in _blockers(rejected_claims=1)] == ["rejected_claims"]
    assert (
        _blockers(unconfirmed_claims=0, rejected_claims=0) == []
    )  # all supported or vouched for
