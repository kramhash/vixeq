"""Build vixeq JSON (ArrangementProject v2 / SequenceProject v1) from step values.

Shapes and limits follow packages/core/src/arrangement/types.ts,
packages/core/src/types.ts and packages/core/src/limits.ts.
"""

from __future__ import annotations

from typing import Any

from .analysis import Grid

MIN_BPM = 20
MAX_BPM = 300
MAX_TRACKS = 16
MAX_STEP_COUNT = 128
MIN_STEPS_PER_BEAT = 1
MAX_STEPS_PER_BEAT = 32


class ProjectLimitError(ValueError):
    pass


def _check_common(grid: Grid, values: dict[str, list[float]]) -> None:
    if not MIN_BPM <= grid.bpm <= MAX_BPM:
        raise ProjectLimitError(f"BPM {grid.bpm:.2f} is outside {MIN_BPM}-{MAX_BPM}; pass --bpm.")
    if not MIN_STEPS_PER_BEAT <= grid.steps_per_beat <= MAX_STEPS_PER_BEAT:
        raise ProjectLimitError(
            f"steps per beat must be {MIN_STEPS_PER_BEAT}-{MAX_STEPS_PER_BEAT}, got {grid.steps_per_beat}."
        )
    if not 1 <= len(values) <= MAX_TRACKS:
        raise ProjectLimitError(f"Track count must be 1-{MAX_TRACKS}, got {len(values)}.")


def _pattern(grid: Grid, values: dict[str, list[float]], start: int, end: int) -> dict[str, Any]:
    return {
        "version": 1,
        "bpm": grid.bpm,
        "stepCount": end - start,
        "stepsPerBeat": grid.steps_per_beat,
        "tracks": [
            {"id": track_id, "name": track_id, "enabled": True, "steps": steps[start:end]}
            for track_id, steps in values.items()
        ],
    }


def build_arrangement(grid: Grid, values: dict[str, list[float]], bars_per_pattern: int) -> dict[str, Any]:
    """Split the song into consecutive patterns of `bars_per_pattern` bars, each
    played once by its own section on a shared constant-tempo timing map."""
    _check_common(grid, values)
    steps_per_pattern = grid.steps_per_bar * bars_per_pattern
    if bars_per_pattern < 1 or steps_per_pattern > MAX_STEP_COUNT:
        raise ProjectLimitError(
            f"{bars_per_pattern} bars of {grid.steps_per_bar} steps exceed {MAX_STEP_COUNT} steps per pattern;"
            " lower --bars-per-pattern."
        )

    patterns: dict[str, Any] = {}
    sections: list[dict[str, Any]] = []
    for index, start in enumerate(range(0, grid.step_count, steps_per_pattern)):
        end = min(start + steps_per_pattern, grid.step_count)
        pattern_id = f"p-{index:03d}"
        patterns[pattern_id] = _pattern(grid, values, start, end)
        sections.append(
            {
                "id": f"s-{index:03d}",
                "patternId": pattern_id,
                "startBeat": start / grid.steps_per_beat,
                "endBeat": end / grid.steps_per_beat,
            }
        )

    return {
        "version": 2,
        "timing": {
            "tempos": [{"beat": 0, "bpm": grid.bpm}],
            "startPositionMs": round(grid.start_position_ms, 3),
        },
        "durationBeats": grid.step_count / grid.steps_per_beat,
        "patterns": patterns,
        "sections": sections,
    }


def build_sequence(grid: Grid, values: dict[str, list[float]]) -> dict[str, Any]:
    """A single pattern; only for material that fits in 128 steps."""
    _check_common(grid, values)
    if grid.step_count > MAX_STEP_COUNT:
        raise ProjectLimitError(
            f"{grid.step_count} steps exceed the {MAX_STEP_COUNT}-step SequenceProject limit;"
            " use --format arrangement."
        )
    return _pattern(grid, values, 0, grid.step_count)
