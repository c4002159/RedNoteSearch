import uuid
from unittest.mock import Mock

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.models import ComplianceRule
from app.models.rule_batch import RuleBatchState
from app.services.rule_batch import batch_state


@pytest.mark.parametrize(
    "body",
    [
        {"ids": [], "enabled": False, "reason": "理由"},
        {"ids": [str(uuid.uuid4())] * 101, "enabled": False, "reason": "理由"},
        {"ids": [str(uuid.uuid4())], "enabled": "false", "reason": "理由"},
        {"ids": [str(uuid.uuid4())], "enabled": True, "reason": " "},
        {"ids": [str(uuid.uuid4())], "enabled": True, "reason": "字" * 501},
        {
            "ids": [str(uuid.uuid4())],
            "enabled": True,
            "reason": "理由",
            "brand_id": "other",
        },
    ],
)
def test_invalid_batch_shape(body: dict) -> None:
    with pytest.raises(ValidationError):
        RuleBatchState.model_validate(body)


def test_duplicates_and_limit_boundary() -> None:
    item = uuid.uuid4()
    with pytest.raises(ValidationError):
        RuleBatchState(ids=[item, item], enabled=False, reason="理由")
    assert (
        len(
            RuleBatchState(
                ids=[uuid.uuid4() for _ in range(100)], enabled=True, reason=" 理由 "
            ).ids
        )
        == 100
    )
    assert RuleBatchState(ids=[item], enabled=False, reason=" 理由 ").reason == "理由"


def test_database_failure_rolls_back_one_item_and_continues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import rule_batch

    ids = [uuid.uuid4() for _ in range(3)]
    row = ComplianceRule(
        id=ids[2],
        layer="lexicon",
        rule_type="brand_forbidden",
        pattern="样例",
        severity="warn",
        enabled=False,
        rule_version=2,
        is_sample=True,
    )
    session = Mock()
    session.exec.side_effect = [
        SQLAlchemyError("not exposed"),
        Mock(first=lambda: None),
        Mock(first=lambda: row),
    ]
    audit = Mock()
    monkeypatch.setattr(rule_batch, "record_audit", audit)
    result = batch_state(
        session=session,
        brand_id=None,
        actor_id=uuid.uuid4(),
        data=RuleBatchState(ids=ids, enabled=False, reason="理由"),
    )
    assert [item.id for item in result.items] == ids
    assert [item.status_code for item in result.items] == [500, 404, 200]
    assert (
        result.items[2].success
        and not result.items[2].changed
        and result.items[2].rule_version == 2
    )
    assert row.is_sample is True and row.rule_version == 2
    assert session.rollback.call_count == 2 and session.commit.call_count == 1
    assert audit.call_count == 1 and "not exposed" not in result.model_dump_json()
