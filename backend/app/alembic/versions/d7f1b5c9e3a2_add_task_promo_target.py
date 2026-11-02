"""Add the promoted target to task: promo type, extra products, activity

A task may promote one product (as before), several products or an activity with no product, so
task.product_id becomes optional.

Revision ID: d7f1b5c9e3a2
Revises: c6e0a4b8d2f5
Create Date: 2026-11-02 21:00:00.000000

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'd7f1b5c9e3a2'
down_revision = 'c6e0a4b8d2f5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'task',
        sa.Column('promo_type', sa.String(length=20), nullable=False, server_default='product'),
    )
    op.add_column(
        'task',
        sa.Column(
            'extra_product_ids',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column('task', sa.Column('activity', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.alter_column('task', 'product_id', existing_type=sa.Uuid(), nullable=True)
    op.create_check_constraint(
        'ck_task_promo_type',
        'task',
        "promo_type IN ('product', 'multi_product', 'activity')",
    )


def downgrade():
    # Activity tasks have no product, so they cannot be kept once product_id is required again.
    op.execute("DELETE FROM task WHERE product_id IS NULL")
    op.drop_constraint('ck_task_promo_type', 'task', type_='check')
    op.alter_column('task', 'product_id', existing_type=sa.Uuid(), nullable=False)
    op.drop_column('task', 'activity')
    op.drop_column('task', 'extra_product_ids')
    op.drop_column('task', 'promo_type')
