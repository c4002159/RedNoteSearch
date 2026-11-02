"""Add creative_type; let scenario_template.scene hold a brand's own type

The six built-in scenes stay; a brand may add its own types, whose keys are stored in
scenario_template.scene, so the fixed list of scenes in the check constraint goes away. The service
checks that a scene is built in or one of the brand's own.

Revision ID: f9b3d7e1a5c4
Revises: e8a2c6d0f4b3
Create Date: 2026-11-03 09:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = 'f9b3d7e1a5c4'
down_revision = 'e8a2c6d0f4b3'
branch_labels = None
depends_on = None

BUILTIN = "'seeding', 'review', 'tutorial', 'launch', 'promotion', 'story'"


def upgrade():
    op.create_table(
        'creative_type',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('brand_id', sa.Uuid(), nullable=False),
        sa.Column('key', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['brand_id'], ['brand.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('brand_id', 'key', name='uq_creative_type_key'),
        sa.UniqueConstraint('brand_id', 'name', name='uq_creative_type_name'),
    )
    op.drop_constraint('ck_scenario_template_scene', 'scenario_template', type_='check')


def downgrade():
    # Tasks point at templates, so templates of own types are never deleted here.
    in_use = op.get_bind().execute(
        sa.text(f"SELECT count(*) FROM scenario_template WHERE scene NOT IN ({BUILTIN})")
    ).scalar()
    if in_use:
        raise RuntimeError(
            "Templates of the brands' own creative types exist; delete them before downgrading"
        )
    op.create_check_constraint(
        'ck_scenario_template_scene', 'scenario_template', f"scene IN ({BUILTIN})"
    )
    op.drop_table('creative_type')
