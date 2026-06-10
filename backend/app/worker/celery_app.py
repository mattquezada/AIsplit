"""Celery application — broker/result backend on Redis."""
from __future__ import annotations

from celery import Celery

from app.config import settings
from app.logging_config import configure_logging

configure_logging()

celery = Celery(
    "aisplit",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.worker.tasks"],
)

celery.conf.update(
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)
