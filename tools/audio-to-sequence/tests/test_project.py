from __future__ import annotations

import pytest

from audio_to_sequence.analysis import make_grid
from audio_to_sequence.project import ProjectLimitError, build_arrangement, build_sequence


def _values(step_count: int, tracks: int = 2) -> dict[str, list[float]]:
    return {f"t{n}": [round(i / step_count, 4) for i in range(step_count)] for n in range(tracks)}


def test_arrangement_splits_into_contiguous_patterns() -> None:
    # -1700 ms .. 20 s at 120 BPM: 11 bars, so patterns of 8 + 3 bars.
    grid = make_grid(120.0, 300.0, 20_000.0, 4, 4)
    values = _values(grid.step_count)
    project = build_arrangement(grid, values, bars_per_pattern=8)

    assert project["version"] == 2
    assert project["timing"] == {"tempos": [{"beat": 0, "bpm": 120.0}], "startPositionMs": -1700.0}
    assert project["durationBeats"] == 44
    assert [p["stepCount"] for p in project["patterns"].values()] == [128, 48]
    assert project["sections"] == [
        {"id": "s-000", "patternId": "p-000", "startBeat": 0, "endBeat": 32},
        {"id": "s-001", "patternId": "p-001", "startBeat": 32, "endBeat": 44},
    ]
    second = project["patterns"]["p-001"]
    assert [t["id"] for t in second["tracks"]] == ["t0", "t1"]
    assert second["tracks"][0]["steps"] == values["t0"][128:]


def test_arrangement_rejects_patterns_over_128_steps() -> None:
    grid = make_grid(120.0, 0.0, 4000.0, 8, 4)
    with pytest.raises(ProjectLimitError, match="--bars-per-pattern"):
        build_arrangement(grid, _values(grid.step_count), bars_per_pattern=8)


def test_sequence_holds_a_short_loop() -> None:
    grid = make_grid(120.0, 0.0, 8000.0, 4, 4)
    project = build_sequence(grid, _values(grid.step_count))
    assert project["version"] == 1
    assert project["stepCount"] == 64


def test_sequence_rejects_more_than_128_steps() -> None:
    grid = make_grid(120.0, 0.0, 20_000.0, 4, 4)
    with pytest.raises(ProjectLimitError, match="--format arrangement"):
        build_sequence(grid, _values(grid.step_count))


@pytest.mark.parametrize(
    ("bpm", "tracks", "message"),
    [(10.0, 1, "BPM"), (400.0, 1, "BPM"), (120.0, 17, "Track count")],
)
def test_limits(bpm: float, tracks: int, message: str) -> None:
    grid = make_grid(bpm, 0.0, 4000.0, 4, 4)
    with pytest.raises(ProjectLimitError, match=message):
        build_sequence(grid, _values(grid.step_count, tracks))
