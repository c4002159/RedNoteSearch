"""Allow the admin_direct_ingest action in kb_review

Admin direct ingest is audited as a review row (contract section 4), so the CHECK constraint on
kb_review.action gains the value.

Revision ID: f6b3d8e1a4c2
Revises: e5a2c9d7b3f1
Create Date: 2026-10-31 16:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'f6b3d8e1a4c2'
down_revision = 'e5a2c9d7b3f1'
branch_labels = None
depends_on = None

OLD = "action IN ('submit', 'approve', 'reject', 'deactivate')"
NEW = "action IN ('submit', 'approve', 'reject', 'deactivate', 'admin_direct_ingest')"


def upgrade():
    op.drop_constraint('ck_kb_review_action', 'kb_review', type_='check')
    op.create_check_constraint('ck_kb_review_action', 'kb_review', NEW)


def downgrade():
    op.execute("DELETE FROM kb_review WHERE action = 'admin_direct_ingest'")
    op.drop_constraint('ck_kb_review_action', 'kb_review', type_='check')
    op.create_check_constraint('ck_kb_review_action', 'kb_review', OLD)
