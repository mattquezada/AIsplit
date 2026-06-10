"""Processing pipeline — orchestrates analyze + separate for one song.

Kept free of Celery so it can be unit-tested directly. `tasks.process_song`
is the thin Celery wrapper that calls `run_pipeline`.
"""
from __future__ import annotations

import logging
import os
import tempfile
from datetime import datetime, timezone

import librosa
import numpy as np
import soundfile as sf
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import Analysis, Job, Marker, Song, Stem
from app.storage import download_to_file, upload_file
from app.worker.analyze import LibrosaAnalyzer
from app.worker.refine import display_name, refine_stems
from app.worker.separate import get_separator

log = logging.getLogger("aisplit.pipeline")

TARGET_SR = 44100


def _set_progress(db: Session, job: Job, pct: int) -> None:
    job.progress = pct
    db.commit()


def run_pipeline(song_id: str) -> None:
    """Full processing for a song. Idempotent enough to retry from scratch."""
    db = SessionLocal()
    job: Job | None = None
    song: Song | None = None
    try:
        song = db.get(Song, song_id)
        if song is None:
            log.warning("Song %s vanished before processing", song_id)
            return

        job = Job(song_id=song.id, type="process", status="running", progress=0)
        job.started_at = datetime.now(timezone.utc)
        db.add(job)
        song.status = "processing"
        db.commit()

        with tempfile.TemporaryDirectory() as tmp:
            # 1. Download original.
            local_in = os.path.join(tmp, "original")
            download_to_file(song.storage_key, local_in)
            _set_progress(db, job, 10)

            # 2. Decode → stereo float32 at TARGET_SR.
            audio, sr = librosa.load(local_in, sr=TARGET_SR, mono=False)
            if audio.ndim == 1:
                audio = np.stack([audio, audio])
            duration = float(audio.shape[-1] / sr)
            song.duration_sec = round(duration, 3)
            song.sample_rate = sr
            db.commit()
            _set_progress(db, job, 25)

            # 3. Analyze.
            result = LibrosaAnalyzer().analyze(audio, sr)
            _persist_analysis(db, song, result)
            _set_progress(db, job, 50)

            # 4. Separate, then refine into worship-standard stems
            # (Lead Vocal/BGV, Kick/Drums, Electric, Keys, Synth/Pad…).
            separator = get_separator()
            log.info("Separating %s with %s", song.id, separator.name)
            stems = separator.separate(audio, sr)
            if settings.refine_stems:
                stems = refine_stems(stems, sr)
            _set_progress(db, job, 75)

            # Note: the click is no longer baked as an audio stem. It's
            # synthesized in the browser from the (editable) BPM + click offset,
            # so it stays perfectly steady and can be nudged per song.

            # 5. Encode + upload each stem.
            _write_stems(db, song, stems, sr, tmp)
            _set_progress(db, job, 95)

        song.status = "ready"
        job.status = "succeeded"
        job.progress = 100
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        log.info("Song %s processed successfully", song_id)

    except Exception as exc:  # noqa: BLE001 — record failure, never crash the worker
        log.exception("Pipeline failed for song %s", song_id)
        db.rollback()
        if job is not None:
            job.status = "failed"
            job.error = str(exc)[:2000]
            job.finished_at = datetime.now(timezone.utc)
        if song is not None:
            song.status = "failed"
        db.commit()
        raise
    finally:
        db.close()


def _persist_analysis(db: Session, song: Song, result) -> None:
    analysis = db.scalar(select(Analysis).where(Analysis.song_id == song.id))
    if analysis is None:
        analysis = Analysis(song_id=song.id)
        db.add(analysis)
    analysis.bpm = result.bpm
    analysis.bpm_confidence = result.bpm_confidence
    analysis.music_key = result.music_key
    analysis.key_confidence = result.key_confidence
    analysis.time_signature = result.time_signature
    analysis.click_offset_sec = result.click_offset_sec
    analysis.beat_grid = result.beat_grid
    analysis.downbeats = result.downbeats
    analysis.tempo_map = result.tempo_map
    analysis.sections = result.sections

    # Seed section markers (replace any previous auto-seeded ones).
    db.query(Marker).filter(Marker.song_id == song.id, Marker.kind == "section").delete()
    for section in result.sections:
        db.add(
            Marker(
                song_id=song.id,
                position_sec=section["start"],
                label=section["label"],
                kind="section",
            )
        )
    db.commit()


def _write_stems(
    db: Session, song: Song, stems: dict[str, np.ndarray], sr: int, tmp: str
) -> None:
    # Clear any stems from a previous run.
    db.query(Stem).filter(Stem.song_id == song.id).delete()
    db.commit()

    for name, data in stems.items():
        # soundfile expects shape (n, channels).
        arr = data.T if data.ndim == 2 else np.stack([data, data]).T
        peak = float(np.max(np.abs(arr))) or 1.0
        if peak > 1.0:
            arr = arr / peak  # guard against clipping
        local_out = os.path.join(tmp, f"{name}.wav")
        sf.write(local_out, arr.astype(np.float32), sr, subtype="PCM_16")

        key = f"orgs/{song.org_id}/songs/{song.id}/stems/{name}.wav"
        upload_file(local_out, key)
        db.add(
            Stem(
                song_id=song.id,
                name=display_name(name),
                stem_type=name,
                storage_key=key,
                duration_sec=song.duration_sec,
                pitch_semitones=0,
            )
        )
    db.commit()
