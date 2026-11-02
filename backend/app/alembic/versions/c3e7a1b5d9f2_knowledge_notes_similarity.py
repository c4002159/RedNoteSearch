"""Knowledge source kinds and append-only similarity review decisions.

Revision ID: c3e7a1b5d9f2
Revises: a1c5e9b3d7f2
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c3e7a1b5d9f2"
down_revision = "b2d6f0a4c8e1"
branch_labels = None
depends_on = None
OLD_ACTIONS = (
    "action IN ('submit','approve','reject','deactivate','admin_direct_ingest')"
)


def upgrade() -> None:
    op.add_column(
        "kb_document",
        sa.Column("source_kind", sa.String(10), nullable=False, server_default="file"),
    )
    op.add_column(
        "kb_document", sa.Column("source_description", sa.String(1000), nullable=True)
    )
    op.create_check_constraint(
        "ck_kb_document_source_kind", "kb_document", "source_kind IN ('file','note')"
    )
    op.add_column(
        "kb_review", sa.Column("similar_decision", sa.String(20), nullable=True)
    )
    op.add_column(
        "kb_review",
        sa.Column(
            "related_document_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.drop_constraint("ck_kb_review_action", "kb_review", type_="check")
    op.create_check_constraint(
        "ck_kb_review_action",
        "kb_review",
        "action IN ('submit','approve','reject','deactivate','admin_direct_ingest','cancel')",
    )


def downgrade() -> None:
    if (
        op.get_bind()
        .execute(
            sa.text("SELECT EXISTS (SELECT 1 FROM kb_review WHERE action='cancel')")
        )
        .scalar()
    ):
        raise RuntimeError("取消审核记录存在，不能通过删改审核日志降级")
    op.drop_constraint("ck_kb_review_action", "kb_review", type_="check")
    op.create_check_constraint("ck_kb_review_action", "kb_review", OLD_ACTIONS)
    op.drop_column("kb_review", "related_document_ids")
    op.drop_column("kb_review", "similar_decision")
    op.drop_constraint("ck_kb_document_source_kind", "kb_document", type_="check")
    op.drop_column("kb_document", "source_description")
    op.drop_column("kb_document", "source_kind")
