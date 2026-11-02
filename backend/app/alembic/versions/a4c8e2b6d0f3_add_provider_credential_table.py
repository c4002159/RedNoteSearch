"""Add provider_credential

API keys and model lists a platform administrator sets in the web page. Keys are stored encrypted.

Revision ID: a4c8e2b6d0f3
Revises: a3d7e9f1b5c2
Create Date: 2026-11-02 12:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'a4c8e2b6d0f3'
down_revision = 'a3d7e9f1b5c2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'provider_credential',
        sa.Column('provider', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('encrypted_key', sa.Text(), nullable=True),
        sa.Column('key_hint', sqlmodel.sql.sqltypes.AutoString(length=8), nullable=True),
        sa.Column('models', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('updated_by', sa.Uuid(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['updated_by'], ['user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('provider'),
    )


def downgrade():
    op.drop_table('provider_credential')
