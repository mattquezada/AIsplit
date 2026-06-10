"""Job status route — the frontend polls this while a song processes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_song_for_user
from app.db import get_db
from app.models import Job, Song
from app.schemas import JobResponse

router = APIRouter(prefix="/songs", tags=["jobs"])


@router.get("/{song_id}/job", response_model=JobResponse)
def get_latest_job(
    song: Song = Depends(get_song_for_user), db: Session = Depends(get_db)
):
    job = db.scalar(
        select(Job).where(Job.song_id == song.id).order_by(Job.created_at.desc())
    )
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No job for this song")
    return job
