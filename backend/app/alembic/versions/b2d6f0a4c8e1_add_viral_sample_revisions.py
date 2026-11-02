"""Track the sample revision used by structural analyses.

Revision ID: b2d6f0a4c8e1
Revises: a1c5e9b3d7f2
"""

import sqlalchemy as sa
from alembic import op

revision = "b2d6f0a4c8e1"
down_revision = "a1c5e9b3d7f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "viral_sample",
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "viral_pattern", sa.Column("sample_revision", sa.Integer(), nullable=True)
    )
    op.execute("UPDATE viral_pattern SET sample_revision = 0")


def downgrade() -> None:
    op.drop_column("viral_pattern", "sample_revision")
    op.drop_column("viral_sample", "revision")
