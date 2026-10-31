import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from app.api.brand_deps import BrandAccess, BrandAccessDep, BrandAdminDep
from app.api.deps import CurrentUser, SessionDep
from app.infra.dashscope import DashScopeEmbeddingProvider
from app.models import (
    BrandMember,
    ChunkPublic,
    ChunksPublic,
    DocumentDetail,
    DocumentPublic,
    DocumentsPublic,
    DocumentStatus,
    DocumentType,
    DocumentVersionRef,
    KbDocument,
    MemberRole,
    ReviewCreate,
    ReviewPublic,
)
from app.ports.embedding import EmbeddingProvider
from app.services import knowledge as kb
from app.services.errors import NotFoundError
from app.services.parsing import check_size, size_limit_for

router = APIRouter(tags=["knowledge"])


def get_embedder() -> EmbeddingProvider:
    """Overridden in tests with a fake; the real one calls Bailian text-embedding-v4."""
    return DashScopeEmbeddingProvider()


EmbedderDep = Annotated[EmbeddingProvider, Depends(get_embedder)]


def get_document_access(
    document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> tuple[KbDocument, BrandAccess]:
    """Resource-id access: the brand comes from the stored document.

    A missing document and a document of a brand the caller is not a member of both give 404, so
    other brands' documents cannot be discovered by id.
    """
    doc = session.get(KbDocument, document_id)
    member = (
        session.get(BrandMember, (doc.brand_id, current_user.id))
        if doc is not None
        else None
    )
    if doc is None or member is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc, BrandAccess(
        brand_id=doc.brand_id, user_id=current_user.id, role=MemberRole(member.role)
    )


def get_document_admin(
    access: Annotated[tuple[KbDocument, BrandAccess], Depends(get_document_access)],
) -> KbDocument:
    doc, brand_access = access
    if brand_access.role != MemberRole.ADMIN:
        raise HTTPException(status_code=403, detail="Brand admin role required")
    return doc


DocumentAdminDep = Annotated[KbDocument, Depends(get_document_admin)]


def _read_upload(file: UploadFile) -> tuple[str, bytes]:
    """Read an upload, refusing a type that is not allowed or a file over the limit of its type."""
    filename = file.filename or "upload"
    limit = size_limit_for(
        filename
    )  # unsupported type: refused before reading anything
    content = file.file.read(limit + 1)
    check_size(filename, len(content))
    return filename, content


def _public(doc: KbDocument) -> DocumentPublic:
    return DocumentPublic.model_validate(doc, from_attributes=True)


TitleForm = Annotated[str, Form(min_length=1, max_length=200)]


@router.post(
    "/brands/{brand_id}/knowledge-documents",
    response_model=DocumentPublic,
    status_code=201,
)
def ingest_document(
    access: BrandAdminDep,
    session: SessionDep,
    embedder: EmbedderDep,
    title: TitleForm,
    doc_type: Annotated[DocumentType, Form()],
    file: Annotated[UploadFile, File()],
) -> DocumentPublic:
    """Admin direct ingest: approved and searchable once parsing and indexing succeed."""
    filename, content = _read_upload(file)
    doc = kb.ingest_direct(
        session=session,
        embedder=embedder,
        brand_id=access.brand_id,
        user_id=access.user_id,
        title=title,
        doc_type=doc_type.value,
        filename=filename,
        content=content,
    )
    return _public(doc)


@router.post(
    "/knowledge-documents/{document_id}/versions",
    response_model=DocumentPublic,
    status_code=201,
)
def ingest_new_version(
    doc: DocumentAdminDep,
    session: SessionDep,
    access: Annotated[tuple[KbDocument, BrandAccess], Depends(get_document_access)],
    embedder: EmbedderDep,
    title: TitleForm,
    doc_type: Annotated[DocumentType, Form()],
    file: Annotated[UploadFile, File()],
) -> DocumentPublic:
    """Admin submits a new version of an existing document; it becomes the current version."""
    filename, content = _read_upload(file)
    new = kb.ingest_direct(
        session=session,
        embedder=embedder,
        brand_id=doc.brand_id,
        user_id=access[1].user_id,
        title=title,
        doc_type=doc_type.value,
        filename=filename,
        content=content,
        supersedes=doc,
    )
    return _public(new)


@router.post(
    "/brands/{brand_id}/knowledge-submissions",
    response_model=DocumentPublic,
    status_code=201,
)
def submit_document(
    access: BrandAccessDep,
    session: SessionDep,
    title: TitleForm,
    doc_type: Annotated[DocumentType, Form()],
    file: Annotated[UploadFile, File()],
    supersedes_document_id: Annotated[uuid.UUID | None, Form()] = None,
) -> DocumentPublic:
    """Any member submits material for review. It is not searchable until an admin approves it."""
    filename, content = _read_upload(file)
    supersedes = None
    if supersedes_document_id is not None:
        supersedes = kb.get_document(
            session=session, document_id=supersedes_document_id
        )
        if supersedes.brand_id != access.brand_id:
            raise NotFoundError("Document to supersede not found")
    doc = kb.submit_for_review(
        session=session,
        brand_id=access.brand_id,
        user_id=access.user_id,
        title=title,
        doc_type=doc_type.value,
        filename=filename,
        content=content,
        supersedes=supersedes,
    )
    return _public(doc)


@router.get("/brands/{brand_id}/knowledge-documents", response_model=DocumentsPublic)
def read_documents(
    access: BrandAccessDep,
    session: SessionDep,
    status: DocumentStatus | None = None,
    doc_type: DocumentType | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> DocumentsPublic:
    rows, total = kb.list_documents(
        session=session,
        brand_id=access.brand_id,
        status=status.value if status else None,
        doc_type=doc_type.value if doc_type else None,
        page=page,
        page_size=page_size,
    )
    return DocumentsPublic(
        items=[_public(d) for d in rows], total=total, page=page, page_size=page_size
    )


@router.get("/knowledge-documents/{document_id}", response_model=DocumentDetail)
def read_document(
    access: Annotated[tuple[KbDocument, BrandAccess], Depends(get_document_access)],
    session: SessionDep,
) -> DocumentDetail:
    doc = access[0]
    return DocumentDetail(
        **_public(doc).model_dump(),
        versions=[
            DocumentVersionRef.model_validate(v, from_attributes=True)
            for v in kb.list_versions(session=session, doc=doc)
        ],
        reviews=[
            ReviewPublic.model_validate(r, from_attributes=True)
            for r in kb.list_reviews(session=session, doc=doc)
        ],
    )


@router.get("/knowledge-documents/{document_id}/chunks", response_model=ChunksPublic)
def read_chunks(
    doc: DocumentAdminDep,
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ChunksPublic:
    rows, total = kb.list_chunks(
        session=session, doc=doc, page=page, page_size=page_size
    )
    return ChunksPublic(
        items=[
            ChunkPublic(
                id=c.id, chunk_index=c.chunk_index, content=c.content, metadata=c.meta
            )
            for c in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/knowledge-documents/{document_id}/reindex",
    response_model=DocumentPublic,
    status_code=202,
)
def reindex_document(
    doc: DocumentAdminDep,
    session: SessionDep,
    access: Annotated[tuple[KbDocument, BrandAccess], Depends(get_document_access)],
    embedder: EmbedderDep,
) -> DocumentPublic:
    return _public(
        kb.reindex_document(
            session=session, embedder=embedder, doc=doc, actor_id=access[1].user_id
        )
    )


@router.post(
    "/knowledge-documents/{document_id}/reviews", response_model=DocumentPublic
)
def review_document(
    doc: DocumentAdminDep,
    session: SessionDep,
    access: Annotated[tuple[KbDocument, BrandAccess], Depends(get_document_access)],
    embedder: EmbedderDep,
    body: ReviewCreate,
) -> DocumentPublic:
    reviewed = kb.review_document(
        session=session,
        embedder=embedder,
        doc=doc,
        action=body.action,
        reason=body.reason,
        reviewer_id=access[1].user_id,
    )
    return _public(reviewed)


@router.post(
    "/knowledge-documents/{document_id}/deactivate", response_model=DocumentPublic
)
def deactivate_document(
    doc: DocumentAdminDep,
    session: SessionDep,
    access: Annotated[tuple[KbDocument, BrandAccess], Depends(get_document_access)],
) -> DocumentPublic:
    return _public(
        kb.deactivate_document(session=session, doc=doc, actor_id=access[1].user_id)
    )
