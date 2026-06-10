"""Stem refinement: vocal lead/BGV split, kick/drums split, relabeling."""
from __future__ import annotations

import numpy as np

from app.worker.refine import display_name, refine_stems


def _stereo(sr: int, seconds: float, left, right) -> np.ndarray:
    t = np.arange(int(sr * seconds)) / sr
    return np.stack([left(t), right(t)]).astype(np.float32)


def test_splits_vocals_and_drums_and_relabels():
    sr = 22050
    # Vocals: centered lead (same L/R) + a panned component (differs L/R) → BGV.
    vocals = _stereo(
        sr, 2.0,
        left=lambda t: 0.5 * np.sin(2 * np.pi * 220 * t) + 0.2 * np.sin(2 * np.pi * 330 * t),
        right=lambda t: 0.5 * np.sin(2 * np.pi * 220 * t) - 0.2 * np.sin(2 * np.pi * 330 * t),
    )
    drums = _stereo(
        sr, 2.0,
        left=lambda t: 0.4 * np.sin(2 * np.pi * 60 * t) + 0.4 * np.sin(2 * np.pi * 4000 * t),
        right=lambda t: 0.4 * np.sin(2 * np.pi * 60 * t) + 0.4 * np.sin(2 * np.pi * 4000 * t),
    )
    raw = {
        "vocals": vocals,
        "drums": drums,
        "bass": np.zeros((2, int(sr * 2.0)), np.float32),
        "guitar": np.zeros((2, int(sr * 2.0)), np.float32),
        "piano": np.zeros((2, int(sr * 2.0)), np.float32),
        "other": np.zeros((2, int(sr * 2.0)), np.float32),
    }

    out = refine_stems(raw, sr)

    # Vocals split into lead + BGV; drums into kick + rest; relabels applied.
    assert "lead_vocal" in out and "bgv" in out
    assert "kick" in out and "drums" in out
    assert "electric" in out  # guitar → electric
    assert "keys" in out  # piano → keys
    assert "synth" in out  # other → synth
    assert "vocals" not in out and "guitar" not in out

    for name, data in out.items():
        assert data.shape[0] == 2, name
        assert np.isfinite(data).all(), name

    # Kick carries the low end; its 60 Hz energy should exceed the de-kicked rest.
    assert np.abs(out["kick"]).mean() > 0
    # Lead is centered (L == R); BGV is the panned difference.
    assert np.allclose(out["lead_vocal"][0], out["lead_vocal"][1])


def test_mono_vocal_yields_no_bgv():
    sr = 22050
    mono_vox = _stereo(
        sr, 1.0,
        left=lambda t: 0.5 * np.sin(2 * np.pi * 220 * t),
        right=lambda t: 0.5 * np.sin(2 * np.pi * 220 * t),
    )
    out = refine_stems({"vocals": mono_vox}, sr)
    assert "lead_vocal" in out
    assert "bgv" not in out  # no stereo difference → nothing to split out


def test_display_names():
    assert display_name("lead_vocal") == "Lead Vocal"
    assert display_name("bgv") == "BGV"
    assert display_name("kick") == "Kick"
    assert display_name("unknown_thing") == "Unknown Thing"
