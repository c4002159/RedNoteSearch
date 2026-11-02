import importlib.util
import uuid
from pathlib import Path
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.domain.viral_revisions import structures_stale
from app.models.viral import ViralSample, ViralSampleUpdate


@pytest.mark.parametrize(
    "revision,rows,expected",
    [
        (0, [], False),
        (0, [0], False),
        (1, [0], True),
        (2, [0, 1], True),
        (2, [0, 2], False),
        (0, [None], True),
    ],
)
def test_staleness_requires_no_structure_for_current_revision(
    revision: int, rows: list[int | None], expected: bool
) -> None:
    assert structures_stale(revision, rows) is expected


@pytest.mark.parametrize(
    "body",
    [
        {"text": None},
        {"text": " "},
        {"text": "字" * 5001},
        {"source_url": "javascript:bad"},
        {"note": "not editable"},
        {"brand_id": str(uuid.uuid4())},
    ],
)
def test_patch_validation(body: dict) -> None:
    with pytest.raises(ValidationError):
        ViralSampleUpdate.model_validate(body)


def test_legacy_migration_backfills_zero_and_is_reversible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file = (
        Path(__file__).parents[2]
        / "app/alembic/versions/b2d6f0a4c8e1_add_viral_sample_revisions.py"
    )
    spec = importlib.util.spec_from_file_location("viral_revision_migration", file)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    operations = Mock()
    monkeypatch.setattr(module, "op", operations)
    module.upgrade()
    operations.execute.assert_called_once_with(
        "UPDATE viral_pattern SET sample_revision = 0"
    )
    sample_column = operations.add_column.call_args_list[0].args[1]
    assert sample_column.name == "revision" and not sample_column.nullable
    assert module.down_revision == "a1c5e9b3d7f2"
    assert ViralSample(brand_id=uuid.uuid4(), text="旧样本").revision == 0
    assert structures_stale(0, [0]) is False
    module.downgrade()
    assert operations.drop_column.call_count == 2
