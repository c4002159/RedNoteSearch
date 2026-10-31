"""Code-decided constraint checks for a generated note (F6). No model is involved."""

import enum
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any

from app.domain.constraints.length import (
    BODY_LIMIT,
    TAG_LIMIT,
    TITLE_LIMIT,
    body_units,
    normalize_tag,
    tags_units,
    title_weight,
)


class ConstraintCode(enum.StrEnum):
    MISSING_FIELD = "missing_field"
    TITLE_TOO_LONG = "title_too_long"
    BODY_TOO_LONG = "body_too_long"
    TOO_MANY_TAGS = "too_many_tags"
    INVALID_TAG = "invalid_tag"
    DUPLICATE_TAG = "duplicate_tag"
    MISSING_REQUIRED_WORD = "missing_required_word"
    FORBIDDEN_WORD = "forbidden_word"


@dataclass(frozen=True)
class ConstraintConfig:
    title_limit: float = TITLE_LIMIT
    body_limit: int = BODY_LIMIT
    tag_limit: int = TAG_LIMIT
    # A structured note always carries topic tags; set to 0 to allow notes without any.
    min_tags: int = 1


@dataclass(frozen=True)
class ConstraintIssue:
    """One failed constraint, pointing at the field and (where relevant) the offending word."""

    field: str
    code: ConstraintCode
    message: str
    details: dict[str, Any] = dataclass_field(default_factory=dict)


@dataclass(frozen=True)
class ConstraintCounts:
    title_weight: float
    body_units: int
    tags_units: int
    tag_count: int
    # body_units + tags_units: what is measured against the 1000 limit.
    body_budget_used: int


@dataclass(frozen=True)
class ConstraintResult:
    issues: tuple[ConstraintIssue, ...]
    counts: ConstraintCounts

    @property
    def passed(self) -> bool:
        return not self.issues


def _find_all(haystack: str, needle: str) -> list[int]:
    positions, start = [], 0
    while (index := haystack.find(needle, start)) != -1:
        positions.append(index)
        start = index + len(needle)
    return positions


def _clean_words(words: list[str] | None) -> list[str]:
    seen: dict[str, None] = {}
    for word in words or []:
        if word.strip():
            seen.setdefault(word.strip(), None)
    return list(seen)


def check_title(
    title: str, config: ConstraintConfig = ConstraintConfig()
) -> list[ConstraintIssue]:
    """Checks that apply to a single title candidate."""
    if not title.strip():
        return [ConstraintIssue("title", ConstraintCode.MISSING_FIELD, "标题不能为空")]
    weight = title_weight(title)
    if weight > config.title_limit:
        return [
            ConstraintIssue(
                "title",
                ConstraintCode.TITLE_TOO_LONG,
                f"标题加权长度 {weight:g} 超过上限 {config.title_limit:g}",
                {"weight": weight, "limit": config.title_limit},
            )
        ]
    return []


def check_note(
    *,
    title: str,
    body: str,
    tags: list[str],
    required_words: list[str] | None = None,
    forbidden_words: list[str] | None = None,
    config: ConstraintConfig = ConstraintConfig(),
) -> ConstraintResult:
    """Run every constraint on one note and report all failures at once.

    ``required_words`` must each appear somewhere in the title, body or tags; ``forbidden_words`` must
    not appear anywhere, and every hit is reported with its field and position. Matching is
    case-insensitive.
    """
    normalized = [normalize_tag(t) for t in tags]
    counts = ConstraintCounts(
        title_weight=title_weight(title),
        body_units=body_units(body),
        tags_units=tags_units(tags),
        tag_count=len(tags),
        body_budget_used=body_units(body) + tags_units(tags),
    )
    issues: list[ConstraintIssue] = check_title(title, config)

    if not body.strip():
        issues.append(
            ConstraintIssue("body", ConstraintCode.MISSING_FIELD, "正文不能为空")
        )
    elif counts.body_budget_used > config.body_limit:
        issues.append(
            ConstraintIssue(
                "body",
                ConstraintCode.BODY_TOO_LONG,
                f"正文 {counts.body_units} 加标签 {counts.tags_units}，"
                f"共 {counts.body_budget_used}，超过上限 {config.body_limit}",
                {
                    "body_units": counts.body_units,
                    "tags_units": counts.tags_units,
                    "used": counts.body_budget_used,
                    "limit": config.body_limit,
                },
            )
        )

    if len(tags) < config.min_tags:
        issues.append(
            ConstraintIssue("tags", ConstraintCode.MISSING_FIELD, "标签不能为空")
        )
    if len(tags) > config.tag_limit:
        issues.append(
            ConstraintIssue(
                "tags",
                ConstraintCode.TOO_MANY_TAGS,
                f"标签 {len(tags)} 个，超过上限 {config.tag_limit}",
                {"count": len(tags), "limit": config.tag_limit},
            )
        )
    seen: set[str] = set()
    for index, name in enumerate(normalized):
        if not name or any(ch.isspace() or ch == "#" for ch in name):
            issues.append(
                ConstraintIssue(
                    "tags",
                    ConstraintCode.INVALID_TAG,
                    "标签不能为空，也不能含空白或 #",
                    {"index": index, "tag": tags[index]},
                )
            )
        elif name.lower() in seen:
            issues.append(
                ConstraintIssue(
                    "tags",
                    ConstraintCode.DUPLICATE_TAG,
                    f"标签重复：{name}",
                    {"index": index, "tag": name},
                )
            )
        seen.add(name.lower())

    fields = {"title": title, "body": body, "tags": " ".join(normalized)}
    full_text = "\n".join(fields.values()).lower()
    for word in _clean_words(required_words):
        if word.lower() not in full_text:
            issues.append(
                ConstraintIssue(
                    "note",
                    ConstraintCode.MISSING_REQUIRED_WORD,
                    f"缺少必含词：{word}",
                    {"word": word},
                )
            )
    for word in _clean_words(forbidden_words):
        for name, text in fields.items():
            for position in _find_all(text.lower(), word.lower()):
                issues.append(
                    ConstraintIssue(
                        name,
                        ConstraintCode.FORBIDDEN_WORD,
                        f"命中禁用词：{word}",
                        {"word": word, "position": position},
                    )
                )
    return ConstraintResult(issues=tuple(issues), counts=counts)
