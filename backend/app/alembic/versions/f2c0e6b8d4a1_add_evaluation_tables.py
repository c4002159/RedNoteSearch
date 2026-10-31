"""Add evaluation tables: eval_dataset, eval_case, eval_run, eval_result, eval_rating

Revision ID: f2c0e6b8d4a1
Revises: e1b9d5a7c3f0
Create Date: 2026-11-01 02:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'f2c0e6b8d4a1'
down_revision = 'e1b9d5a7c3f0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'eval_dataset',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('group_id', sa.Uuid(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('kind', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=True),
        sa.Column('content_hash', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column('case_count', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('group_id', 'version', name='uq_eval_dataset_version'),
        sa.CheckConstraint(
            "kind IN ('generation', 'compliance', 'factcheck', 'brand_leak')",
            name='ck_eval_dataset_kind',
        ),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_eval_dataset_brand_id', 'eval_dataset', ['brand_id'], unique=False)

    op.create_table(
        'eval_case',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('dataset_id', sa.Uuid(), nullable=False),
        sa.Column('case_index', sa.Integer(), nullable=False),
        sa.Column('input', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('expected', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('annotators', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['dataset_id'], ['eval_dataset.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_eval_case_dataset_id', 'eval_case', ['dataset_id'], unique=False)

    op.create_table(
        'eval_run',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('dataset_id', sa.Uuid(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('model_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('baselines', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('prompt_version', sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column('checker_version', sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column('rubric_version', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=True),
        sa.Column('idempotency_key', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
        sa.Column('sample_count', sa.Integer(), nullable=False),
        sa.Column('metrics', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('error', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=True),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'completed', 'failed')", name='ck_eval_run_status'
        ),
        sa.ForeignKeyConstraint(['dataset_id'], ['eval_dataset.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_eval_run_dataset_id', 'eval_run', ['dataset_id'], unique=False)

    op.create_table(
        'eval_result',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('run_id', sa.Uuid(), nullable=False),
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('system', sqlmodel.sql.sqltypes.AutoString(length=80), nullable=False),
        sa.Column('output', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('detail', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('passed', sa.Boolean(), nullable=True),
        sa.Column('error', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=False),
        sa.Column('prompt_tokens', sa.Integer(), nullable=False),
        sa.Column('completion_tokens', sa.Integer(), nullable=False),
        sa.Column('cost', sa.Numeric(precision=14, scale=6), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['run_id'], ['eval_run.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['case_id'], ['eval_case.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_eval_result_run_id', 'eval_result', ['run_id'], unique=False)
    op.create_index('ix_eval_result_case_id', 'eval_result', ['case_id'], unique=False)

    op.create_table(
        'eval_rating',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('run_id', sa.Uuid(), nullable=False),
        sa.Column('result_id', sa.Uuid(), nullable=False),
        sa.Column('rater_id', sa.Uuid(), nullable=False),
        sa.Column('scores', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('rubric_version', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('result_id', 'rater_id', name='uq_eval_rating_rater'),
        sa.ForeignKeyConstraint(['run_id'], ['eval_run.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['result_id'], ['eval_result.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['rater_id'], ['user.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_eval_rating_run_id', 'eval_rating', ['run_id'], unique=False)


def downgrade():
    op.drop_index('ix_eval_rating_run_id', table_name='eval_rating')
    op.drop_table('eval_rating')
    op.drop_index('ix_eval_result_case_id', table_name='eval_result')
    op.drop_index('ix_eval_result_run_id', table_name='eval_result')
    op.drop_table('eval_result')
    op.drop_index('ix_eval_run_dataset_id', table_name='eval_run')
    op.drop_table('eval_run')
    op.drop_index('ix_eval_case_dataset_id', table_name='eval_case')
    op.drop_table('eval_case')
    op.drop_index('ix_eval_dataset_brand_id', table_name='eval_dataset')
    op.drop_table('eval_dataset')
