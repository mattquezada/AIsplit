"""Organization routes: list own orgs, create org, add member."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_org_member
from app.db import get_db
from app.models import Membership, Organization, User
from app.schemas import AddMemberRequest, MembershipResponse, OrgCreate, OrgResponse

router = APIRouter(prefix="/orgs", tags=["orgs"])


@router.get("", response_model=list[OrgResponse])
def list_orgs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orgs = db.scalars(
        select(Organization)
        .join(Membership, Membership.org_id == Organization.id)
        .where(Membership.user_id == user.id)
    ).all()
    return orgs


@router.post("", response_model=OrgResponse, status_code=status.HTTP_201_CREATED)
def create_org(
    body: OrgCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    org = Organization(name=body.name)
    db.add(org)
    db.flush()
    db.add(Membership(user_id=user.id, org_id=org.id, role="owner"))
    db.commit()
    db.refresh(org)
    return org


@router.post("/{org_id}/members", response_model=MembershipResponse, status_code=201)
def add_member(
    org_id: uuid.UUID,
    body: AddMemberRequest,
    membership: Membership = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    if membership.role not in ("owner", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires owner/admin role")
    target = db.scalar(select(User).where(User.email == body.email))
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    existing = db.scalar(
        select(Membership).where(
            Membership.user_id == target.id, Membership.org_id == org_id
        )
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already a member")
    new_membership = Membership(user_id=target.id, org_id=org_id, role=body.role)
    db.add(new_membership)
    db.commit()
    db.refresh(new_membership)
    return new_membership
