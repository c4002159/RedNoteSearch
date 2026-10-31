"""Add scenario_template, style_preset, task, generation_version and llm_call_log tables

Revision ID: b8e6a2d4f1c7
Revises: a7d5f1c8e3b9
Create Date: 2026-10-31 20:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'b8e6a2d4f1c7'
down_revision = 'a7d5f1c8e3b9'
branch_labels = None
depends_on = None

FLOW = (
    "'queued', 'generating', 'checking', 'checks_completed', 'needs_human_review', "
    "'constraint_failed', 'edited_pending_recheck', 'ready_to_copy'"
)


def upgrade():
    op.create_table(
        'scenario_template',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=True),
        sa.Column('scene', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('structure', sa.Text(), nullable=False),
        sa.Column('template_version', sa.Integer(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            "scene IN ('seeding', 'review', 'tutorial', 'launch', 'promotion', 'story')",
            name='ck_scenario_template_scene',
        ),
        sa.UniqueConstraint('brand_id', 'scene', 'name', 'template_version', name='uq_scenario_template'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_scenario_template_brand_id', 'scenario_template', ['brand_id'], unique=False)

    op.create_table(
        'style_preset',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_style_preset_brand_id', 'style_preset', ['brand_id'], unique=False)

    op.create_table(
        'task',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('product_id', sa.Uuid(), nullable=False),
        sa.Column('scenario_id', sa.Uuid(), nullable=False),
        sa.Column('style', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('brief', sa.Text(), nullable=False),
        sa.Column('required_terms', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('flow_status', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
        sa.Column('progress_stage', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=True),
        sa.Column('latest_version_id', sa.Uuid(), nullable=True),
        sa.Column('idempotency_key', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(f"flow_status IN ({FLOW})", name='ck_task_flow_status'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['product_id'], ['product.id']),
        sa.ForeignKeyConstraint(['scenario_id'], ['scenario_template.id']),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_task_brand_created', 'task', ['brand_id', 'created_at'], unique=False)
    op.create_index('ix_task_brand_status', 'task', ['brand_id', 'flow_status'], unique=False)

    op.create_table(
        'generation_version',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('task_id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('parent_version_id', sa.Uuid(), nullable=True),
        sa.Column('origin', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('flow_status', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
        sa.Column('title_candidates', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('hashtags', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('cover_candidates', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('constraint_checks', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('retrieved_sources', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('template_version', sa.Integer(), nullable=True),
        sa.Column('prompt_version', sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column('voice_version', sa.Integer(), nullable=True),
        sa.Column('checker_version', sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column('model', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
        sa.Column('selected_title_index', sa.Integer(), nullable=True),
        sa.Column('selected_cover_index', sa.Integer(), nullable=True),
        sa.Column('confirmed_by', sa.Uuid(), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('task_id', 'version_no', name='uq_generation_version_no'),
        sa.CheckConstraint(f"flow_status IN ({FLOW})", name='ck_generation_version_status'),
        sa.CheckConstraint("origin IN ('generated', 'edited', 'rewritten')", name='ck_generation_version_origin'),
        sa.ForeignKeyConstraint(['task_id'], ['task.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['parent_version_id'], ['generation_version.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['confirmed_by'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_generation_version_task_id', 'generation_version', ['task_id'], unique=False)
    op.create_index('ix_generation_version_brand_id', 'generation_version', ['brand_id'], unique=False)

    op.create_table(
        'llm_call_log',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=True),
        sa.Column('task_id', sa.Uuid(), nullable=True),
        sa.Column('provider', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
        sa.Column('model', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('purpose', sqlmodel.sql.sqltypes.AutoString(length=50), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(length=10), nullable=False),
        sa.Column('latency_ms', sa.Integer(), nullable=False),
        sa.Column('prompt_tokens', sa.Integer(), nullable=False),
        sa.Column('completion_tokens', sa.Integer(), nullable=False),
        sa.Column('cost', sa.Numeric(precision=14, scale=6), nullable=True),
        sa.Column('price_version', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=True),
        sa.Column('error', sqlmodel.sql.sqltypes.AutoString(length=60), nullable=False),
        sa.Column('attempt', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['task_id'], ['task.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_llm_call_log_brand_created', 'llm_call_log', ['brand_id', 'created_at'], unique=False)
    op.create_index('ix_llm_call_log_task_id', 'llm_call_log', ['task_id'], unique=False)


def downgrade():
    op.drop_index('ix_llm_call_log_task_id', table_name='llm_call_log')
    op.drop_index('ix_llm_call_log_brand_created', table_name='llm_call_log')
    op.drop_table('llm_call_log')
    op.drop_index('ix_generation_version_brand_id', table_name='generation_version')
    op.drop_index('ix_generation_version_task_id', table_name='generation_version')
    op.drop_table('generation_version')
    op.drop_index('ix_task_brand_status', table_name='task')
    op.drop_index('ix_task_brand_created', table_name='task')
    op.drop_table('task')
    op.drop_index('ix_style_preset_brand_id', table_name='style_preset')
    op.drop_table('style_preset')
    op.drop_index('ix_scenario_template_brand_id', table_name='scenario_template')
    op.drop_table('scenario_template')
