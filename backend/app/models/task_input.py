import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, DateTime, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.common import get_datetime_utc
from app.models.knowledge import EMBEDDING_DIMENSIONS


# Immutable copy of the material an operator supplied for one task. Rows are only inserted; later edits
# to the source file or promoting the material into the knowledge base never change a snapshot.
# ``task_id`` has no foreign key: the task table belongs to member B, who may add one in a later migration.
class TaskInput(SQLModel, table=True):
    __tablename__ = "task_input"  # type: ignore[assignment]
    __table_args__ = (Index("ix_task_input_brand_task", "brand_id", "task_id"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    task_id: uuid.UUID
    filename: str = Field(max_length=300)
    content: str = Field(sa_type=Text)
    content_hash: str = Field(max_length=64)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )


# Retrievable pieces of a snapshot, embedded like knowledge base chunks so ``KnowledgeSearch`` can
# return the task's own material (source level ``task_material``).
class TaskInputChunk(SQLModel, table=True):
    __tablename__ = "task_input_chunk"  # type: ignore[assignment]
    __table_args__ = (
        Index("ix_task_input_chunk_brand_id", "brand_id"),
        Index("ix_task_input_chunk_task_input_id", "task_input_id"),
        Index(
            "ix_task_input_chunk_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID = Field(
        foreign_key="brand.id", nullable=False, ondelete="CASCADE"
    )
    task_input_id: uuid.UUID = Field(
        foreign_key="task_input.id", nullable=False, ondelete="CASCADE"
    )
    chunk_index: int
    content: str = Field(sa_type=Text)
    embedding: list[float] | None = Field(
        default=None, sa_column=Column(Vector(EMBEDDING_DIMENSIONS))
    )


# Append-only record of who did what. Both members write to it through ``app.services.audit``;
# ``action`` is a free-form dotted name such as ``knowledge.approve`` (no CHECK, so adding events
# never needs a migration). The app only inserts rows.
class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_log"  # type: ignore[assignment]
    __table_args__ = (
        Index("ix_audit_log_brand_created", "brand_id", "created_at"),
        Index("ix_audit_log_entity", "entity_type", "entity_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    brand_id: uuid.UUID | None = Field(
        default=None, foreign_key="brand.id", ondelete="SET NULL"
    )
    actor_id: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    action: str = Field(max_length=60)
    entity_type: str = Field(max_length=40)
    entity_id: uuid.UUID | None = None
    detail: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="{}"),
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc, sa_type=DateTime(timezone=True)
    )
