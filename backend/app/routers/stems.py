"""Stem routes: list stems (with playback URLs) and per-stem download URL."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, get_song_for_user
from app.db import get_db
from app.models import Membership, Song, Stem, User
from app.schemas import (
    DownloadUrlResponse,
    StemWithUrlResponse,
    TransposeRequest,
    TransposeResponse,
)
from app.storage import presigned_get_url

router = APIRouter(tags=["stems"])


@router.get("/songs/{song_id}/stems", response_model=list[StemWithUrlResponse])
def list_stems(
    semitones: int = 0,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    """List stems at a given transposition (0 = originals)."""
    stems = db.scalars(
        select(Stem)
        .where(Stem.song_id == song.id, Stem.pitch_semitones == semitones)
        .order_by(Stem.name)
    ).all()
    return [
        StemWithUrlResponse(
            id=s.id,
            name=s.name,
            stem_type=s.stem_type,
            duration_sec=s.duration_sec,
            pitch_semitones=s.pitch_semitones,
            url=presigned_get_url(s.storage_key),
        )
        for s in stems
    ]


@router.post("/songs/{song_id}/transpose", response_model=TransposeResponse)
def transpose(
    body: TransposeRequest,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    """Render (or reuse) a pitch-shifted variant of the song's stems."""
    if body.semitones == 0:
        return TransposeResponse(semitones=0, status="ready")

    existing = db.scalar(
        select(Stem).where(
            Stem.song_id == song.id, Stem.pitch_semitones == body.semitones
        )
    )
    if existing:
        return TransposeResponse(semitones=body.semitones, status="ready")

    from app.worker.tasks import transpose_song

    transpose_song.delay(str(song.id), body.semitones)
    return TransposeResponse(semitones=body.semitones, status="processing")


@router.get("/stems/{stem_id}/download", response_model=DownloadUrlResponse)
def download_stem(
    stem_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stem = db.get(Stem, stem_id)
    if stem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stem not found")
    song = db.get(Song, stem.song_id)
    member = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.org_id == song.org_id
        )
    )
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized for this stem")
    name = f"{stem.name}.wav"
    return DownloadUrlResponse(url=presigned_get_url(stem.storage_key, download_name=name))
