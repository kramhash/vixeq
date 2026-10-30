"""Diagnostic PNG: waveform with the beat grid, then one step-value lane per track."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from .analysis import Grid  # noqa: E402


def render_preview(path: Path, y: np.ndarray, sr: int, grid: Grid, values: dict[str, list[float]]) -> None:
    lanes = len(values) + 1
    fig, axes = plt.subplots(lanes, 1, sharex=True, figsize=(16, 1.6 * lanes), constrained_layout=True)

    seconds = np.arange(len(y)) / sr
    wave = axes[0]
    wave.plot(seconds, y, linewidth=0.3, color="0.3")
    beat_s = (grid.start_position_ms + np.arange(grid.step_count // grid.steps_per_beat + 1) * 60000.0 / grid.bpm) / 1000.0
    for index, t in enumerate(beat_s):
        is_bar = index % grid.beats_per_bar == 0
        wave.axvline(t, color="tab:red" if is_bar else "tab:blue", linewidth=0.8 if is_bar else 0.3, alpha=0.6)
    wave.set_ylabel("audio")
    wave.set_title(f"{grid.bpm:.3f} BPM, beat 0 at {grid.start_position_ms:.1f} ms, {grid.step_count} steps")

    step_s = (grid.start_position_ms + np.arange(grid.step_count) * grid.step_ms) / 1000.0
    for ax, (track_id, steps) in zip(axes[1:], values.items()):
        ax.bar(step_s, steps, width=grid.step_ms / 1000.0, align="edge", color="tab:green")
        ax.set_ylim(0, 1)
        ax.set_ylabel(track_id)

    axes[-1].set_xlabel("seconds")
    axes[-1].set_xlim(min(0.0, step_s[0]), max(seconds[-1] if len(seconds) else 0.0, step_s[-1] + grid.step_ms / 1000.0))
    fig.savefig(path, dpi=110)
    plt.close(fig)
