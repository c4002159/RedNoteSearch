"""Add tenant, brand, brand_member and the knowledge base tables

Creates tenant, brand, brand_member, kb_document, kb_review and kb_chunk. kb_chunk.embedding is
vector(1024) (text-embedding-v4 at 1024 dimensions, ADR-006) with an HNSW cosine index; the vector extension
is enabled by migration a1b2c3d4e5f6.

Revision ID: d4e1b8c6a2f7
Revises: c3f9a7d1e2b5
Create Date: 2026-10-31 10:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'd4e1b8c6a2f7'
down_revision = 'c3f9a7d1e2b5'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tenant',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'brand',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('tenant_id', sa.Uuid(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('slug', sqlmodel.sql.sqltypes.AutoString(length=60), nullable=False),
        sa.Column('category', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            "category IN ('perfume', 'skincare', 'makeup', 'home_fragrance', 'other')",
            name='ck_brand_category',
        ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ondelete='CASCADE'),
    )
    op.create_index(op.f('ix_brand_slug'), 'brand', ['slug'], unique=True)
    op.create_index('ix_brand_tenant_id', 'brand', ['tenant_id'], unique=False)

    op.create_table(
        'brand_member',
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('role', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('brand_id', 'user_id'),
        sa.CheckConstraint("role IN ('admin', 'editor')", name='ck_brand_member_role'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_brand_member_user_id', 'brand_member', ['user_id'], unique=False)

    op.create_table(
        'kb_document',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('group_id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column('doc_type', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('is_current', sa.Boolean(), nullable=False),
        sa.Column('supersedes_id', sa.Uuid(), nullable=True),
        sa.Column('source_filename', sqlmodel.sql.sqltypes.AutoString(length=300), nullable=True),
        sa.Column('checksum', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=True),
        sa.Column('index_status', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('submitted_by', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('group_id', 'version', name='uq_kb_document_group_version'),
        sa.CheckConstraint(
            "doc_type IN ('brand_story', 'product_spec', 'ingredient', 'award_claim', "
            "'compliance_policy', 'sample_note')",
            name='ck_kb_document_type',
        ),
        sa.CheckConstraint(
            "status IN ('pending_review', 'approved', 'rejected', 'deactivated')",
            name='ck_kb_document_status',
        ),
        sa.CheckConstraint(
            "index_status IN ('pending', 'ready', 'failed')",
            name='ck_kb_document_index_status',
        ),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['supersedes_id'], ['kb_document.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['submitted_by'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_kb_document_brand_status', 'kb_document', ['brand_id', 'status'], unique=False)
    op.create_index('ix_kb_document_group_current', 'kb_document', ['group_id', 'is_current'], unique=False)

    op.create_table(
        'kb_review',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('document_id', sa.Uuid(), nullable=False),
        sa.Column('action', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('actor_id', sa.Uuid(), nullable=True),
        sa.Column('reason', sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            "action IN ('submit', 'approve', 'reject', 'deactivate')",
            name='ck_kb_review_action',
        ),
        sa.ForeignKeyConstraint(['document_id'], ['kb_document.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['actor_id'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_kb_review_document_id', 'kb_review', ['document_id'], unique=False)

    op.create_table(
        'kb_chunk',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('document_id', sa.Uuid(), nullable=False),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding', Vector(1024), nullable=True),
        sa.Column('meta', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
        sa.Column('token_count', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['document_id'], ['kb_document.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_kb_chunk_brand_id', 'kb_chunk', ['brand_id'], unique=False)
    op.create_index('ix_kb_chunk_document_id', 'kb_chunk', ['document_id'], unique=False)
    op.create_index(
        'ix_kb_chunk_embedding_hnsw',
        'kb_chunk',
        ['embedding'],
        unique=False,
        postgresql_using='hnsw',
        postgresql_ops={'embedding': 'vector_cosine_ops'},
    )


def downgrade():
    op.drop_index('ix_kb_chunk_embedding_hnsw', table_name='kb_chunk', postgresql_using='hnsw')
    op.drop_index('ix_kb_chunk_document_id', table_name='kb_chunk')
    op.drop_index('ix_kb_chunk_brand_id', table_name='kb_chunk')
    op.drop_table('kb_chunk')
    op.drop_index('ix_kb_review_document_id', table_name='kb_review')
    op.drop_table('kb_review')
    op.drop_index('ix_kb_document_group_current', table_name='kb_document')
    op.drop_index('ix_kb_document_brand_status', table_name='kb_document')
    op.drop_table('kb_document')
    op.drop_index('ix_brand_member_user_id', table_name='brand_member')
    op.drop_table('brand_member')
    op.drop_index('ix_brand_tenant_id', table_name='brand')
    op.drop_index(op.f('ix_brand_slug'), table_name='brand')
    op.drop_table('brand')
    op.drop_table('tenant')
