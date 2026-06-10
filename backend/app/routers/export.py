"""Playback-package export: a self-contained manifest of one song at a key.

Bundles everything a playback rig needs — stems (presigned), tempo/key, section
markers, and an optional venue routing map — into one JSON descriptor the client
can save or feed to a player.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_song_for_user
from app.db import get_db
from app.models import Analysis, Marker, RoutingPreset, Song, Stem
from app.schemas import PackageMarker, PackageResponse, PackageStem
from app.storage import presigned_get_url

router = APIRouter(prefix="/songs", tags=["export"])

_CHROMA = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _shift_key(detected: str | None, semitones: int) -> str | None:
    if not detected:
        return None
    parts = detected.split(" ")
    if parts[0] not in _CHROMA:
        return detected
    idx = (_CHROMA.index(parts[0]) + semitones) % 12
    return " ".join([_CHROMA[idx], *parts[1:]])


@router.get("/{song_id}/package", response_model=PackageResponse)
def build_package(
    semitones: int = 0,
    routing_preset_id: str | None = None,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    stems = db.scalars(
        select(Stem)
        .where(Stem.song_id == song.id, Stem.pitch_semitones == semitones)
        .order_by(Stem.name)
    ).all()
    if not stems:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No stems rendered at this key yet — transpose first.",
        )

    analysis = db.scalar(select(Analysis).where(Analysis.song_id == song.id))
    markers = db.scalars(
        select(Marker).where(Marker.song_id == song.id).order_by(Marker.position_sec)
    ).all()

    routing = None
    if routing_preset_id:
        preset = db.get(RoutingPreset, routing_preset_id)
        if preset is not None and preset.org_id == song.org_id:
            routing = {"name": preset.name, **preset.data}

    return PackageResponse(
        song_id=song.id,
        title=song.title,
        semitones=semitones,
        music_key=_shift_key(analysis.music_key if analysis else None, semitones),
        bpm=analysis.bpm if analysis else None,
        time_signature=analysis.time_signature if analysis else None,
        duration_sec=song.duration_sec,
        stems=[
            PackageStem(
                name=s.name,
                stem_type=s.stem_type,
                url=presigned_get_url(s.storage_key, download_name=f"{s.name}.wav"),
            )
            for s in stems
        ],
        markers=[
            PackageMarker(position_sec=m.position_sec, label=m.label, kind=m.kind)
            for m in markers
        ],
        routing=routing,
    )
