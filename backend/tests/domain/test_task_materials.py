import pytest

from app.domain.task_materials import (
    MaterialCountExceeded,
    MaterialTextTooLong,
    validate_material_count,
    validate_material_length,
)


def test_material_limits_count_codepoints_including_newlines() -> None:
    validate_material_count(4)
    with pytest.raises(MaterialCountExceeded):
        validate_material_count(5)
    text = "😀\n" * 25_000
    validate_material_length(text)
    with pytest.raises(MaterialTextTooLong):
        validate_material_length(text + "界")
