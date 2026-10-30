"""Pure analysis: audio samples in, beat grid and per-band step values out."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np

N_FFT = 2048
HOP_LENGTH = 256
AUTO_FLOOR_PERCENTILE = 5
# Fewer detected beats than this make the tempo fit unreliable (short loops).
MIN_RELIABLE_BEATS = 16


@dataclass(frozen=True)
class Band:
    id: str
    low_hz: float
    high_hz: float


DEFAULT_BANDS: tuple[Band, ...] = (
    Band("low", 20.0, 150.0),
    Band("mid", 150.0, 2000.0),
    Band("high", 2000.0, 16000.0),
)


@dataclass(frozen=True)
class Grid:
    """A constant-tempo step grid. Beat 0 sits at `start_position_ms` of the audio."""

    bpm: float
    steps_per_beat: int
    beats_per_bar: int
    start_position_ms: float
    step_count: int

    @property
    def step_ms(self) -> float:
        return 60000.0 / self.bpm / self.steps_per_beat

    @property
    def bar_ms(self) -> float:
        return 60000.0 / self.bpm * self.beats_per_bar

    @property
    def steps_per_bar(self) -> int:
        return self.steps_per_beat * self.beats_per_bar


@dataclass(frozen=True)
class TempoEstimate:
    bpm: float
    first_beat_ms: float
    beat_count: int

    @property
    def reliable(self) -> bool:
        return self.beat_count >= MIN_RELIABLE_BEATS


def parse_bands(spec: str) -> list[Band]:
    """Parse `"name:lo-hi,name:lo-hi"` into bands."""
    bands: list[Band] = []
    for raw in spec.split(","):
        item = raw.strip()
        if not item:
            continue
        name, sep, hz_range = item.partition(":")
        low, dash, high = hz_range.partition("-")
        if not sep or not dash or not name.strip():
            raise ValueError(f'Band "{item}" must look like "name:low-high".')
        try:
            low_hz, high_hz = float(low), float(high)
        except ValueError as error:
            raise ValueError(f'Band "{item}" has a non-numeric frequency.') from error
        if not (0 <= low_hz < high_hz):
            raise ValueError(f'Band "{item}" needs 0 <= low < high.')
        bands.append(Band(name.strip(), low_hz, high_hz))
    if not bands:
        raise ValueError("At least one band is required.")
    ids = [band.id for band in bands]
    if len(set(ids)) != len(ids):
        raise ValueError("Band names must be unique.")
    return bands


def load_audio(path: Path) -> tuple[np.ndarray, int]:
    """Decode to mono float samples at the file's native rate."""
    if not path.is_file():
        raise FileNotFoundError(f"No such file: {path}")
    try:
        y, sr = librosa.load(path, sr=None, mono=True)
    except Exception as error:  # soundfile and audioread raise unrelated types
        raise ValueError(f"Could not decode {path}: {error}") from error
    if len(y) == 0:
        raise ValueError(f"{path} has no samples.")
    return y, int(sr)


def estimate_tempo(y: np.ndarray, sr: int, bpm: float | None = None) -> TempoEstimate:
    """Estimate a constant tempo and the first beat's position.

    The tracker's beats are fitted with a line (beat time vs beat index), which
    is far more precise than its quantized tempo. A caller-supplied `bpm` fixes
    the period, and only the phase is fitted.
    """
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP_LENGTH)
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP_LENGTH)
    if len(beats) < 2:
        raise ValueError("Could not detect beats; pass --bpm and --offset-ms.")

    if bpm is None:
        period = 60.0 / float(np.atleast_1d(tempo)[0])
        indices = np.round((beats - beats[0]) / period)
        slope, intercept = np.polyfit(indices, beats, 1)
        return TempoEstimate(60.0 / float(slope), float(intercept) * 1000.0, len(beats))

    period = 60.0 / bpm
    residuals = (beats - beats[0] + period / 2) % period - period / 2
    return TempoEstimate(bpm, (float(beats[0]) + float(np.mean(residuals))) * 1000.0, len(beats))


def make_grid(
    bpm: float,
    first_beat_ms: float,
    duration_ms: float,
    steps_per_beat: int,
    beats_per_bar: int,
) -> Grid:
    """Place beat 0 whole bars before the first beat so audio 0 ms is covered,
    and round the end up to a bar."""
    bar_ms = 60000.0 / bpm * beats_per_bar
    start = first_beat_ms - math.ceil(first_beat_ms / bar_ms) * bar_ms
    bars = max(1, math.ceil((duration_ms - start) / bar_ms))
    return Grid(
        bpm=bpm,
        steps_per_beat=steps_per_beat,
        beats_per_bar=beats_per_bar,
        start_position_ms=start,
        step_count=bars * steps_per_beat * beats_per_bar,
    )


def band_step_values(
    y: np.ndarray,
    sr: int,
    grid: Grid,
    bands: list[Band],
    floor_db: float | None = None,
) -> dict[str, list[float]]:
    """Per band: mean power over each step, in dB, mapped so the band's loudest
    step is 1.0 and `floor_db` below it is 0.0. Steps outside the audio are 0.

    Without `floor_db`, each band's floor is the 5th percentile of its sounding
    steps, so mastered music (a few dB of step-to-step range) and raw stems
    (tens of dB) both use the full 0-1 range."""
    if floor_db is not None and floor_db >= 0:
        raise ValueError("floor_db must be negative.")

    power = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP_LENGTH)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    frame_ms = librosa.frames_to_time(np.arange(power.shape[1]), sr=sr, hop_length=HOP_LENGTH) * 1000.0

    starts = grid.start_position_ms + np.arange(grid.step_count) * grid.step_ms
    lo = np.searchsorted(frame_ms, starts, side="left")
    hi = np.searchsorted(frame_ms, starts + grid.step_ms, side="left")
    audio_ms = len(y) / sr * 1000.0
    inside = (starts + grid.step_ms > 0) & (starts < audio_ms)
    # A step shorter than a hop still takes its nearest frame.
    hi = np.where(inside & (hi <= lo), np.minimum(lo + 1, len(frame_ms)), hi)

    values: dict[str, list[float]] = {}
    for band in bands:
        mask = (freqs >= band.low_hz) & (freqs < band.high_hz)
        energy = power[mask].sum(axis=0) if mask.any() else np.zeros(power.shape[1])
        step_power = np.array(
            [energy[a:b].mean() if ok and b > a else 0.0 for a, b, ok in zip(lo, hi, inside)]
        )
        values[band.id] = _normalize_db(step_power, floor_db)
    return values


def _normalize_db(step_power: np.ndarray, floor_db: float | None) -> list[float]:
    peak = step_power.max(initial=0.0)
    if peak <= 0:
        return [0.0] * len(step_power)
    with np.errstate(divide="ignore"):
        relative_db = 10.0 * np.log10(step_power / peak)
    if floor_db is None:
        floor_db = float(np.percentile(relative_db[step_power > 0], AUTO_FLOOR_PERCENTILE))
    if floor_db >= 0:
        # No dynamics to map: every sounding step is at the peak.
        mapped = (step_power > 0).astype(float)
    else:
        mapped = np.clip(1.0 - relative_db / floor_db, 0.0, 1.0)
    return [round(float(v), 4) for v in mapped]
