"""Add extension_key and confirmed_copy.post_note_id

extension_key holds hashed keys for the browser extension; post_note_id is the note id taken from a
saved post link, so a reading sent by the extension finds its note.

Revision ID: a1c5e9b3d7f2
Revises: f9b3d7e1a5c4
Create Date: 2026-11-03 12:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = 'a1c5e9b3d7f2'
down_revision = 'f9b3d7e1a5c4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'confirmed_copy',
        sa.Column('post_note_id', sqlmodel.sql.sqltypes.AutoString(length=24), nullable=True),
    )
    op.create_index('ix_confirmed_copy_post_note_id', 'confirmed_copy', ['post_note_id'])
    op.execute(
        sa.text(
            r"""
        UPDATE confirmed_copy
        SET post_note_id = substring(
            post_url from '^https://[^/]+/(?\:explore|discovery/item|search_result)/([0-9a-f]{24})/?(?\:[?#].*)?$')
        WHERE post_url IS NOT NULL
        """
        )
    )
    op.create_table(
        'extension_key',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('label', sqlmodel.sql.sqltypes.AutoString(length=60), nullable=False),
        sa.Column('prefix', sqlmodel.sql.sqltypes.AutoString(length=12), nullable=False),
        sa.Column('key_hash', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_extension_key_hash', 'extension_key', ['key_hash'], unique=True)


def downgrade():
    op.drop_index('ix_extension_key_hash', table_name='extension_key')
    op.drop_table('extension_key')
    op.drop_index('ix_confirmed_copy_post_note_id', table_name='confirmed_copy')
    op.drop_column('confirmed_copy', 'post_note_id')
