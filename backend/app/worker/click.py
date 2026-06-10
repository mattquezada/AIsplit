"""Click-track synthesis aligned to a detected beat grid.

The "click" is a synthesized handclap (band-passed noise burst with a sharp
transient and a few closely-spaced micro-bursts to emulate multiple hands).
Downbeats are brighter/louder so players hear the bar boundaries. Used both in
the main pipeline and by the "regenerate click" path after a BPM/grid edit.
"""
from __future__ import annotations

import numpy as np
import scipy.signal


def _clap(sr: int, gain: float = 0.8, bright: bool = False) -> np.ndarray:
    """A short handclap: band-passed noise with a multi-burst, fast-decay envelope."""
    dur = 0.13
    n = int(sr * dur)
    t = np.arange(n) / sr

    # Deterministic noise so every clap sounds consistent.
    rng = np.random.default_rng(1234)
    noise = rng.standard_normal(n).astype(np.float32)

    # Band-pass into the clap frequency range (brighter for downbeats).
    lo, hi = (1200.0, 3200.0) if bright else (900.0, 2600.0)
    sos = scipy.signal.butter(4, [lo, hi], btype="band", fs=sr, output="sos")
    filtered = scipy.signal.sosfilt(sos, noise).astype(np.float32)

    # Multi-transient envelope: a main body plus a few quick pre-bursts (hands).
    env = np.exp(-t * 45.0)
    for delay, amp in ((0.004, 0.6), (0.010, 0.4), (0.017, 0.28)):
        k = int(delay * sr)
        if k < n:
            env[k:] += amp * np.exp(-t[: n - k] * 65.0)
    env = env / float(env.max())

    clap = filtered * env
    # Sharp attack.
    atk = max(1, int(0.0008 * sr))
    clap[:atk] *= np.linspace(0.0, 1.0, atk, dtype=np.float32)

    peak = float(np.max(np.abs(clap))) or 1.0
    return (clap / peak * gain).astype(np.float32)


def generate_click(
    beat_times: list[float],
    downbeat_times: list[float],
    duration_sec: float,
    sr: int,
) -> np.ndarray:
    """Render a stereo (2, n) clap-style click track at the given beat times."""
    n = max(1, int(round(duration_sec * sr)))
    mono = np.zeros(n, dtype=np.float32)

    downbeats = set(round(t, 3) for t in (downbeat_times or []))
    beat_clap = _clap(sr, gain=0.7, bright=False)
    down_clap = _clap(sr, gain=1.0, bright=True)

    for t in beat_times or []:
        start = int(round(t * sr))
        if start >= n:
            continue
        clap = down_clap if round(t, 3) in downbeats else beat_clap
        end = min(n, start + len(clap))
        mono[start:end] += clap[: end - start]

    peak = float(np.max(np.abs(mono))) or 1.0
    if peak > 1.0:
        mono = mono / peak
    return np.stack([mono, mono])
