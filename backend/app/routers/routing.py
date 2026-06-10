"""Routing-preset routes: reusable sound-board / interface maps per org/venue."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import require_org_member
from app.db import get_db
from app.models import Membership, RoutingPreset
from app.schemas import RoutingPresetCreate, RoutingPresetResponse

router = APIRouter(prefix="/orgs", tags=["routing"])


@router.get("/{org_id}/routing-presets", response_model=list[RoutingPresetResponse])
def list_routing_presets(
    org_id: uuid.UUID,
    membership: Membership = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    return db.scalars(
        select(RoutingPreset)
        .where(RoutingPreset.org_id == org_id)
        .order_by(RoutingPreset.name)
    ).all()


@router.post(
    "/{org_id}/routing-presets", response_model=RoutingPresetResponse, status_code=201
)
def create_routing_preset(
    org_id: uuid.UUID,
    body: RoutingPresetCreate,
    membership: Membership = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    # Upsert by name so re-saving a venue overwrites it.
    preset = db.scalar(
        select(RoutingPreset).where(
            RoutingPreset.org_id == org_id, RoutingPreset.name == body.name
        )
    )
    if preset is None:
        preset = RoutingPreset(org_id=org_id, name=body.name, data=body.data)
        db.add(preset)
    else:
        preset.data = body.data
    db.commit()
    db.refresh(preset)
    return preset


@router.delete("/{org_id}/routing-presets/{preset_id}", status_code=204)
def delete_routing_preset(
    org_id: uuid.UUID,
    preset_id: uuid.UUID,
    membership: Membership = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    preset = db.scalar(
        select(RoutingPreset).where(
            RoutingPreset.id == preset_id, RoutingPreset.org_id == org_id
        )
    )
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Routing preset not found")
    db.delete(preset)
    db.commit()
