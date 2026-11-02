import importlib.util
from pathlib import Path
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.models.product import ProductCreate, ProductUpdate


@pytest.mark.parametrize(
    "category, expected",
    [
        ("香水", "perfume"),
        (" 护肤 ", "skincare"),
        ("彩妆", "makeup"),
        ("家居香氛", "home_fragrance"),
        ("其他", "other"),
        (" 香膏 ", "香膏"),
        ("perfume", "perfume"),
        ("skincare", "skincare"),
        ("makeup", "makeup"),
        ("home_fragrance", "home_fragrance"),
        ("other", "other"),
        ("A  B", "A  B"),
        ("香" * 30, "香" * 30),
        ("🌸" * 30, "🌸" * 30),
    ],
)
def test_product_category_normalizes_only_exact_chinese_presets(
    category: str, expected: str
) -> None:
    assert ProductCreate(name="香膏", category=category).category == expected
    assert ProductUpdate(category=category).category == expected


@pytest.mark.parametrize(
    "category",
    [
        "",
        " ",
        "香" * 31,
        "🌸" * 31,
        "香\n膏",
        "\n香膏",
        "香膏\r",
        "香\t膏",
        "香\x00膏",
        "香\u200b膏",
        "香\u2028膏",
        "香\u2029膏",
        1,
        [],
        {},
    ],
)
def test_product_category_rejects_bad_inputs(category: object) -> None:
    for schema, body in (
        (ProductCreate, {"name": "香膏", "category": category}),
        (ProductUpdate, {"category": category}),
    ):
        with pytest.raises(ValidationError):
            schema.model_validate(body)


def test_category_defaults_and_optional_patch_preserve_compatibility() -> None:
    assert ProductCreate(name="商品").category == "other"
    assert ProductUpdate().category is None
    assert ProductUpdate(category=None).category is None
    with pytest.raises(ValidationError):
        ProductCreate.model_validate({"name": "商品", "category": None})


def test_product_category_downgrade_normalizes_before_restoring_constraint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = (
        Path(__file__).parents[2]
        / "app/alembic/versions/d4f8b2c6e0a3_custom_product_categories.py"
    )
    spec = importlib.util.spec_from_file_location("product_category_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    operation = Mock()
    monkeypatch.setattr(module, "op", operation)
    module.upgrade()
    operation.drop_constraint.assert_called_once_with(
        "ck_product_category", "product", type_="check"
    )
    module.downgrade()
    assert [call[0] for call in operation.mock_calls] == [
        "drop_constraint",
        "execute",
        "create_check_constraint",
    ]
    assert "UPDATE product SET category='other'" in str(
        operation.execute.call_args.args[0]
    )
    operation.create_check_constraint.assert_called_once_with(
        "ck_product_category", "product", module.PRESETS
    )
