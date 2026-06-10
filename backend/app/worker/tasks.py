"""Celery task definitions — thin wrappers around the pipeline."""
from __future__ import annotations

from app.worker.celery_app import celery
from app.worker.pipeline import run_pipeline
from app.worker.transpose import transpose_song as _transpose_song


@celery.task(name="process_song", bind=True, max_retries=0)
def process_song(self, song_id: str) -> str:
    run_pipeline(song_id)
    return song_id


@celery.task(name="transpose_song", bind=True, max_retries=0)
def transpose_song(self, song_id: str, semitones: int) -> str:
    _transpose_song(song_id, semitones)
    return song_id
