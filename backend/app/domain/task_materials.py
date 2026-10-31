"""Limits for immutable material supplied to a single task."""

MAX_MATERIALS = 5
MAX_MATERIAL_CHARS = 50_000


class MaterialCountExceeded(ValueError):
    pass


class MaterialTextTooLong(ValueError):
    pass


def validate_material_count(count: int) -> None:
    if count >= MAX_MATERIALS:
        raise MaterialCountExceeded(count)


def validate_material_length(text: str) -> None:
    # Like pasted task material: Unicode code points, including line breaks.
    if len(text) > MAX_MATERIAL_CHARS:
        raise MaterialTextTooLong(len(text))
