"""Add compliance_rule and compliance_check tables

Revision ID: e1b9d5a7c3f0
Revises: d0a8c4f6b2e9
Create Date: 2026-11-01 00:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'e1b9d5a7c3f0'
down_revision = 'd0a8c4f6b2e9'
branch_labels = None
depends_on = None

LAYER = "'lexicon', 'context', 'efficacy_basis'"
SEVERITY = "'block', 'warn'"


def upgrade():
    op.create_table(
        'compliance_rule',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=True),
        sa.Column('layer', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('rule_type', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('pattern', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column('is_regex', sa.Boolean(), nullable=False),
        sa.Column('severity', sqlmodel.sql.sqltypes.AutoString(length=10), nullable=False),
        sa.Column('suggestion', sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False),
        sa.Column('source_name', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column('source_url', sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column('source_clause', sqlmodel.sql.sqltypes.AutoString(length=300), nullable=True),
        sa.Column('region_scope', sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column('effective_from', sa.Date(), nullable=True),
        sa.Column('effective_to', sa.Date(), nullable=True),
        sa.Column('rule_version', sa.Integer(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('is_sample', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(f"layer IN ({LAYER})", name='ck_compliance_rule_layer'),
        sa.CheckConstraint(
            "rule_type IN ('absolute_term', 'efficacy_claim', 'medical_term', 'data_claim', "
            "'platform_rule', 'brand_forbidden')",
            name='ck_compliance_rule_type',
        ),
        sa.CheckConstraint(f"severity IN ({SEVERITY})", name='ck_compliance_rule_severity'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_compliance_rule_brand_id', 'compliance_rule', ['brand_id'], unique=False)

    op.create_table(
        'compliance_check',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('version_id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('rule_id', sa.Uuid(), nullable=True),
        sa.Column('rule_version', sa.Integer(), nullable=True),
        sa.Column('layer', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('rule_type', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=True),
        sa.Column('severity', sqlmodel.sql.sqltypes.AutoString(length=10), nullable=False),
        sa.Column('field', sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column('span_start', sa.Integer(), nullable=False),
        sa.Column('span_end', sa.Integer(), nullable=False),
        sa.Column('matched_text', sa.Text(), nullable=False),
        sa.Column('suggestion', sa.Text(), nullable=False),
        sa.Column('source_name', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column('source_clause', sqlmodel.sql.sqltypes.AutoString(length=300), nullable=True),
        sa.Column('region_scope', sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column('basis', sqlmodel.sql.sqltypes.AutoString(length=10), nullable=True),
        sa.Column('detail', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
        sa.Column('resolved', sa.Boolean(), nullable=False),
        sa.Column('resolved_note', sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column('resolved_by', sa.Uuid(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(f"layer IN ({LAYER})", name='ck_compliance_check_layer'),
        sa.CheckConstraint(f"severity IN ({SEVERITY})", name='ck_compliance_check_severity'),
        sa.ForeignKeyConstraint(['version_id'], ['generation_version.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['resolved_by'], ['user.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_compliance_check_version_id', 'compliance_check', ['version_id'], unique=False)
    op.create_index('ix_compliance_check_brand_id', 'compliance_check', ['brand_id'], unique=False)


def downgrade():
    op.drop_index('ix_compliance_check_brand_id', table_name='compliance_check')
    op.drop_index('ix_compliance_check_version_id', table_name='compliance_check')
    op.drop_table('compliance_check')
    op.drop_index('ix_compliance_rule_brand_id', table_name='compliance_rule')
    op.drop_table('compliance_rule')
