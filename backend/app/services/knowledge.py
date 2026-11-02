"""Knowledge base use cases: ingest, versions, review, deactivate, reindex and reading.

Visibility rule enforced here and in ``knowledge_search``: only ``approved`` + ``is_current`` +
``index_status = ready`` documents are searchable. Pending, rejected and deactivated documents never
are. Embedding happens before anything is committed, so a model outage leaves no half-indexed state.
"""

import hashlib
import uuid
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.models import (
    DocumentStatus,
    IndexStatus,
    KbChunk,
    KbDocument,
    KbReview,
    ReviewAction,
)
from app.ports.embedding import EmbeddingProvider
from app.services.audit import record_audit
from app.services.chunking import chunk_text
from app.services.errors import ConflictError, InvalidStateError, NotFoundError
from app.services.parsing import parse_document
from app.services.search import contains_any


def get_document(*, session: Session, document_id: uuid.UUID) -> KbDocument:
    doc = session.get(KbDocument, document_id)
    if doc is None:
        raise NotFoundError("Document not found")
    return doc


def _latest_version(session: Session, group_id: uuid.UUID) -> KbDocument | None:
    return session.exec(
        select(KbDocument)
        .where(KbDocument.group_id == group_id)
        .order_by(col(KbDocument.version).desc())
    ).first()


def _make_chunks(
    doc: KbDocument, pieces: list[str], vectors: list[list[float]] | None
) -> list[KbChunk]:
    return [
        KbChunk(
            brand_id=doc.brand_id,
            document_id=doc.id,
            chunk_index=i,
            content=text,
            embedding=vectors[i] if vectors else None,
            meta={"chars": len(text), "title": doc.title, "version": doc.version},
            token_count=None,
        )
        for i, text in enumerate(pieces)
    ]


def _add_review(
    session: Session,
    doc: KbDocument,
    action: ReviewAction,
    actor_id: uuid.UUID,
    reason: str | None = None,
) -> None:
    detail: dict[str, object] = {"title": doc.title, "version": doc.version}
    if reason:
        detail["reason"] = reason
    session.add(
        KbReview(
            document_id=doc.id, action=action.value, actor_id=actor_id, reason=reason
        )
    )
    record_audit(
        session,
        action=f"knowledge.{action.value}",
        entity_type="kb_document",
        actor_id=actor_id,
        brand_id=doc.brand_id,
        entity_id=doc.id,
        detail=detail,
    )


def _new_version_row(
    *,
    session: Session,
    brand_id: uuid.UUID,
    supersedes: KbDocument | None,
    title: str,
    doc_type: str,
    filename: str,
    content: bytes,
    user_id: uuid.UUID,
) -> KbDocument:
    if supersedes is not None and supersedes.brand_id != brand_id:
        # Same answer as a missing document: do not reveal other brands' documents.
        raise NotFoundError("Document to supersede not found")
    previous = _latest_version(session, supersedes.group_id) if supersedes else None
    return KbDocument(
        group_id=supersedes.group_id if supersedes else uuid.uuid4(),
        brand_id=brand_id,
        title=title,
        doc_type=doc_type,
        version=previous.version + 1 if previous else 1,
        supersedes_id=previous.id if previous else None,
        source_filename=filename[:300],
        checksum=hashlib.sha256(content).hexdigest(),
        submitted_by=user_id,
    )


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as exc:  # two uploads raced for the same version number
        session.rollback()
        raise ConflictError("The document was changed concurrently, try again") from exc


def _make_current(session: Session, doc: KbDocument) -> None:
    for other in session.exec(
        select(KbDocument).where(
            KbDocument.group_id == doc.group_id,
            col(KbDocument.is_current).is_(True),
            KbDocument.id != doc.id,
        )
    ).all():
        other.is_current = False
        session.add(other)
    doc.is_current = True


def ingest_direct(
    *,
    session: Session,
    embedder: EmbeddingProvider,
    brand_id: uuid.UUID,
    user_id: uuid.UUID,
    title: str,
    doc_type: str,
    filename: str,
    content: bytes,
    supersedes: KbDocument | None = None,
) -> KbDocument:
    """Admin direct ingest: parse, chunk, embed, then store as an approved, current, indexed version."""
    pieces = chunk_text(parse_document(filename, content))
    vectors = embedder.embed(pieces)
    doc = _new_version_row(
        session=session,
        brand_id=brand_id,
        supersedes=supersedes,
        title=title,
        doc_type=doc_type,
        filename=filename,
        content=content,
        user_id=user_id,
    )
    doc.status = DocumentStatus.APPROVED.value
    doc.index_status = IndexStatus.READY.value
    session.add(doc)
    session.flush()
    session.add_all(_make_chunks(doc, pieces, vectors))
    _make_current(session, doc)
    _add_review(session, doc, ReviewAction.ADMIN_DIRECT_INGEST, user_id)
    _commit(session)
    session.refresh(doc)
    return doc


def submit_for_review(
    *,
    session: Session,
    brand_id: uuid.UUID,
    user_id: uuid.UUID,
    title: str,
    doc_type: str,
    filename: str,
    content: bytes,
    supersedes: KbDocument | None = None,
) -> KbDocument:
    """Operator submission: parsed and chunked now, embedded only when an admin approves."""
    pieces = chunk_text(parse_document(filename, content))
    doc = _new_version_row(
        session=session,
        brand_id=brand_id,
        supersedes=supersedes,
        title=title,
        doc_type=doc_type,
        filename=filename,
        content=content,
        user_id=user_id,
    )
    session.add(
        doc
    )  # status pending_review, not current, index pending (model defaults)
    session.flush()
    session.add_all(_make_chunks(doc, pieces, None))
    _add_review(session, doc, ReviewAction.SUBMIT, user_id)
    _commit(session)
    session.refresh(doc)
    return doc


