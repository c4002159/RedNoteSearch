"""Reuse approval embeddings for optional hints and commit a reviewer decision atomically."""

import uuid

from sqlmodel import Session, col, select

from app.models import KbDocument, ReviewAction
from app.models.knowledge import ReviewCreate
from app.models.knowledge_similarity import SimilarityPreview
from app.ports.embedding import EmbeddingProvider
from app.services import knowledge as kb
from app.services.errors import (
    InvalidInputError,
    InvalidStateError,
    ModelUnavailableError,
    NotFoundError,
)
from app.services.knowledge_similarity import (
    SimilarContentRequired,
    acknowledged,
    compare_vectors,
)


def review(
    *,
    session: Session,
    doc: KbDocument,
    user_id: uuid.UUID,
    data: ReviewCreate,
    embedder: EmbeddingProvider,
) -> tuple[KbDocument, SimilarityPreview | None]:
    if doc.status != "pending_review":
        raise InvalidStateError("只有待审资料可以审核")
    if data.action in {"cancel", "reject"}:
        pending = session.exec(
            select(KbDocument)
            .where(KbDocument.id == doc.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()
        if pending is None:
            raise NotFoundError("Document not found")
        doc = pending
        if doc.status != "pending_review":
            raise InvalidStateError("资料已被其他审核处理")
    if data.action == "cancel":
        kb._add_review(
            session, doc, ReviewAction.CANCEL, user_id, data.reason, "cancel"
        )
        kb._commit(session)
        session.refresh(doc)
        return doc, None
    if data.action == "reject":
        return kb.review_document(
            session=session,
            doc=doc,
            embedder=embedder,
            reviewer_id=user_id,
            action="reject",
            reason=data.reason,
        ), None
    # Check requested resources before any chargeable embedding call.
    if data.related_document_ids:
        targets = session.exec(
            select(KbDocument).where(
                col(KbDocument.id).in_(data.related_document_ids),
                KbDocument.brand_id == doc.brand_id,
            )
        ).all()
        if len(targets) != len(data.related_document_ids):
            raise NotFoundError("Document not found")
    chunks = kb._chunks_of(session, doc)
    vectors = embedder.embed([chunk.content for chunk in chunks])
    if len(vectors) != len(chunks):
        raise ModelUnavailableError("入库嵌入未返回完整分块")
    try:
        locked = session.exec(
            select(KbDocument)
            .where(KbDocument.id == doc.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()
        if locked is None:
            raise NotFoundError("Document not found")
        doc = locked
        if doc.status != "pending_review":
            raise InvalidStateError("资料已被其他审核处理")
        report = compare_vectors(session, doc, vectors)
        covered = acknowledged(doc, data.similarity_token)
        current = {str(item.id) for item in report.items}
        if (
            report.status == "ready"
            and current
            and (data.similar_decision is None or not current <= covered)
        ):
            raise SimilarContentRequired(report)
        selected = {str(value) for value in data.related_document_ids}
        if data.similar_decision == "new_wins":
            if not selected <= covered:
                if report.status == "ready":
                    raise SimilarContentRequired(report)
                raise InvalidInputError("请先取得有效的相近资料提示")
            if report.status == "ready" and not selected <= current:
                raise InvalidInputError("指定资料已变化，请重新检查")
            targets = session.exec(
                select(KbDocument)
                .where(
                    col(KbDocument.id).in_(data.related_document_ids),
                    KbDocument.brand_id == doc.brand_id,
                )
                .order_by(col(KbDocument.id))
                .with_for_update()
                .execution_options(populate_existing=True)
            ).all()
            if len(targets) != len(selected):
                raise NotFoundError("Document not found")
            for target in targets:
                if (
                    not target.is_current
                    or target.index_status != "ready"
                    or target.group_id == doc.group_id
                ):
                    raise InvalidInputError("指定资料不属于本次可替代资料")
                kb.deactivate_document(
                    session=session,
                    doc=target,
                    actor_id=user_id,
                    reason=data.reason,
                    commit=False,
                )
        approved = kb.review_document(
            session=session,
            doc=doc,
            embedder=embedder,
            reviewer_id=user_id,
            action="approve",
            reason=data.reason,
            vectors=vectors,
            commit=False,
            similar_decision=data.similar_decision,
            related_document_ids=sorted(selected),
        )
        kb._commit(session)
        session.refresh(approved)
        return approved, report
    except Exception:
        session.rollback()
        raise
