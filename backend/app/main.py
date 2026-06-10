"""FastAPI application entrypoint."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.logging_config import configure_logging
from app.routers import (
    analysis,
    auth,
    export,
    guide,
    jobs,
    mixes,
    orgs,
    routing,
    setlists,
    songs,
    stems,
)
from app.storage import ensure_bucket

configure_logging()
log = logging.getLogger("aisplit.api")

app = FastAPI(title="AI Worship Multitrack Platform", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    try:
        ensure_bucket()
    except Exception:  # storage may briefly be unavailable on first boot
        log.warning("Could not ensure storage bucket at startup", exc_info=True)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


for router in (
    auth.router,
    orgs.router,
    songs.router,
    jobs.router,
    analysis.router,
    stems.router,
    guide.router,
    mixes.router,
    routing.router,
    setlists.router,
    export.router,
):
    app.include_router(router)
