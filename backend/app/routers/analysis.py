"""Analysis + marker routes: read detected values, apply manual edits."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_song_for_user
from app.db import get_db
from app.models import Analysis, Marker, Song
from app.schemas import (
    AnalysisResponse,
    AnalysisUpdate,
    MarkerCreate,
    MarkerResponse,
    MarkerUpdate,
)

router = APIRouter(prefix="/songs", tags=["analysis"])


@router.get("/{song_id}/analysis", response_model=AnalysisResponse)
def get_analysis(song: Song = Depends(get_song_for_user), db: Session = Depends(get_db)):
    analysis = db.scalar(select(Analysis).where(Analysis.song_id == song.id))
    if analysis is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Analysis not ready")
    return analysis


@router.patch("/{song_id}/analysis", response_model=AnalysisResponse)
def update_analysis(
    body: AnalysisUpdate,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    analysis = db.scalar(select(Analysis).where(Analysis.song_id == song.id))
    if analysis is None:
        analysis = Analysis(song_id=song.id)
        db.add(analysis)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(analysis, field, value)
    db.commit()
    db.refresh(analysis)
    return analysis


# ─── Markers ─────────────────────────────────────────────────
@router.get("/{song_id}/markers", response_model=list[MarkerResponse])
def list_markers(song: Song = Depends(get_song_for_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(Marker).where(Marker.song_id == song.id).order_by(Marker.position_sec)
    ).all()


@router.post("/{song_id}/markers", response_model=MarkerResponse, status_code=201)
def create_marker(
    body: MarkerCreate,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    marker = Marker(song_id=song.id, **body.model_dump())
    db.add(marker)
    db.commit()
    db.refresh(marker)
    return marker


@router.patch("/{song_id}/markers/{marker_id}", response_model=MarkerResponse)
def update_marker(
    marker_id: uuid.UUID,
    body: MarkerUpdate,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    marker = db.scalar(
        select(Marker).where(Marker.id == marker_id, Marker.song_id == song.id)
    )
    if marker is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Marker not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(marker, field, value)
    db.commit()
    db.refresh(marker)
    return marker


@router.delete("/{song_id}/markers/{marker_id}", status_code=204)
def delete_marker(
    marker_id: uuid.UUID,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    marker = db.scalar(
        select(Marker).where(Marker.id == marker_id, Marker.song_id == song.id)
    )
    if marker is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Marker not found")
    db.delete(marker)
    db.commit()
