"""Members submit notes or a new text/metadata version; every result remains pending."""

import uuid

from sqlmodel import Session

from app.models import KbDocument, ReviewAction
from app.models.knowledge import KnowledgeNoteCreate, KnowledgeTextVersion
from app.services import knowledge as kb
from app.services.chunking import chunk_text
from app.services.errors import InvalidInputError


def create_note(
    *,
    session: Session,
    brand_id: uuid.UUID,
    user_id: uuid.UUID,
    data: KnowledgeNoteCreate,
) -> KbDocument:
    doc = kb._new_version_row(
        session=session,
        brand_id=brand_id,
        supersedes=None,
        title=data.title,
        doc_type=data.doc_type.value,
        filename="note.txt",
        content=data.text.encode(),
        user_id=user_id,
    )
    doc.source_kind = "note"
    doc.source_description = data.source_description.strip()
    session.add(doc)
    session.flush()
    session.add_all(kb._make_chunks(doc, chunk_text(data.text), None))
    kb._add_review(session, doc, ReviewAction.SUBMIT, user_id)
    kb._commit(session)
    session.refresh(doc)
    return doc


def text_version(
    *,
    session: Session,
    source: KbDocument,
    user_id: uuid.UUID,
    data: KnowledgeTextVersion,
) -> KbDocument:
    description = (
        data.source_description
        if "source_description" in data.model_fields_set
        else source.source_description
    )
    if source.source_kind == "note" and not (description and description.strip()):
        raise InvalidInputError("临时来源必须填写来源说明")
    chunks = kb._chunks_of(session, source)
    pieces = (
        chunk_text(data.text)
        if data.text is not None
        else [chunk.content for chunk in chunks]
    )
    if not pieces:
        raise InvalidInputError("资料正文不能为空")
    doc = kb._new_version_row(
        session=session,
        brand_id=source.brand_id,
        supersedes=source,
        title=data.title or source.title,
        doc_type=data.doc_type.value if data.doc_type else source.doc_type,
        filename=source.source_filename or "note.txt",
        content=data.text.encode() if data.text is not None else b"",
        user_id=user_id,
    )
    doc.source_kind, doc.source_description = source.source_kind, description
    if data.text is None:
        doc.checksum = source.checksum
    session.add(doc)
    session.flush()
    session.add_all(kb._make_chunks(doc, pieces, None))
    kb._add_review(session, doc, ReviewAction.SUBMIT, user_id)
    kb._commit(session)
    session.refresh(doc)
    return doc
