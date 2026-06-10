"""add click_offset_sec to analyses

The synthesized click locks to a steady grid anchored at this offset, so it
can be nudged/edited per song without re-running separation.

Revision ID: 0004_click_offset
Revises: 0003_m6
Create Date: 2026-06-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_click_offset"
down_revision = "0003_m6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("analyses", sa.Column("click_offset_sec", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("analyses", "click_offset_sec")
