"""Hermetic audio unit tests — no DB, storage, or broker needed."""
from __future__ import annotations

import numpy as np

from app.worker.analyze import LibrosaAnalyzer
from app.worker.separate import StubSeparator


def _click_track(bpm: float, sr: int, seconds: float) -> np.ndarray:
    """Synthesize a metronome at a known tempo plus a tone, as a stereo signal."""
    n = int(sr * seconds)
    t = np.arange(n) / sr
    sig = 0.2 * np.sin(2 * np.pi * 220 * t)  # A3 drone
    interval = sr * 60.0 / bpm
    for k in range(int(seconds * bpm / 60.0)):
        start = int(k * interval)
        sig[start : start + 200] += np.hanning(200) if start + 200 <= n else 0
    return np.stack([sig, sig]).astype(np.float32)


def test_analyzer_detects_tempo_and_key():
    sr = 22050
    audio = _click_track(bpm=120, sr=sr, seconds=8)
    result = LibrosaAnalyzer().analyze(audio, sr)

    assert 40 < result.bpm < 240
    assert result.music_key  # non-empty, e.g. "A minor"
    assert result.time_signature == "4/4"
    assert len(result.beat_grid) > 0
    assert 0.0 <= result.bpm_confidence <= 1.0
    assert 0.0 <= result.key_confidence <= 1.0
    assert len(result.sections) >= 1


def test_stub_separator_returns_four_stereo_stems():
    sr = 22050
    audio = _click_track(bpm=100, sr=sr, seconds=4)
    stems = StubSeparator().separate(audio, sr)

    assert set(stems.keys()) == {"vocals", "drums", "bass", "other"}
    for name, data in stems.items():
        assert data.ndim == 2, name
        assert data.shape[0] == 2, name  # stereo
        assert data.shape[1] == audio.shape[1], name  # same length
        assert np.isfinite(data).all(), name


def test_separator_handles_mono_input():
    sr = 22050
    mono = np.sin(2 * np.pi * 200 * np.arange(sr * 2) / sr).astype(np.float32)
    stems = StubSeparator().separate(mono, sr)
    assert stems["vocals"].shape[0] == 2
