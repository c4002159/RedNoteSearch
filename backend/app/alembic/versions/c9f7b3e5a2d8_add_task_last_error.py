"""Add task.last_error

Short, secret-free reason why the last generation attempt did not finish (for example
``model_unavailable``), so the client can tell a failed run from one that has not started.

Revision ID: c9f7b3e5a2d8
Revises: b8e6a2d4f1c7
Create Date: 2026-10-31 22:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = 'c9f7b3e5a2d8'
down_revision = 'b8e6a2d4f1c7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'task',
        sa.Column('last_error', sqlmodel.sql.sqltypes.AutoString(length=60), nullable=True),
    )


def downgrade():
    op.drop_column('task', 'last_error')
