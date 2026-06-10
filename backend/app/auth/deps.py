"""FastAPI auth dependencies: current user + org-membership enforcement."""
from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.security import decode_token
from app.db import get_db
from app.models import Membership, Song, User

_bearer = HTTPBearer(auto_error=True)


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    user_id = decode_token(creds.credentials)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


def require_org_member(
    org_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Membership:
    """Assert the current user belongs to `org_id`; return the membership."""
    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.org_id == org_id
        )
    )
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this organization")
    return membership


def get_song_for_user(
    song_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Song:
    """Load a song and verify the user is a member of its org (tenant isolation)."""
    song = db.get(Song, song_id)
    if song is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Song not found")
    member = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.org_id == song.org_id
        )
    )
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized for this song")
    return song
