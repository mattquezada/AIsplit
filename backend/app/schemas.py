"""Pydantic request/response models."""
from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import PurePosixPath

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

_ALLOWED_AUDIO_EXTS = {".wav", ".mp3", ".aac", ".m4a", ".flac", ".ogg", ".aiff", ".aif"}


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ─── Auth ────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    org_name: str = Field(min_length=1, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(ORMModel):
    id: uuid.UUID
    email: EmailStr
    created_at: datetime


class MembershipResponse(ORMModel):
    org_id: uuid.UUID
    role: str


class MeResponse(BaseModel):
    user: UserResponse
    memberships: list[MembershipResponse]


# ─── Orgs ────────────────────────────────────────────────────
class OrgCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class OrgResponse(ORMModel):
    id: uuid.UUID
    name: str
    created_at: datetime


class AddMemberRequest(BaseModel):
    email: EmailStr
    role: str = Field(default="member", pattern="^(owner|admin|member)$")


# ─── Songs / uploads ─────────────────────────────────────────
class UploadUrlRequest(BaseModel):
    org_id: uuid.UUID
    filename: str = Field(min_length=1, max_length=500)
    content_type: str = "audio/wav"

    @field_validator("filename")
    @classmethod
    def _audio_extension(cls, v: str) -> str:
        ext = PurePosixPath(v).suffix.lower()
        if ext not in _ALLOWED_AUDIO_EXTS:
            raise ValueError(f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(_ALLOWED_AUDIO_EXTS))}")
        return v


class UploadUrlResponse(BaseModel):
    upload_url: str
    storage_key: str


class SongCreate(BaseModel):
    org_id: uuid.UUID
    title: str = Field(min_length=1, max_length=300)
    original_filename: str
    storage_key: str


class SongResponse(ORMModel):
    id: uuid.UUID
    org_id: uuid.UUID
    title: str
    original_filename: str
    status: str
    duration_sec: float | None
    sample_rate: int | None
    is_favorite: bool
    archived: bool
    folder: str | None
    created_at: datetime


class SongUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    is_favorite: bool | None = None
    archived: bool | None = None
    folder: str | None = Field(default=None, max_length=200)


class JobResponse(ORMModel):
    id: uuid.UUID
    type: str
    status: str
    progress: int
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None


# ─── Analysis / markers ──────────────────────────────────────
class AnalysisResponse(ORMModel):
    bpm: float | None
    bpm_confidence: float | None
    music_key: str | None
    key_confidence: float | None
    time_signature: str | None
    click_offset_sec: float | None
    beat_grid: list | None
    downbeats: list | None
    tempo_map: list | None
    sections: list | None


class AnalysisUpdate(BaseModel):
    bpm: float | None = None
    music_key: str | None = None
    time_signature: str | None = None
    # Latency nudge (seconds, may be negative) applied to the click grid.
    click_offset_sec: float | None = Field(default=None, ge=-1.0, le=1.0)
    sections: list | None = None
    tempo_map: list | None = None


class MarkerCreate(BaseModel):
    position_sec: float = Field(ge=0)
    label: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="section", pattern="^(section|cue)$")


class MarkerUpdate(BaseModel):
    position_sec: float | None = Field(default=None, ge=0)
    label: str | None = Field(default=None, max_length=120)
    kind: str | None = Field(default=None, pattern="^(section|cue)$")


class MarkerResponse(ORMModel):
    id: uuid.UUID
    position_sec: float
    label: str
    kind: str


# ─── Guide track ─────────────────────────────────────────────
class GuideCue(BaseModel):
    time: float  # song-time (s) the cue belongs to
    text: str  # what the guide voice announces (e.g. "Chorus")


class GuideResponse(BaseModel):
    beats_per_bar: int
    count_in_bars: int
    cues: list[GuideCue]


# ─── Stems ───────────────────────────────────────────────────
class StemResponse(ORMModel):
    id: uuid.UUID
    name: str
    stem_type: str
    duration_sec: float | None
    pitch_semitones: int


class StemWithUrlResponse(StemResponse):
    url: str


class TransposeRequest(BaseModel):
    semitones: int = Field(ge=-12, le=12)


class TransposeResponse(BaseModel):
    semitones: int
    status: str  # "ready" if already rendered, else "processing"


class DownloadUrlResponse(BaseModel):
    url: str


# ─── Mix presets ─────────────────────────────────────────────
class MixPresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    # stem_type -> {volume, pan, muted, soloed}
    data: dict = Field(default_factory=dict)


class MixPresetResponse(ORMModel):
    id: uuid.UUID
    name: str
    data: dict
    created_at: datetime


# ─── Routing presets ─────────────────────────────────────────
class RoutingPresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    # {"assignments": {stem_type: {output, channel, label}}, "notes": str}
    data: dict = Field(default_factory=dict)


class RoutingPresetResponse(ORMModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    data: dict
    created_at: datetime


# ─── Setlists / service planning ─────────────────────────────
class SetlistCreate(BaseModel):
    org_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    service_date: str | None = Field(default=None, max_length=20)
    notes: str | None = None


class SetlistUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    service_date: str | None = Field(default=None, max_length=20)
    notes: str | None = None


class SetlistItemCreate(BaseModel):
    song_id: uuid.UUID
    semitones: int = Field(default=0, ge=-12, le=12)
    notes: str | None = None


class SetlistItemUpdate(BaseModel):
    semitones: int | None = Field(default=None, ge=-12, le=12)
    notes: str | None = None


class SetlistItemResponse(ORMModel):
    id: uuid.UUID
    song_id: uuid.UUID
    position: int
    semitones: int
    notes: str | None
    # Denormalized for convenient rendering (filled by the router).
    song_title: str | None = None
    song_status: str | None = None


class SetlistResponse(ORMModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    service_date: str | None
    notes: str | None
    created_at: datetime
    items: list[SetlistItemResponse] = Field(default_factory=list)


class ReorderRequest(BaseModel):
    item_ids: list[uuid.UUID]


# ─── Export / playback package ───────────────────────────────
class PackageStem(BaseModel):
    name: str
    stem_type: str
    url: str


class PackageMarker(BaseModel):
    position_sec: float
    label: str
    kind: str


class PackageResponse(BaseModel):
    song_id: uuid.UUID
    title: str
    semitones: int
    music_key: str | None
    bpm: float | None
    time_signature: str | None
    duration_sec: float | None
    stems: list[PackageStem]
    markers: list[PackageMarker]
    routing: dict | None = None
