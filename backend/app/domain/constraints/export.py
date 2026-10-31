"""Copy formats for the publish page (ADR-005): title, body and tags are copied separately."""

from dataclasses import dataclass

from app.domain.constraints.length import (
    body_units,
    normalize_tag,
    tags_units,
    title_weight,
)

# The publish page appends this invisible suffix to topics inserted with its "# 话题" button.
HIDDEN_TOPIC_SUFFIX = "[话题]#"


@dataclass(frozen=True)
class XhsParts:
    title: str
    body: str
    tags: list[str]  # names without ``#``
    tags_text: str  # "#标签1 #标签2", single spaces; pasting it does NOT create topics
    title_weight: float
    body_units: int
    tags_units: int
    tag_count: int


def to_xhs_parts(title: str, body: str, tags: list[str]) -> XhsParts:
    """The three independently copyable parts plus their counts (contract ``xhs_parts``)."""
    names = [name for name in (normalize_tag(t) for t in tags) if name]
    return XhsParts(
        title=title.strip(),
        body=body.strip(),
        tags=names,
        tags_text=" ".join(f"#{name}" for name in names),
        title_weight=title_weight(title.strip()),
        body_units=body_units(body.strip()),
        tags_units=tags_units(names),
        tag_count=len(names),
    )


def strip_hidden_topic_suffix(text: str) -> str:
    """Remove the invisible ``[话题]#`` suffix from text copied out of the publish page.

    Tag names are kept: ``#春日香氛[话题]#`` becomes ``#春日香氛``.
    """
    return text.replace(HIDDEN_TOPIC_SUFFIX, "")
