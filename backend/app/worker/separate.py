"""Source separation — Separator interface + real Demucs + a DSP stub.

`DemucsSeparator` runs Meta's htdemucs models. `htdemucs_6s` yields six sources
(vocals, drums, bass, guitar, piano, other) — the model that actually pulls
keys/guitar apart. The model is loaded once per worker process and cached.

`StubSeparator` is the fast, dependency-light DSP fallback (no torch).

Select via the SEPARATION_MODEL env / settings.separation_model.
"""
from __future__ import annotations

import logging
import threading
from typing import Protocol

import librosa
import numpy as np
import scipy.signal

from app.config import settings

log = logging.getLogger("aisplit.separate")


class Separator(Protocol):
    def separate(self, audio: np.ndarray, sr: int) -> dict[str, np.ndarray]:
        """Return {stem_name: stereo float32 array (2, n)} keyed by stem type."""
        ...

    @property
    def name(self) -> str: ...


def _as_stereo(audio: np.ndarray) -> np.ndarray:
    """Normalize to shape (2, n)."""
    if audio.ndim == 1:
        return np.stack([audio, audio])
    if audio.shape[0] == 2:
        return audio
    if audio.shape[1] == 2:  # (n, 2) → (2, n)
        return audio.T
    mono = librosa.to_mono(audio)
    return np.stack([mono, mono])


# ─── Real model ──────────────────────────────────────────────────────────────
class DemucsSeparator:
    """Meta Demucs (htdemucs / htdemucs_6s). CPU-capable; GPU if available.

    The model download (~250 MB) happens once and is cached under /root/.cache
    (mount a volume there so it survives container restarts).
    """

    _model = None
    _lock = threading.Lock()

    def __init__(self, model_name: str = "htdemucs_6s") -> None:
        self.model_name = model_name

    @property
    def name(self) -> str:
        return self.model_name

    def _get_model(self):
        if DemucsSeparator._model is None:
            with DemucsSeparator._lock:
                if DemucsSeparator._model is None:
                    from demucs.pretrained import get_model

                    log.info("Loading Demucs model %s (first run downloads it)", self.model_name)
                    model = get_model(self.model_name)
                    model.cpu()
                    model.eval()
                    DemucsSeparator._model = model
        return DemucsSeparator._model

    def separate(self, audio: np.ndarray, sr: int) -> dict[str, np.ndarray]:
        import torch
        from demucs.apply import apply_model

        model = self._get_model()

        stereo = _as_stereo(audio).astype(np.float32)
        # Resample to the model's native rate if needed.
        if sr != model.samplerate:
            stereo = np.stack(
                [librosa.resample(ch, orig_sr=sr, target_sr=model.samplerate) for ch in stereo]
            )

        wav = torch.from_numpy(stereo)
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)

        with torch.no_grad():
            sources = apply_model(
                model,
                wav[None],
                device="cpu",
                split=True,
                overlap=0.25,
                shifts=settings.separation_shifts,
                progress=False,
            )[0]
        sources = sources * ref.std() + ref.mean()

        out: dict[str, np.ndarray] = {}
        for source_name, tensor in zip(model.sources, sources):
            data = tensor.cpu().numpy().astype(np.float32)  # (2, n) at model.samplerate
            # Resample stems back to the pipeline rate so all stems share length/sr.
            if sr != model.samplerate:
                data = np.stack(
                    [librosa.resample(ch, orig_sr=model.samplerate, target_sr=sr) for ch in data]
                )
            out[source_name] = data
        return out


# ─── DSP fallback ────────────────────────────────────────────────────────────
class StubSeparator:
    """CPU DSP separation. Output is approximate — placeholder for real models."""

    name = "stub-dsp-v1"

    def separate(self, audio: np.ndarray, sr: int) -> dict[str, np.ndarray]:
        stereo = _as_stereo(audio).astype(np.float32)
        left, right = stereo[0], stereo[1]
        mid = (left + right) / 2.0
        side = (left - right) / 2.0

        vocals = np.stack([mid, mid])
        harmonic, percussive = librosa.effects.hpss(mid)
        drums = np.stack([percussive + side * 0.5, percussive - side * 0.5])

        sos = scipy.signal.butter(4, 250, btype="low", fs=sr, output="sos")
        bass_mono = scipy.signal.sosfilt(sos, harmonic).astype(np.float32)
        bass = np.stack([bass_mono, bass_mono])

        other_mono = (harmonic - bass_mono).astype(np.float32)
        other = np.stack([other_mono + side, other_mono - side])

        return {"vocals": vocals, "drums": drums, "bass": bass, "other": other}


def get_separator() -> Separator:
    """Factory — returns the active separator based on settings."""
    model = settings.separation_model
    if model == "stub":
        return StubSeparator()
    return DemucsSeparator(model_name=model)
