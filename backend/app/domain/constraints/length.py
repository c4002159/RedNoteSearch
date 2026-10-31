"""Character counting that matches the Xiaohongshu publish page (ADR-004, ADR-005).

This module is the single authoritative implementation; the frontend mirrors it for live hints and the
backend verdict wins. Assumptions still to be verified on the publish page are marked ``UNVERIFIED``.
"""

TITLE_LIMIT = 20
BODY_LIMIT = 1000
TAG_LIMIT = 10


def title_weight(text: str) -> float:
    """Weighted title length: ASCII printable characters (U+0020 to U+007E) count 0.5, all others 1.

    UNVERIFIED: full-width punctuation, Chinese brackets, spaces and emoji in titles are assumed to
    follow this same rule ("anything outside ASCII printable counts 1").
    """
    half_units = sum(1 if " " <= ch <= "~" else 2 for ch in text)
    return half_units / 2


def utf16_units(text: str) -> int:
    """Number of UTF-16 code units, like JavaScript's ``string.length`` (an emoji is 2)."""
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def body_units(text: str) -> int:
    """Body length: UTF-16 code units after removing every ``\\n`` (line breaks do not count).

    Other characters, including ``\\r``, count; models rarely emit ``\\r`` and counting it errs on
    the safe (longer) side.
    """
    return utf16_units(text.replace("\n", ""))


def normalize_tag(tag: str) -> str:
    """Tag name without a leading ``#`` and surrounding whitespace."""
    return tag.strip().lstrip("#").strip()


def tag_visible_units(tag: str) -> int:
    """Visible cost of one tag in the body budget: ``#`` + name + one separating space (ADR-004).

    UNVERIFIED: how the publish page counts the spaces between topics; this is the conservative
    estimate from ADR-004.
    """
    return 1 + utf16_units(normalize_tag(tag)) + 1


def tags_units(tags: list[str]) -> int:
    return sum(tag_visible_units(t) for t in tags)
