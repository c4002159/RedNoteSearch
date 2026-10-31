"""Add task_input, task_input_chunk and audit_log tables

Revision ID: a7d5f1c8e3b9
Revises: f6b3d8e1a4c2
Create Date: 2026-10-31 18:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'a7d5f1c8e3b9'
down_revision = 'f6b3d8e1a4c2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'task_input',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('task_id', sa.Uuid(), nullable=False),
        sa.Column('filename', sqlmodel.sql.sqltypes.AutoString(length=300), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('content_hash', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_task_input_brand_task', 'task_input', ['brand_id', 'task_id'], unique=False)

    op.create_table(
        'task_input_chunk',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('task_input_id', sa.Uuid(), nullable=False),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding', Vector(1024), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_input_id'], ['task_input.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_task_input_chunk_brand_id', 'task_input_chunk', ['brand_id'], unique=False)
    op.create_index('ix_task_input_chunk_task_input_id', 'task_input_chunk', ['task_input_id'], unique=False)
    op.create_index(
        'ix_task_input_chunk_embedding_hnsw',
        'task_input_chunk',
        ['embedding'],
        unique=False,
        postgresql_using='hnsw',
        postgresql_ops={'embedding': 'vector_cosine_ops'},
    )

    op.create_table(
        'audit_log',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=True),
        sa.Column('actor_id', sa.Uuid(), nullable=True),
        sa.Column('action', sqlmodel.sql.sqltypes.AutoString(length=60), nullable=False),
        sa.Column('entity_type', sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column('entity_id', sa.Uuid(), nullable=True),
        sa.Column('detail', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['actor_id'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_audit_log_brand_created', 'audit_log', ['brand_id', 'created_at'], unique=False)
    op.create_index('ix_audit_log_entity', 'audit_log', ['entity_type', 'entity_id'], unique=False)


def downgrade():
    op.drop_index('ix_audit_log_entity', table_name='audit_log')
    op.drop_index('ix_audit_log_brand_created', table_name='audit_log')
    op.drop_table('audit_log')
    op.drop_index('ix_task_input_chunk_embedding_hnsw', table_name='task_input_chunk', postgresql_using='hnsw', postgresql_ops={'embedding': 'vector_cosine_ops'})
    op.drop_index('ix_task_input_chunk_task_input_id', table_name='task_input_chunk')
    op.drop_index('ix_task_input_chunk_brand_id', table_name='task_input_chunk')
    op.drop_table('task_input_chunk')
    op.drop_index('ix_task_input_brand_task', table_name='task_input')
    op.drop_table('task_input')
