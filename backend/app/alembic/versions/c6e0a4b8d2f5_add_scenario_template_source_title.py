"""Add scenario_template.source_title

The name of the viral structure a template came from, copied at conversion time so it survives when
the sample is deleted.

Revision ID: c6e0a4b8d2f5
Revises: b5d9f3a7c1e4
Create Date: 2026-11-02 18:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = 'c6e0a4b8d2f5'
down_revision = 'b5d9f3a7c1e4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'scenario_template',
        sa.Column('source_title', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
    )


def downgrade():
    op.drop_column('scenario_template', 'source_title')
