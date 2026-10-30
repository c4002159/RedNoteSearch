import re

MAX_CHARS = 500
_SENTENCE_END = re.compile(r"(?<=[。！？；!?;])|(?<=\.)\s+")


def _split_long(paragraph: str, max_chars: int) -> list[str]:
    """Split an over-long paragraph at sentence ends, then hard-cut what is still too long."""
    pieces: list[str] = []
    current = ""
    for sentence in filter(None, (s.strip() for s in _SENTENCE_END.split(paragraph))):
        while len(sentence) > max_chars:
            if current:
                pieces.append(current)
                current = ""
            pieces.append(sentence[:max_chars])
            sentence = sentence[max_chars:]
        if current and len(current) + len(sentence) > max_chars:
            pieces.append(current)
            current = ""
        current += sentence
    if current:
        pieces.append(current)
    return pieces


def chunk_text(text: str, *, max_chars: int = MAX_CHARS) -> list[str]:
    """Split text into pieces of at most ``max_chars`` characters, keeping paragraphs together.

    Paragraphs (separated by blank lines) are packed into a chunk until it would exceed the limit;
    a paragraph longer than the limit is split at sentence ends. Empty input gives no chunks.
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        parts = (
            _split_long(paragraph, max_chars)
            if len(paragraph) > max_chars
            else [paragraph]
        )
        for part in parts:
            if current and len(current) + len(part) + 1 > max_chars:
                chunks.append(current)
                current = part
            else:
                current = f"{current}\n{part}" if current else part
    if current:
        chunks.append(current)
    return chunks
