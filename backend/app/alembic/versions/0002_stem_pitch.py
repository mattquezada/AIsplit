"""add pitch_semitones to stems

Revision ID: 0002_stem_pitch
Revises: 0001_init
Create Date: 2026-06-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_stem_pitch"
down_revision = "0001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stems",
        sa.Column("pitch_semitones", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("stems", "pitch_semitones")
