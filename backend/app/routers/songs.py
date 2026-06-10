"""Song routes: presigned upload URL, register + enqueue, list/get/delete."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, get_song_for_user
from app.db import get_db
from app.models import Membership, Song, User
from app.schemas import (
    SongCreate,
    SongResponse,
    SongUpdate,
    UploadUrlRequest,
    UploadUrlResponse,
)
from app.storage import delete_prefix, object_exists, presigned_put_url

router = APIRouter(prefix="/songs", tags=["songs"])


def _assert_member(db: Session, user: User, org_id: uuid.UUID) -> None:
    member = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.org_id == org_id
        )
    )
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this organization")


@router.post("/upload-url", response_model=UploadUrlResponse)
def get_upload_url(
    body: UploadUrlRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a presigned PUT URL the browser uses to upload directly to storage."""
    _assert_member(db, user, body.org_id)
    safe_name = body.filename.replace("/", "_")
    key = f"orgs/{body.org_id}/songs/{uuid.uuid4()}/original/{safe_name}"
    return UploadUrlResponse(upload_url=presigned_put_url(key), storage_key=key)


@router.post("", response_model=SongResponse, status_code=status.HTTP_201_CREATED)
def create_song(
    body: SongCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Register an uploaded object as a song and enqueue the processing job."""
    _assert_member(db, user, body.org_id)
    # Verify the key is scoped to this org — prevents referencing another org's file.
    if not body.storage_key.startswith(f"orgs/{body.org_id}/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid storage key")
    if not object_exists(body.storage_key):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Uploaded file not found in storage")

    song = Song(
        org_id=body.org_id,
        title=body.title,
        original_filename=body.original_filename,
        storage_key=body.storage_key,
        status="processing",
        created_by=user.id,
    )
    db.add(song)
    db.commit()
    db.refresh(song)

    # Enqueue async processing. Imported lazily to avoid a hard Celery import at app load.
    from app.worker.tasks import process_song

    process_song.delay(str(song.id))
    return song


@router.get("", response_model=list[SongResponse])
def list_songs(
    org_id: uuid.UUID,
    q: str | None = None,
    folder: str | None = None,
    favorites_only: bool = False,
    include_archived: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _assert_member(db, user, org_id)
    stmt = select(Song).where(Song.org_id == org_id)
    if not include_archived:
        stmt = stmt.where(Song.archived.is_(False))
    if favorites_only:
        stmt = stmt.where(Song.is_favorite.is_(True))
    if folder:
        stmt = stmt.where(Song.folder == folder)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(Song.title.ilike(like))
    # Favorites float to the top, then newest first.
    stmt = stmt.order_by(Song.is_favorite.desc(), Song.created_at.desc())
    return db.scalars(stmt).all()


@router.get("/{song_id}", response_model=SongResponse)
def get_song(song: Song = Depends(get_song_for_user)):
    return song


@router.patch("/{song_id}", response_model=SongResponse)
def update_song(
    body: SongUpdate,
    song: Song = Depends(get_song_for_user),
    db: Session = Depends(get_db),
):
    """Rename, (un)favorite, archive, or move a song into a folder."""
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(song, field, value)
    db.commit()
    db.refresh(song)
    return song


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_song(
    song: Song = Depends(get_song_for_user), db: Session = Depends(get_db)
):
    prefix = f"orgs/{song.org_id}/songs/{song.id}/"
    delete_prefix(prefix)
    db.delete(song)
    db.commit()
