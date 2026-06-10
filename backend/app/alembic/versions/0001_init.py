"""initial schema

Revision ID: 0001_init
Revises:
Create Date: 2026-06-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None

_UUID = pg.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "users",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "memberships",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", _UUID, sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "org_id", name="uq_membership_user_org"),
    )

    op.create_table(
        "songs",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("org_id", _UUID, sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column("storage_key", sa.String(700), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="uploaded"),
        sa.Column("duration_sec", sa.Float(), nullable=True),
        sa.Column("sample_rate", sa.Integer(), nullable=True),
        sa.Column("created_by", _UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_songs_org_id", "songs", ["org_id"])

    op.create_table(
        "jobs",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("song_id", _UUID, sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(30), nullable=False, server_default="process"),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_jobs_song_id", "jobs", ["song_id"])

    op.create_table(
        "analyses",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("song_id", _UUID, sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("bpm", sa.Float(), nullable=True),
        sa.Column("bpm_confidence", sa.Float(), nullable=True),
        sa.Column("music_key", sa.String(20), nullable=True),
        sa.Column("key_confidence", sa.Float(), nullable=True),
        sa.Column("time_signature", sa.String(10), nullable=True),
        sa.Column("beat_grid", pg.JSONB(), nullable=True),
        sa.Column("downbeats", pg.JSONB(), nullable=True),
        sa.Column("tempo_map", pg.JSONB(), nullable=True),
        sa.Column("sections", pg.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "markers",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("song_id", _UUID, sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position_sec", sa.Float(), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="section"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_markers_song_id", "markers", ["song_id"])

    op.create_table(
        "stems",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("song_id", _UUID, sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("stem_type", sa.String(40), nullable=False),
        sa.Column("storage_key", sa.String(700), nullable=False),
        sa.Column("duration_sec", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_stems_song_id", "stems", ["song_id"])


def downgrade() -> None:
    for table in ("stems", "markers", "analyses", "jobs", "songs", "memberships", "users", "organizations"):
        op.drop_table(table)
