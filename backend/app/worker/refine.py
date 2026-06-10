"""Refine raw separator output into worship-standard stems.

Demucs (`htdemucs_6s`) yields six broad sources — vocals, drums, bass, guitar,
piano, other. Worship rigs (Playback / MultiTracks Prime) think in finer tracks:
Kick, Drums, Bass, Electric, Keys, Synth/Pad, Lead Vocal, BGV. We can't conjure
sources the mix never contained, but two splits are honest, useful DSP:

* **Vocals → Lead Vocal + BGV.** Lead vocals sit dead-center; doubles and
  harmonies are panned. A mid/side decomposition pulls the centered lead from
  the stereo "sides" (the harmonies). If a track is essentially mono (no stereo
  vocal content), there's no BGV to emit and we keep a single Lead Vocal.
* **Drums → Kick + Drums.** A low/high crossover peels the kick (and sub) onto
  its own fader, which engineers almost always want isolated.

Everything else is just relabeled to the worship vocabulary. The function is
tolerant of whatever keys the separator produced (6-stem, 4-stem, or the stub),
so it never assumes guitar/piano exist.
"""
from __future__ import annotations

import numpy as np
import scipy.signal

# stem_type → human label shown in the UI / used for downloads.
STEM_DISPLAY: dict[str, str] = {
    "click": "Click",
    "guide": "Guide",
    "kick": "Kick",
    "drums": "Drums",
    "percussion": "Percussion",
    "bass": "Bass",
    "acoustic": "Acoustic",
    "electric": "Electric",
    "keys": "Keys",
    "synth": "Synth / Pad",
    "lead_vocal": "Lead Vocal",
    "bgv": "BGV",
    # legacy / passthrough names from older runs or the stub
    "vocals": "Vocals",
    "guitar": "Electric",
    "piano": "Keys",
    "other": "Synth / Pad",
}

# How a raw separator source maps to a worship stem_type (when not split).
_RELABEL = {
    "guitar": "electric",
    "piano": "keys",
    "other": "synth",
    "bass": "bass",
}

# Below this side/mid energy ratio, the vocal is effectively mono → no BGV.
_BGV_MIN_RATIO = 0.04
# Kick/drums crossover frequency (Hz).
_KICK_CROSSOVER_HZ = 110.0


def display_name(stem_type: str) -> str:
    return STEM_DISPLAY.get(stem_type, stem_type.replace("_", " ").title())


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x))) + 1e-12)


def _split_vocals(stereo: np.ndarray) -> dict[str, np.ndarray]:
    """Mid/side split: centered lead vs panned harmonies (BGV)."""
    left, right = stereo[0], stereo[1]
    mid = (left + right) * 0.5
    side = (left - right) * 0.5

    lead = np.stack([mid, mid]).astype(np.float32)
    out: dict[str, np.ndarray] = {"lead_vocal": lead}

    if _rms(side) / _rms(mid) >= _BGV_MIN_RATIO:
        # Present the difference content as a mono-summed stereo stem.
        bgv = np.stack([side, side]).astype(np.float32)
        out["bgv"] = bgv
    return out


def _split_drums(stereo: np.ndarray, sr: int) -> dict[str, np.ndarray]:
    """Crossover split: kick/sub vs the rest of the kit."""
    sos = scipy.signal.butter(4, _KICK_CROSSOVER_HZ, btype="low", fs=sr, output="sos")
    kick = np.stack(
        [scipy.signal.sosfilt(sos, stereo[ch]).astype(np.float32) for ch in range(2)]
    )
    rest = (stereo - kick).astype(np.float32)
    return {"kick": kick, "drums": rest}


def refine_stems(stems: dict[str, np.ndarray], sr: int) -> dict[str, np.ndarray]:
    """Map raw separator sources → finer worship stems. Pure, side-effect free."""
    out: dict[str, np.ndarray] = {}
    for source, data in stems.items():
        stereo = data if data.ndim == 2 else np.stack([data, data])
        if source == "vocals":
            out.update(_split_vocals(stereo))
        elif source == "drums":
            out.update(_split_drums(stereo, sr))
        else:
            out[_RELABEL.get(source, source)] = stereo
    return out
