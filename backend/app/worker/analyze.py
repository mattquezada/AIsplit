"""Audio analysis — Analyzer interface + LibrosaAnalyzer (MVP).

Swap in a stronger model later (e.g. a learned beat/key/section model) by
implementing the same `Analyzer` protocol.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import librosa
import numpy as np

# Krumhansl-Schmuckler key profiles (major/minor), normalized.
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
_PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


@dataclass
class AnalysisResult:
    bpm: float
    bpm_confidence: float
    music_key: str
    key_confidence: float
    time_signature: str
    beat_grid: list[float]
    downbeats: list[float]
    click_offset_sec: float = 0.0
    tempo_map: list[dict] = field(default_factory=list)
    sections: list[dict] = field(default_factory=list)


class Analyzer(Protocol):
    def analyze(self, audio: np.ndarray, sr: int) -> AnalysisResult: ...


class LibrosaAnalyzer:
    """Classical DSP analysis: tempo, beats, key, sections."""

    def __init__(self, beats_per_bar: int = 4) -> None:
        self.beats_per_bar = beats_per_bar

    def analyze(self, audio: np.ndarray, sr: int) -> AnalysisResult:
        mono = librosa.to_mono(audio) if audio.ndim > 1 else audio

        bpm, beat_grid, bpm_conf = self._tempo_and_beats(mono, sr)
        downbeats = beat_grid[:: self.beats_per_bar]
        key, key_conf = self._estimate_key(mono, sr)
        sections = self._segment(mono, sr)

        tempo_map = [{"time": 0.0, "bpm": round(bpm, 2)}]

        return AnalysisResult(
            bpm=round(bpm, 2),
            bpm_confidence=round(bpm_conf, 3),
            music_key=key,
            key_confidence=round(key_conf, 3),
            time_signature=f"{self.beats_per_bar}/4",
            beat_grid=[round(float(t), 4) for t in beat_grid],
            downbeats=[round(float(t), 4) for t in downbeats],
            # Latency nudge applied to every beat when the browser renders the
            # click on the detected grid. Defaults to 0; the user fine-tunes it.
            click_offset_sec=0.0,
            tempo_map=tempo_map,
            sections=sections,
        )

    def _tempo_and_beats(self, y: np.ndarray, sr: int) -> tuple[float, np.ndarray, float]:
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, units="time")
        tempo = float(np.atleast_1d(tempo)[0])
        # Confidence: regularity of inter-beat intervals (lower variance → higher confidence).
        if len(beats) > 2:
            ibis = np.diff(beats)
            cv = float(np.std(ibis) / (np.mean(ibis) + 1e-9))
            confidence = float(np.clip(1.0 - cv, 0.0, 1.0))
        else:
            confidence = 0.0
        return tempo, beats, confidence

    def _estimate_key(self, y: np.ndarray, sr: int) -> tuple[str, float]:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = chroma.mean(axis=1)
        chroma_mean = chroma_mean / (chroma_mean.sum() + 1e-9)

        best_score = -np.inf
        best_key = "C major"
        scores: list[float] = []
        for i in range(12):
            maj = np.corrcoef(np.roll(_MAJOR_PROFILE, i), chroma_mean)[0, 1]
            minr = np.corrcoef(np.roll(_MINOR_PROFILE, i), chroma_mean)[0, 1]
            scores.extend([maj, minr])
            if maj > best_score:
                best_score, best_key = maj, f"{_PITCH_CLASSES[i]} major"
            if minr > best_score:
                best_score, best_key = minr, f"{_PITCH_CLASSES[i]} minor"

        scores_arr = np.nan_to_num(np.array(scores))
        # Confidence: how much the winner stands out above the mean candidate.
        margin = (best_score - scores_arr.mean()) / (scores_arr.std() + 1e-9)
        confidence = float(np.clip(margin / 3.0, 0.0, 1.0))
        return best_key, confidence

    def _segment(self, y: np.ndarray, sr: int, n_sections: int = 6) -> list[dict]:
        duration = librosa.get_duration(y=y, sr=sr)
        try:
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
            bounds = librosa.segment.agglomerative(chroma, min(n_sections, chroma.shape[1]))
            bound_times = librosa.frames_to_time(bounds, sr=sr)
            bound_times = sorted({0.0, *[float(t) for t in bound_times], duration})
        except Exception:
            bound_times = [0.0, duration]

        labels = ["Intro", "Verse 1", "Chorus", "Verse 2", "Bridge", "Chorus", "Outro"]
        sections: list[dict] = []
        for idx in range(len(bound_times) - 1):
            sections.append(
                {
                    "label": labels[idx] if idx < len(labels) else f"Section {idx + 1}",
                    "start": round(bound_times[idx], 3),
                    "end": round(bound_times[idx + 1], 3),
                    "confidence": 0.5,
                }
            )
        return sections
