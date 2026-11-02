"""Add confirmed_copy and post_metric

confirmed_copy keeps every note an operator confirmed so its post link and results can be recorded;
post_metric holds readings of likes, collects and comments. Versions that were already confirmed are
copied in.

Revision ID: e8a2c6d0f4b3
Revises: d7f1b5c9e3a2
Create Date: 2026-11-02 23:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = 'e8a2c6d0f4b3'
down_revision = 'd7f1b5c9e3a2'
branch_labels = None
depends_on = None

BACKFILL_SQL = """
        INSERT INTO confirmed_copy (
            id, brand_id, task_id, version_id, title, scenario_name, scene,
            promo_type, promo_label, confirmed_by, confirmed_at, updated_at
        )
        SELECT gen_random_uuid(), v.brand_id, t.id, v.id,
               left(COALESCE(v.title_candidates ->> COALESCE(v.selected_title_index, 0), ''), 200),
               left(s.name, 100), s.scene, t.promo_type,
               left(COALESCE(p.name, t.activity ->> 'name', ''), 300),
               v.confirmed_by, v.confirmed_at, v.confirmed_at
        FROM generation_version v
        JOIN task t ON t.id = v.task_id
        JOIN scenario_template s ON s.id = t.scenario_id
        LEFT JOIN product p ON p.id = t.product_id
        WHERE v.flow_status = 'ready_to_copy'
          AND NOT EXISTS (SELECT 1 FROM confirmed_copy c WHERE c.version_id = v.id)
        """


def upgrade():
    op.create_table(
        'confirmed_copy',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('task_id', sa.Uuid(), nullable=True),
        sa.Column('version_id', sa.Uuid(), nullable=False),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column('scenario_name', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('scene', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('promo_type', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('promo_label', sqlmodel.sql.sqltypes.AutoString(length=300), nullable=False),
        sa.Column('post_url', sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('confirmed_by', sa.Uuid(), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['task.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['version_id'], ['generation_version.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['confirmed_by'], ['user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('version_id'),
    )
    op.create_index('ix_confirmed_copy_brand_confirmed', 'confirmed_copy', ['brand_id', 'confirmed_at'])
    op.create_table(
        'post_metric',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('copy_id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('captured_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('likes', sa.Integer(), nullable=False),
        sa.Column('collects', sa.Integer(), nullable=False),
        sa.Column('comments', sa.Integer(), nullable=False),
        sa.Column('approximate', sa.Boolean(), nullable=False),
        sa.Column('source', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("source IN ('manual', 'extension', 'screenshot')", name='ck_post_metric_source'),
        sa.CheckConstraint('likes >= 0 AND collects >= 0 AND comments >= 0', name='ck_post_metric_counts'),
        sa.ForeignKeyConstraint(['copy_id'], ['confirmed_copy.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_post_metric_copy_captured', 'post_metric', ['copy_id', 'captured_at'])
    # Versions confirmed before this table existed.
    op.execute(BACKFILL_SQL)


def downgrade():
    op.drop_index('ix_post_metric_copy_captured', table_name='post_metric')
    op.drop_table('post_metric')
    op.drop_index('ix_confirmed_copy_brand_confirmed', table_name='confirmed_copy')
    op.drop_table('confirmed_copy')
