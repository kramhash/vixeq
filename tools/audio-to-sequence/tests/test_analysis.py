from __future__ import annotations

import numpy as np
import pytest

from audio_to_sequence.analysis import (
    DEFAULT_BANDS,
    Band,
    band_step_values,
    estimate_tempo,
    make_grid,
    parse_bands,
)

from .conftest import BARS, BPM, LEAD_MS, SR, synth

PERIOD_MS = 60000.0 / BPM


def test_estimates_tempo_and_beat_phase(song: np.ndarray) -> None:
    estimate = estimate_tempo(song, SR)
    assert estimate.bpm == pytest.approx(BPM, abs=1.0)
    phase_error = (estimate.first_beat_ms - LEAD_MS + PERIOD_MS / 2) % PERIOD_MS - PERIOD_MS / 2
    assert abs(phase_error) < 25.0


def test_fixed_bpm_fits_only_the_phase(song: np.ndarray) -> None:
    estimate = estimate_tempo(song, SR, bpm=BPM)
    assert estimate.bpm == BPM
    phase_error = (estimate.first_beat_ms - LEAD_MS + PERIOD_MS / 2) % PERIOD_MS - PERIOD_MS / 2
    assert abs(phase_error) < 25.0


def test_silence_has_no_beats() -> None:
    with pytest.raises(ValueError, match="--bpm"):
        estimate_tempo(np.zeros(SR * 4, dtype=np.float32), SR)


def test_grid_moves_beat_zero_back_by_whole_bars() -> None:
    grid = make_grid(BPM, 300.0, 10_000.0, steps_per_beat=4, beats_per_bar=4)
    assert grid.start_position_ms == pytest.approx(300.0 - 2000.0)
    # -1700 ms .. 10000 ms needs 6 bars of 2000 ms.
    assert grid.step_count == 6 * 16


def test_grid_starts_at_zero_when_the_first_beat_is_at_zero() -> None:
    grid = make_grid(BPM, 0.0, 4000.0, steps_per_beat=4, beats_per_bar=4)
    assert grid.start_position_ms == 0.0
    assert grid.step_count == 2 * 16


def test_bands_separate_kick_and_hat() -> None:
    song = synth(click=False)
    grid = make_grid(BPM, LEAD_MS, len(song) / SR * 1000.0, steps_per_beat=4, beats_per_bar=4)
    values = band_step_values(
        song, SR, grid, [Band("low", 20, 150), Band("high", 2000, 11000)], floor_db=-48.0
    )
    low, high = np.array(values["low"]), np.array(values["high"])
    assert len(low) == grid.step_count

    first = round((LEAD_MS - grid.start_position_ms) / grid.step_ms)
    on_beat = np.arange(first, first + BARS * 16, 4)
    off_beat = on_beat + 2
    assert low[on_beat].min() > 0.9
    assert high[off_beat].min() > 0.9
    # The kick has decayed by the off-beat, and the hat is silent on the beat.
    assert low[off_beat].max() < low[on_beat].min() - 0.2
    assert high[on_beat].max() < high[off_beat].min() - 0.2
    # Steps before the audio starts are 0.
    assert values["low"][0] == 0.0


def test_values_are_bounded_and_rounded(song: np.ndarray) -> None:
    grid = make_grid(BPM, LEAD_MS, len(song) / SR * 1000.0, 4, 4)
    values = band_step_values(song, SR, grid, list(DEFAULT_BANDS), floor_db=-48.0)
    for steps in values.values():
        assert all(0.0 <= v <= 1.0 for v in steps)
        assert all(v == round(v, 4) for v in steps)
        assert max(steps) == 1.0


def test_silent_band_is_all_zero() -> None:
    y = np.zeros(SR * 2, dtype=np.float32)
    grid = make_grid(BPM, 0.0, 2000.0, 4, 4)
    values = band_step_values(y, SR, grid, [Band("any", 20, 150)], floor_db=-48.0)
    assert set(values["any"]) == {0.0}


@pytest.mark.parametrize(
    ("spec", "message"),
    [
        ("low", "name:low-high"),
        ("low:20", "name:low-high"),
        ("low:a-b", "non-numeric"),
        ("low:150-20", "low < high"),
        ("a:1-2,a:3-4", "unique"),
        (" , ", "At least one"),
    ],
)
def test_parse_bands_rejects_bad_specs(spec: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        parse_bands(spec)


def test_parse_bands_reads_names_and_ranges() -> None:
    assert parse_bands("kick:30-120, hat:6000-12000") == [Band("kick", 30, 120), Band("hat", 6000, 12000)]


def _compressed(seconds: float = 8.0) -> np.ndarray:
    """Loud noise whose level swings only +-3 dB every quarter beat, like mastered music."""
    rng = np.random.default_rng(1)
    y = rng.standard_normal(int(seconds * SR)).astype(np.float32) * 0.3
    step = int(SR * 0.125)
    for i, start in enumerate(range(0, len(y), step)):
        y[start : start + step] *= 10 ** ((3.0 if i % 2 else -3.0) / 20)
    return y


def test_auto_floor_spreads_mastered_dynamics_over_0_to_1() -> None:
    y = _compressed()
    grid = make_grid(BPM, 0.0, len(y) / SR * 1000.0, 4, 4)
    auto = np.array(band_step_values(y, SR, grid, [Band("all", 20, 11000)])["all"])
    fixed = np.array(band_step_values(y, SR, grid, [Band("all", 20, 11000)], floor_db=-48.0)["all"])
    assert fixed.min() > 0.8
    assert auto.max() == 1.0
    assert np.percentile(auto, 5) < 0.05


def test_rejects_non_negative_floor(song: np.ndarray) -> None:
    grid = make_grid(BPM, LEAD_MS, 4000.0, 4, 4)
    with pytest.raises(ValueError, match="negative"):
        band_step_values(song, SR, grid, list(DEFAULT_BANDS), floor_db=0.0)


def test_short_loops_are_flagged_unreliable() -> None:
    assert not estimate_tempo(synth(bars=2), SR).reliable
    assert estimate_tempo(synth(), SR).reliable
