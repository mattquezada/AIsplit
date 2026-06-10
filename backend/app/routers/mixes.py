"""Mix-preset routes: save and recall per-song rehearsal/console mixes."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_song_for_user
from app.db import get_db
from app.models import MixPreset, Song
from app.schemas import MixPresetCreate, MixPresetResponse

router = APIRouter(prefix="/songs", tags=["mixes"])


@router.get("/{song_id}/mixes", response_model=list[MixPresetResponse])
def list_mixes(song: Song = Depends(get_song_for_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(MixPreset).where(MixPreset.song_id == song.id).order_by(MixPreset.name)
    ).all()


@router.post("/{song_id}/mixes", response_model=MixPresetResponse, status_code=201)
def create_mix(
    body: MixPresetCreate,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    # Upsert by name so "Save" over an existing preset overwrites it.
    preset = db.scalar(
        select(MixPreset).where(MixPreset.song_id == song.id, MixPreset.name == body.name)
    )
    if preset is None:
        preset = MixPreset(song_id=song.id, name=body.name, data=body.data)
        db.add(preset)
    else:
        preset.data = body.data
    db.commit()
    db.refresh(preset)
    return preset


@router.delete("/{song_id}/mixes/{mix_id}", status_code=204)
def delete_mix(
    mix_id: uuid.UUID,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    preset = db.scalar(
        select(MixPreset).where(MixPreset.id == mix_id, MixPreset.song_id == song.id)
    )
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mix preset not found")
    db.delete(preset)
    db.commit()
