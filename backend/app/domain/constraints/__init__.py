"""Length rules, constraint checks and copy formats for generated notes (ADR-004, ADR-005)."""

from app.domain.constraints.checks import (
    ConstraintCode,
    ConstraintConfig,
    ConstraintCounts,
    ConstraintIssue,
    ConstraintResult,
    check_note,
    check_title,
    forbidden_word_issues,
)
from app.domain.constraints.export import (
    HIDDEN_TOPIC_SUFFIX,
    XhsParts,
    strip_hidden_topic_suffix,
    to_xhs_parts,
)
from app.domain.constraints.length import (
    BODY_LIMIT,
    TAG_LIMIT,
    TITLE_LIMIT,
    body_units,
    normalize_tag,
    tag_visible_units,
    tags_units,
    title_weight,
    utf16_units,
)

__all__ = [
    "BODY_LIMIT",
    "HIDDEN_TOPIC_SUFFIX",
    "TAG_LIMIT",
    "TITLE_LIMIT",
    "ConstraintCode",
    "ConstraintConfig",
    "ConstraintCounts",
    "ConstraintIssue",
    "ConstraintResult",
    "XhsParts",
    "body_units",
    "check_note",
    "check_title",
    "forbidden_word_issues",
    "normalize_tag",
    "strip_hidden_topic_suffix",
    "tag_visible_units",
    "tags_units",
    "title_weight",
    "to_xhs_parts",
    "utf16_units",
]
