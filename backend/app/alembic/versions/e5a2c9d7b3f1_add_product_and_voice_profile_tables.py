"""Add product and brand_voice_profile tables

Revision ID: e5a2c9d7b3f1
Revises: d4e1b8c6a2f7
Create Date: 2026-10-31 14:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'e5a2c9d7b3f1'
down_revision = 'd4e1b8c6a2f7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'product',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('product_line', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
        sa.Column('category', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
        sa.Column('notes', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('selling_points', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('restricted_claims', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            "category IN ('perfume', 'skincare', 'makeup', 'home_fragrance', 'other')",
            name='ck_product_category',
        ),
        sa.CheckConstraint("status IN ('active', 'archived')", name='ck_product_status'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_product_brand_status', 'product', ['brand_id', 'status'], unique=False)

    op.create_table(
        'brand_voice_profile',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('persona', sa.Text(), nullable=False),
        sa.Column('tone_keywords', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('preferred_words', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('forbidden_words', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('sample_refs', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('brand_id', 'version', name='uq_voice_profile_version'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index(
        'uq_voice_profile_one_active',
        'brand_voice_profile',
        ['brand_id'],
        unique=True,
        postgresql_where=sa.text('is_active'),
    )


def downgrade():
    op.drop_index('uq_voice_profile_one_active', table_name='brand_voice_profile')
    op.drop_table('brand_voice_profile')
    op.drop_index('ix_product_brand_status', table_name='product')
    op.drop_table('product')
