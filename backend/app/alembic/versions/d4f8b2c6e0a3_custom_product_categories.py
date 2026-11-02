"""Allow custom product categories without changing brand categories.

Revision ID: d4f8b2c6e0a3
Revises: c3e7a1b5d9f2
"""

import sqlalchemy as sa
from alembic import op

revision = "d4f8b2c6e0a3"
down_revision = "c3e7a1b5d9f2"
branch_labels = None
depends_on = None
PRESETS = "category IN ('perfume','skincare','makeup','home_fragrance','other')"


def upgrade() -> None:
    op.drop_constraint("ck_product_category", "product", type_="check")


def downgrade() -> None:
    # Lossy by design: old schemas cannot store custom text. Keep every product row.
    op.execute(sa.text(f"UPDATE product SET category='other' WHERE NOT ({PRESETS})"))
    op.create_check_constraint("ck_product_category", "product", PRESETS)
