import csv
import io
from pathlib import PurePath

from docx import Document
from pypdf import PdfReader
from pypdf.errors import PyPdfError

from app.services.errors import ParseError

MAX_FILE_BYTES = 10 * 1024 * 1024
SUPPORTED_SUFFIXES = (".pdf", ".docx", ".md", ".txt", ".csv")


def _decode(content: bytes) -> str:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ParseError("The file is not valid UTF-8 or GB18030 text")


def _parse_csv(content: bytes) -> str:
    rows = list(csv.reader(io.StringIO(_decode(content))))
    if not rows:
        return ""
    header, body = rows[0], rows[1:]
    lines = []
    for row in body:
        pairs = [f"{h}：{v}" for h, v in zip(header, row, strict=False) if v.strip()]
        if pairs:
            lines.append("；".join(pairs))
    return "\n\n".join(lines)


def _parse_docx(content: bytes) -> str:
    try:
        document = Document(io.BytesIO(content))
    except Exception as exc:  # python-docx raises several unrelated types on bad files
        raise ParseError("The DOCX file could not be read") from exc
    parts = [p.text for p in document.paragraphs if p.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append("；".join(cells))
    return "\n\n".join(parts)


def _parse_pdf(content: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted:
            raise ParseError("Encrypted PDF files are not supported")
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
    except ParseError:
        raise
    except (PyPdfError, ValueError, KeyError, OSError) as exc:
        raise ParseError("The PDF file could not be read") from exc
    return "\n\n".join(p for p in pages if p)


def parse_document(filename: str, content: bytes) -> str:
    """Extract plain text from an uploaded PDF, DOCX, Markdown, text or CSV file.

    Raises ``ParseError`` for unsupported types, unreadable files and files without any text
    (for example scanned PDFs: OCR is not supported).
    """
    suffix = PurePath(filename).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ParseError(
            f"Unsupported file type, use one of: {', '.join(SUPPORTED_SUFFIXES)}"
        )
    if not content:
        raise ParseError("The file is empty")
    if suffix == ".pdf":
        text = _parse_pdf(content)
    elif suffix == ".docx":
        text = _parse_docx(content)
    elif suffix == ".csv":
        text = _parse_csv(content)
    else:
        text = _decode(content)
    if not text.strip():
        raise ParseError("No text could be extracted from the file")
    return text
