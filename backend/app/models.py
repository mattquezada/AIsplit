"""ORM models — single source of truth shared by API and worker.

Multi-tenant: every song belongs to an organization; users access songs through
memberships. M6 adds the production layer: saved mixes, sound-board routing
presets, and service setlists.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid_col() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Organization(TimestampMixin, Base):
    __tablename__ = "organizations"
    id: Mapped[uuid.UUID] = _uuid_col()
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    memberships: Mapped[list[Membership]] = relationship(back_populates="organization")
    songs: Mapped[list[Song]] = relationship(back_populates="organization")


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _uuid_col()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    memberships: Mapped[list[Membership]] = relationship(back_populates="user")


class Membership(TimestampMixin, Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "org_id", name="uq_membership_user_org"),)
    id: Mapped[uuid.UUID] = _uuid_col()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member")  # owner|admin|member

    user: Mapped[User] = relationship(back_populates="memberships")
    organization: Mapped[Organization] = relationship(back_populates="memberships")


class Song(TimestampMixin, Base):
    __tablename__ = "songs"
    id: Mapped[uuid.UUID] = _uuid_col()
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(700), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="uploaded"
    )  # uploaded|processing|ready|failed
    duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Library organization (M6): star/archive/foldering.
    is_favorite: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    folder: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    organization: Mapped[Organization] = relationship(back_populates="songs")
    jobs: Mapped[list[Job]] = relationship(back_populates="song", cascade="all, delete-orphan")
    analysis: Mapped[Analysis | None] = relationship(
        back_populates="song", uselist=False, cascade="all, delete-orphan"
    )
    stems: Mapped[list[Stem]] = relationship(back_populates="song", cascade="all, delete-orphan")
    markers: Mapped[list[Marker]] = relationship(
        back_populates="song", cascade="all, delete-orphan"
    )
    mix_presets: Mapped[list[MixPreset]] = relationship(
        back_populates="song", cascade="all, delete-orphan"
    )


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"
    id: Mapped[uuid.UUID] = _uuid_col()
    song_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(30), nullable=False, default="process")
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="queued"
    )  # queued|running|succeeded|failed
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    song: Mapped[Song] = relationship(back_populates="jobs")


class Analysis(TimestampMixin, Base):
    __tablename__ = "analyses"
    id: Mapped[uuid.UUID] = _uuid_col()
    song_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("songs.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    bpm_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    music_key: Mapped[str | None] = mapped_column(String(20), nullable=True)
    key_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    time_signature: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # Song-time (seconds) of the first downbeat — the anchor the synthesized
    # click locks to. Editable so a player can nudge the grid into the pocket.
    click_offset_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    beat_grid: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    downbeats: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    tempo_map: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    sections: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    song: Mapped[Song] = relationship(back_populates="analysis")


class Marker(TimestampMixin, Base):
    __tablename__ = "markers"
    id: Mapped[uuid.UUID] = _uuid_col()
    song_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position_sec: Mapped[float] = mapped_column(Float, nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="section")  # section|cue

    song: Mapped[Song] = relationship(back_populates="markers")


class Stem(TimestampMixin, Base):
    __tablename__ = "stems"
    id: Mapped[uuid.UUID] = _uuid_col()
    song_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Worship-standard stem types: kick|drums|bass|electric|acoustic|keys|synth|
    # lead_vocal|bgv (and legacy vocals|guitar|piano|other from older runs).
    stem_type: Mapped[str] = mapped_column(String(40), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(700), nullable=False)
    duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 0 = original; non-zero = transposed variant rendered from the originals.
    pitch_semitones: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    song: Mapped[Song] = relationship(back_populates="stems")


class MixPreset(TimestampMixin, Base):
    """A saved rehearsal/console mix for one song.

    `data` maps stem_type → {volume, pan, muted, soloed} so a preset survives
    key changes (which re-render stems under new ids but keep the same types).
    """

    __tablename__ = "mix_presets"
    __table_args__ = (UniqueConstraint("song_id", "name", name="uq_mix_song_name"),)
    id: Mapped[uuid.UUID] = _uuid_col()
    song_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)

    song: Mapped[Song] = relationship(back_populates="mix_presets")


class RoutingPreset(TimestampMixin, Base):
    """A reusable sound-board / audio-interface routing map for a venue.

    Org-scoped so "Main Sanctuary", "Youth Room", etc. apply across songs.
    `data.assignments` maps stem_type → {output, channel, label}.
    """

    __tablename__ = "routing_presets"
    __table_args__ = (UniqueConstraint("org_id", "name", name="uq_routing_org_name"),)
    id: Mapped[uuid.UUID] = _uuid_col()
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)

    organization: Mapped[Organization] = relationship()


class Setlist(TimestampMixin, Base):
    """A service plan: an ordered list of songs (each at a chosen key)."""

    __tablename__ = "setlists"
    id: Mapped[uuid.UUID] = _uuid_col()
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    service_date: Mapped[str | None] = mapped_column(String(20), nullable=True)  # ISO date
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list[SetlistItem]] = relationship(
        back_populates="setlist",
        cascade="all, delete-orphan",
        order_by="SetlistItem.position",
    )


class SetlistItem(TimestampMixin, Base):
    __tablename__ = "setlist_items"
    id: Mapped[uuid.UUID] = _uuid_col()
    setlist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("setlists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    song_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("songs.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    semitones: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    setlist: Mapped[Setlist] = relationship(back_populates="items")
    song: Mapped[Song] = relationship()
