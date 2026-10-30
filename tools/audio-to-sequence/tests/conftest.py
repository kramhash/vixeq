from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

SR = 22050
BPM = 120.0
LEAD_MS = 300.0
BARS = 8


def synth(click: bool = True, sr: int = SR, bpm: float = BPM, lead_ms: float = LEAD_MS, bars: int = BARS) -> np.ndarray:
    """A kick (pitch sweep 150 -> 50 Hz) on every beat and a hat (6 kHz) on every
    off-beat, after `lead_ms` of silence.

    The kick's broadband click is what lets the beat tracker find the on-beat
    phase; without it, librosa locks onto the hats. Band tests turn it off so the
    high band only sees the hat.
    """
    beat_s = 60.0 / bpm
    y = np.zeros(int((lead_ms / 1000.0 + bars * 4 * beat_s) * sr), dtype=np.float32)

    t = np.arange(int(0.15 * sr)) / sr
    kick = 0.8 * np.sin(2 * np.pi * np.cumsum(50 + 100 * np.exp(-t / 0.02)) / sr) * np.exp(-t / 0.05)
    if click:
        n = int(0.003 * sr)
        kick[:n] += 0.5 * np.random.default_rng(0).standard_normal(n)
    th = np.arange(int(0.04 * sr)) / sr
    hat = 0.3 * np.sin(2 * np.pi * 6000 * th) * np.exp(-th / 0.01)

    def put(at_s: float, signal: np.ndarray) -> None:
        start = int(at_s * sr)
        end = min(start + len(signal), len(y))
        y[start:end] += signal[: end - start]

    for beat in range(bars * 4):
        at = lead_ms / 1000.0 + beat * beat_s
        put(at, kick)
        put(at + beat_s / 2, hat)
    return y


@pytest.fixture(scope="session")
def song() -> np.ndarray:
    return synth()


@pytest.fixture(scope="session")
def song_path(tmp_path_factory: pytest.TempPathFactory, song: np.ndarray) -> Path:
    path = tmp_path_factory.mktemp("audio") / "synth.wav"
    sf.write(path, song, SR)
    return path
