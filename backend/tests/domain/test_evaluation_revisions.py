import pytest
from pydantic import ValidationError

from app.domain.evaluation.revisions import revise_cases
from app.models.evaluation import DatasetRevisionRequest


def test_replace_delete_order_and_input_immutability() -> None:
    original = [{"input": {"text": str(i)}} for i in range(3)]
    updates = [(1, {"input": {"text": "new"}})]
    result = revise_cases(original, updates, [0])
    assert result == [{"input": {"text": "new"}}, {"input": {"text": "2"}}]
    result[0]["input"]["text"] = "changed"
    assert original[1]["input"]["text"] == "1"
    assert updates[0][1]["input"]["text"] == "new"


@pytest.mark.parametrize(
    "updates,deleted",
    [
        ([], []),
        ([(0, {}), (0, {})], []),
        ([], [0, 0]),
        ([(0, {})], [0]),
        ([(2, {})], []),
        ([], [-1]),
        ([], [True]),
        ([], [0, 1]),
    ],
)
def test_invalid_revision_is_rejected(updates: list, deleted: list) -> None:
    with pytest.raises(ValueError):
        revise_cases([{}, {}], updates, deleted)


@pytest.mark.parametrize(
    "body",
    [
        {"brand_id": "other"},
        {"delete_case_indexes": [-1]},
        {"delete_case_indexes": [True]},
        {"updates": [{"case_index": 0, "input": {}, "unknown": "x"}]},
        {"delete_case_indexes": [0] * 201},
    ],
)
def test_request_shape_and_bounds(body: dict) -> None:
    with pytest.raises(ValidationError):
        DatasetRevisionRequest.model_validate(body)
