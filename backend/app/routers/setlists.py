"""Setlist routes: service planning — ordered songs, each at a chosen key."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.models import Membership, Setlist, SetlistItem, Song, User
from app.schemas import (
    ReorderRequest,
    SetlistCreate,
    SetlistItemCreate,
    SetlistItemResponse,
    SetlistResponse,
    SetlistUpdate,
)

router = APIRouter(prefix="/setlists", tags=["setlists"])


def _assert_member(db: Session, user: User, org_id: uuid.UUID) -> None:
    member = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.org_id == org_id
        )
    )
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this organization")


def get_setlist_for_user(
    setlist_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Setlist:
    setlist = db.get(Setlist, setlist_id)
    if setlist is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Setlist not found")
    _assert_member(db, user, setlist.org_id)
    return setlist


def _serialize(setlist: Setlist) -> SetlistResponse:
    """Build a response with denormalized song titles for each item."""
    items = [
        SetlistItemResponse(
            id=it.id,
            song_id=it.song_id,
            position=it.position,
            semitones=it.semitones,
            notes=it.notes,
            song_title=it.song.title if it.song else None,
            song_status=it.song.status if it.song else None,
        )
        for it in setlist.items
    ]
    return SetlistResponse(
        id=setlist.id,
        org_id=setlist.org_id,
        name=setlist.name,
        service_date=setlist.service_date,
        notes=setlist.notes,
        created_at=setlist.created_at,
        items=items,
    )


@router.get("", response_model=list[SetlistResponse])
def list_setlists(
    org_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _assert_member(db, user, org_id)
    setlists = db.scalars(
        select(Setlist)
        .where(Setlist.org_id == org_id)
        .order_by(Setlist.created_at.desc())
    ).all()
    return [_serialize(s) for s in setlists]


@router.post("", response_model=SetlistResponse, status_code=201)
def create_setlist(
    body: SetlistCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _assert_member(db, user, body.org_id)
    setlist = Setlist(
        org_id=body.org_id,
        name=body.name,
        service_date=body.service_date,
        notes=body.notes,
    )
    db.add(setlist)
    db.commit()
    db.refresh(setlist)
    return _serialize(setlist)


@router.get("/{setlist_id}", response_model=SetlistResponse)
def get_setlist(setlist: Setlist = Depends(get_setlist_for_user)):
    return _serialize(setlist)


@router.patch("/{setlist_id}", response_model=SetlistResponse)
def update_setlist(
    body: SetlistUpdate,
    setlist: Setlist = Depends(get_setlist_for_user),
    db: Session = Depends(get_db),
):
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(setlist, field, value)
    db.commit()
    db.refresh(setlist)
    return _serialize(setlist)


@router.delete("/{setlist_id}", status_code=204)
def delete_setlist(
    setlist: Setlist = Depends(get_setlist_for_user), db: Session = Depends(get_db)
):
    db.delete(setlist)
    db.commit()


@router.post("/{setlist_id}/items", response_model=SetlistResponse, status_code=201)
def add_item(
    body: SetlistItemCreate,
    setlist: Setlist = Depends(get_setlist_for_user),
    db: Session = Depends(get_db),
):
    # Song must belong to the same org as the setlist.
    song = db.get(Song, body.song_id)
    if song is None or song.org_id != setlist.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Song not found in this organization")
    next_pos = db.scalar(
        select(func.coalesce(func.max(SetlistItem.position), -1)).where(
            SetlistItem.setlist_id == setlist.id
        )
    )
    item = SetlistItem(
        setlist_id=setlist.id,
        song_id=body.song_id,
        position=int(next_pos) + 1,
        semitones=body.semitones,
        notes=body.notes,
    )
    db.add(item)
    db.commit()
    db.refresh(setlist)
    return _serialize(setlist)


@router.patch("/{setlist_id}/items/{item_id}", response_model=SetlistResponse)
def update_item(
    item_id: uuid.UUID,
    body: SetlistItemUpdate,
    setlist: Setlist = Depends(get_setlist_for_user),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(SetlistItem).where(
            SetlistItem.id == item_id, SetlistItem.setlist_id == setlist.id
        )
    )
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Setlist item not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(setlist)
    return _serialize(setlist)


@router.delete("/{setlist_id}/items/{item_id}", response_model=SetlistResponse)
def delete_item(
    item_id: uuid.UUID,
    setlist: Setlist = Depends(get_setlist_for_user),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(SetlistItem).where(
            SetlistItem.id == item_id, SetlistItem.setlist_id == setlist.id
        )
    )
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Setlist item not found")
    db.delete(item)
    db.commit()
    db.refresh(setlist)
    return _serialize(setlist)


@router.post("/{setlist_id}/reorder", response_model=SetlistResponse)
def reorder_items(
    body: ReorderRequest,
    setlist: Setlist = Depends(get_setlist_for_user),
    db: Session = Depends(get_db),
):
    by_id = {it.id: it for it in setlist.items}
    for pos, item_id in enumerate(body.item_ids):
        item = by_id.get(item_id)
        if item is not None:
            item.position = pos
    db.commit()
    db.refresh(setlist)
    return _serialize(setlist)
