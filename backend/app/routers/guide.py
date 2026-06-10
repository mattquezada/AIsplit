"""Guide-track route: the spoken-cue schedule for a song.

The guide voice announces each section as it arrives. Cues are derived from the
song's section/cue markers (which the user edits), so a custom arrangement —
Verse, Chorus, Bridge laid out however they like — drives the guide directly.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_song_for_user
from app.db import get_db
from app.models import Analysis, Marker, Song
from app.schemas import GuideCue, GuideResponse

router = APIRouter(prefix="/songs", tags=["guide"])


def _beats_per_bar(time_signature: str | None) -> int:
    try:
        n = int((time_signature or "4/4").split("/")[0])
        return n if n > 0 else 4
    except (ValueError, IndexError):
        return 4


@router.get("/{song_id}/guide", response_model=GuideResponse)
def get_guide(
    count_in_bars: int = 1,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    markers = db.scalars(
        select(Marker)
        .where(Marker.song_id == song.id, Marker.kind.in_(("section", "cue")))
        .order_by(Marker.position_sec)
    ).all()
    analysis = db.scalar(select(Analysis).where(Analysis.song_id == song.id))
    bpb = _beats_per_bar(analysis.time_signature if analysis else None)

    return GuideResponse(
        beats_per_bar=bpb,
        count_in_bars=max(0, min(count_in_bars, 4)),
        cues=[GuideCue(time=m.position_sec, text=m.label) for m in markers],
    )
