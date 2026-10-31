"""Independent database ownership diagnostics for the existing retrieval port."""

import uuid
from dataclasses import dataclass

from sqlmodel import Session

from app.models import KbChunk, KbDocument, TaskInput, TaskInputChunk
from app.ports.knowledge import KnowledgeChunk, KnowledgeSearch
from app.services.errors import ModelUnavailableError


@dataclass(frozen=True)
class RetrievalDiagnosis:
    chunks: list[KnowledgeChunk]
    leak_count: int
    checked: bool
    error: str | None = None


def diagnose(
    session: Session, search: KnowledgeSearch, brand_id: uuid.UUID, query: str
) -> RetrievalDiagnosis:
    try:
        chunks = search.search(brand_id=brand_id, query=query)
    except ModelUnavailableError:
        return RetrievalDiagnosis([], 0, False, "model_unavailable")
    leaks = 0
    unknown = False
    for chunk in chunks:
        owner: uuid.UUID | None = None
        if chunk.source_level == "approved_kb":
            row = session.get(KbChunk, chunk.chunk_id)
            doc = session.get(KbDocument, row.document_id) if row else None
            owner = doc.brand_id if doc else None
        elif chunk.source_level == "task_material":
            piece = session.get(TaskInputChunk, chunk.chunk_id)
            snapshot = session.get(TaskInput, piece.task_input_id) if piece else None
            owner = snapshot.brand_id if snapshot else None
        if owner is None:
            unknown = True
        elif owner != brand_id:
            leaks += 1
    # A confirmed leak outranks an unknown owner: it is the stronger signal.
    error = (
        "retrieval_brand_mismatch"
        if leaks
        else "retrieval_brand_unknown"
        if unknown
        else None
    )
    # Never keep unsafe chunks in a result or pass them to a model.
    return RetrievalDiagnosis([] if error else chunks, leaks, True, error)
