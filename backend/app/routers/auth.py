"""Auth routes: register (creates org + owner membership), login, me."""
from __future__ import annotations

import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

# Simple in-memory sliding-window rate limiter for login (no extra deps).
# Stores per-IP attempt timestamps; trimmed on each request.
_LOGIN_WINDOW_SEC = 60
_LOGIN_MAX_ATTEMPTS = 10
_login_attempts: dict[str, list[float]] = defaultdict(list)

from app.auth.deps import get_current_user
from app.auth.security import create_access_token, hash_password, verify_password
from app.db import get_db
from app.models import Membership, Organization, User
from app.schemas import (
    LoginRequest,
    MeResponse,
    RegisterRequest,
    TokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    existing = db.scalar(select(User).where(User.email == body.email))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    user = User(email=body.email, hashed_password=hash_password(body.password))
    org = Organization(name=body.org_name)
    db.add_all([user, org])
    db.flush()  # assign ids
    db.add(Membership(user_id=user.id, org_id=org.id, role="owner"))
    db.commit()
    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenResponse)
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    window = _login_attempts[ip]
    # Trim attempts older than the window.
    window[:] = [t for t in window if now - t < _LOGIN_WINDOW_SEC]
    if len(window) >= _LOGIN_MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many login attempts — try again in a minute")
    window.append(now)

    user = db.scalar(select(User).where(User.email == body.email))
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    # Clear the counter on success.
    _login_attempts.pop(ip, None)
    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MeResponse:
    memberships = db.scalars(
        select(Membership).where(Membership.user_id == user.id)
    ).all()
    return MeResponse(user=user, memberships=memberships)
