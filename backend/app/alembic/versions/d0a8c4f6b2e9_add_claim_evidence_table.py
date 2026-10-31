"""Add claim_evidence table

Revision ID: d0a8c4f6b2e9
Revises: c9f7b3e5a2d8
Create Date: 2026-10-31 23:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = 'd0a8c4f6b2e9'
down_revision = 'c9f7b3e5a2d8'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'claim_evidence',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('version_id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('claim_text', sa.Text(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
        sa.Column('source_level', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=True),
        sa.Column('document_id', sa.Uuid(), nullable=True),
        sa.Column('document_version', sa.Integer(), nullable=True),
        sa.Column('chunk_id', sa.Uuid(), nullable=True),
        sa.Column('snapshot_id', sa.Uuid(), nullable=True),
        sa.Column('quote', sa.Text(), nullable=True),
        sa.Column('rationale', sa.Text(), nullable=False),
        sa.Column('prompt_version', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=True),
        sa.Column('human_confirmed', sa.Boolean(), nullable=True),
        sa.Column('confirm_note', sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column('confirmed_by', sa.Uuid(), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            "status IN ('system_supported', 'evidence_missing', 'needs_human_review')",
            name='ck_claim_evidence_status',
        ),
        sa.CheckConstraint(
            "source_level IN ('approved_kb', 'task_material')",
            name='ck_claim_evidence_source_level',
        ),
        sa.ForeignKeyConstraint(['version_id'], ['generation_version.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['confirmed_by'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_claim_evidence_version_id', 'claim_evidence', ['version_id'], unique=False)
    op.create_index('ix_claim_evidence_brand_id', 'claim_evidence', ['brand_id'], unique=False)


def downgrade():
    op.drop_index('ix_claim_evidence_brand_id', table_name='claim_evidence')
    op.drop_index('ix_claim_evidence_version_id', table_name='claim_evidence')
    op.drop_table('claim_evidence')
