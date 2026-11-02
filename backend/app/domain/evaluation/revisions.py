"""Pure immutable case replacement/deletion; no database or model dependencies."""

from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any


def revise_cases(
    original: Sequence[dict[str, Any]],
    updates: Sequence[tuple[int, Mapping[str, Any]]],
    deleted: Sequence[int],
) -> list[dict[str, Any]]:
    changed = [index for index, _ in updates]
    if not changed and not deleted:
        raise ValueError("至少修改或删除一条样本")
    if len(set(changed)) != len(changed) or len(set(deleted)) != len(deleted):
        raise ValueError("样本序号不能重复")
    if set(changed) & set(deleted):
        raise ValueError("同一条样本不能同时修改和删除")
    if any(
        type(index) is not int or not 0 <= index < len(original)
        for index in [*changed, *deleted]
    ):
        raise ValueError("样本序号不存在")
    replacements = dict(updates)
    result = [
        deepcopy(dict(replacements.get(index, case)))
        for index, case in enumerate(original)
        if index not in deleted
    ]
    if not result:
        raise ValueError("评测集至少保留一条样本")
    return result