def _chunks_of(session: Session, doc: KbDocument) -> list[KbChunk]:
    return list(
        session.exec(
            select(KbChunk)
            .where(KbChunk.document_id == doc.id)
            .order_by(col(KbChunk.chunk_index))
        ).all()
    )


def _embed_chunks(
    session: Session, doc: KbDocument, embedder: EmbeddingProvider
) -> None:
    chunks = _chunks_of(session, doc)
    vectors = embedder.embed([c.content for c in chunks])
    for chunk, vector in zip(chunks, vectors, strict=True):
        chunk.embedding = vector
        session.add(chunk)
    doc.index_status = IndexStatus.READY.value


def review_document(
    *,
    session: Session,
    embedder: EmbeddingProvider,
    doc: KbDocument,
    action: str,
    reason: str | None,
    reviewer_id: uuid.UUID,
) -> KbDocument:
    """Approve or reject a pending document. Approval embeds the chunks and makes the version current."""
    if doc.status != DocumentStatus.PENDING_REVIEW.value:
        raise InvalidStateError(
            "Only documents pending review can be reviewed",
            {"current_state": doc.status},
        )
    if action == "approve":
        _embed_chunks(session, doc, embedder)  # raises before any state change
        doc.status = DocumentStatus.APPROVED.value
        _make_current(session, doc)
        _add_review(session, doc, ReviewAction.APPROVE, reviewer_id, reason)
    else:
        doc.status = DocumentStatus.REJECTED.value
        _add_review(session, doc, ReviewAction.REJECT, reviewer_id, reason)
    session.add(doc)
    _commit(session)
    session.refresh(doc)
    return doc


def deactivate_document(
    *,
    session: Session,
    doc: KbDocument,
    actor_id: uuid.UUID,
    reason: str | None = None,
) -> KbDocument:
    """Stop the document from being retrieved by new tasks. Nothing is deleted."""
    if doc.status != DocumentStatus.APPROVED.value:
        raise InvalidStateError(
            "Only approved documents can be deactivated", {"current_state": doc.status}
        )
    doc.status = DocumentStatus.DEACTIVATED.value
    doc.is_current = False
    session.add(doc)
    _add_review(session, doc, ReviewAction.DEACTIVATE, actor_id, reason)
    _commit(session)
    session.refresh(doc)
    return doc


def reindex_document(
    *,
    session: Session,
    embedder: EmbeddingProvider,
    doc: KbDocument,
    actor_id: uuid.UUID,
) -> KbDocument:
    """Re-embed the stored chunks of an approved document. A model failure marks the index failed."""
    if doc.status != DocumentStatus.APPROVED.value:
        raise InvalidStateError(
            "Only approved documents can be reindexed", {"current_state": doc.status}
        )
    try:
        _embed_chunks(session, doc, embedder)
    except Exception:
        session.rollback()
        doc.index_status = IndexStatus.FAILED.value  # not searchable until it succeeds
        session.add(doc)
        session.commit()
        raise
    session.add(doc)
    record_audit(
        session,
        action="knowledge.reindex",
        entity_type="kb_document",
        actor_id=actor_id,
        brand_id=doc.brand_id,
        entity_id=doc.id,
        detail={"title": doc.title, "version": doc.version},
    )
    _commit(session)
    session.refresh(doc)
    return doc


def list_documents(
    *,
    session: Session,
    brand_id: uuid.UUID,
    status: str | None,
    doc_type: str | None,
    page: int,
    page_size: int,
    q: str | None = None,
) -> tuple[list[KbDocument], int]:
    where: list[Any] = [KbDocument.brand_id == brand_id]
    match = contains_any(q, col(KbDocument.title), col(KbDocument.source_filename))
    if match is not None:
        where.append(match)
    if status:
        where.append(KbDocument.status == status)
    if doc_type:
        where.append(KbDocument.doc_type == doc_type)
    total = session.exec(
        select(func.count()).select_from(KbDocument).where(*where)
    ).one()
    rows = session.exec(
        select(KbDocument)
        .where(*where)
        .order_by(col(KbDocument.created_at).desc(), col(KbDocument.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def list_versions(*, session: Session, doc: KbDocument) -> list[KbDocument]:
    return list(
        session.exec(
            select(KbDocument)
            .where(KbDocument.group_id == doc.group_id)
            .order_by(col(KbDocument.version))
        ).all()
    )


def list_reviews(*, session: Session, doc: KbDocument) -> list[KbReview]:
    return list(
        session.exec(
            select(KbReview)
            .where(KbReview.document_id == doc.id)
            .order_by(col(KbReview.created_at), col(KbReview.id))
        ).all()
    )


def list_chunks(
    *, session: Session, doc: KbDocument, page: int, page_size: int
) -> tuple[list[KbChunk], int]:
    total = session.exec(
        select(func.count()).select_from(KbChunk).where(KbChunk.document_id == doc.id)
    ).one()
    rows = session.exec(
        select(KbChunk)
        .where(KbChunk.document_id == doc.id)
        .order_by(col(KbChunk.chunk_index))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total
