"""Add scenario_template.source_pattern_id

Which viral structure a brand template was converted from, so the workbench can show and link it.

Revision ID: b5d9f3a7c1e4
Revises: a4c8e2b6d0f3
Create Date: 2026-11-02 14:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'b5d9f3a7c1e4'
down_revision = 'a4c8e2b6d0f3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('scenario_template', sa.Column('source_pattern_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'fk_scenario_template_source_pattern_id',
        'scenario_template',
        'viral_pattern',
        ['source_pattern_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade():
    op.drop_constraint('fk_scenario_template_source_pattern_id', 'scenario_template', type_='foreignkey')
    op.drop_column('scenario_template', 'source_pattern_id')
