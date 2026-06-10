"""Key transposition — render pitch-shifted stem variants (tempo preserved).

Given a song's original stems (pitch_semitones == 0), produce a self-contained
set at ±N semitones: pitched instruments are shifted with Rubber Band (high
quality), while drums and the click are copied through unshifted (pitch-shifting
percussion sounds bad). The result is a complete, playable stem set at the new key.
"""
from __future__ import annotations

import logging
import os
import tempfile
from datetime import datetime, timezone

import numpy as np
import pyrubberband as pyrb
import soundfile as sf
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Job, Song, Stem
from app.storage import download_to_file, upload_file

log = logging.getLogger("aisplit.transpose")

# Stem types that should NOT be pitch-shifted (copied through as-is).
# Percussion sounds bad pitched; the click (if any legacy stem) is metronomic.
_NO_SHIFT = {"drums", "kick", "percussion", "click"}


def _shift_file(src: str, dst: str, semitones: int) -> None:
    data, sr = sf.read(src, always_2d=True)  # (n, channels)
    shifted = np.empty_like(data)
    for ch in range(data.shape[1]):
        shifted[:, ch] = pyrb.pitch_shift(data[:, ch], sr, n_steps=semitones)
    sf.write(dst, shifted, sr, subtype="PCM_16")


def transpose_song(song_id: str, semitones: int) -> None:
    if semitones == 0:
        return
    semitones = max(-12, min(12, int(semitones)))
    sign = "p" if semitones >= 0 else "m"
    variant = f"{sign}{abs(semitones)}"

    db = SessionLocal()
    job: Job | None = None
    try:
        song = db.get(Song, song_id)
        if song is None:
            return

        # Already rendered? Then it's a no-op.
        existing = db.scalar(
            select(Stem).where(Stem.song_id == song.id, Stem.pitch_semitones == semitones)
        )
        if existing:
            log.info("Transpose %s @ %+d already exists", song_id, semitones)
            return

        originals = db.scalars(
            select(Stem).where(Stem.song_id == song.id, Stem.pitch_semitones == 0)
        ).all()
        if not originals:
            raise RuntimeError("No original stems to transpose")

        job = Job(song_id=song.id, type="transpose", status="running", progress=0)
        job.started_at = datetime.now(timezone.utc)
        db.add(job)
        db.commit()

        with tempfile.TemporaryDirectory() as tmp:
            total = len(originals)
            for idx, stem in enumerate(originals):
                local_in = os.path.join(tmp, f"in_{idx}")
                download_to_file(stem.storage_key, local_in)
                local_out = os.path.join(tmp, f"out_{idx}.wav")

                if stem.stem_type in _NO_SHIFT:
                    data, sr = sf.read(local_in, always_2d=True)
                    sf.write(local_out, data, sr, subtype="PCM_16")
                else:
                    _shift_file(local_in, local_out, semitones)

                key = f"orgs/{song.org_id}/songs/{song.id}/stems_{variant}/{stem.stem_type}.wav"
                upload_file(local_out, key)
                db.add(
                    Stem(
                        song_id=song.id,
                        name=f"{stem.name} ({semitones:+d})",
                        stem_type=stem.stem_type,
                        storage_key=key,
                        duration_sec=stem.duration_sec,
                        pitch_semitones=semitones,
                    )
                )
                job.progress = int((idx + 1) / total * 100)
                db.commit()

        job.status = "succeeded"
        job.progress = 100
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        log.info("Transposed %s by %+d semitones", song_id, semitones)

    except Exception as exc:  # noqa: BLE001
        log.exception("Transpose failed for %s", song_id)
        db.rollback()
        if job is not None:
            job.status = "failed"
            job.error = str(exc)[:2000]
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
        raise
    finally:
        db.close()
