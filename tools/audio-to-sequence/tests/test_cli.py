from __future__ import annotations

import json
from pathlib import Path

import pytest
import soundfile as sf

from audio_to_sequence.cli import main

from .conftest import SR, synth


def test_writes_an_arrangement_deterministically(song_path: Path, tmp_path: Path) -> None:
    first, second = tmp_path / "a.json", tmp_path / "b.json"
    assert main([str(song_path), "-o", str(first)]) == 0
    assert main([str(song_path), "-o", str(second)]) == 0
    assert first.read_bytes() == second.read_bytes()

    project = json.loads(first.read_text())
    assert project["version"] == 2
    assert project["timing"]["startPositionMs"] <= 0
    assert [t["id"] for t in project["patterns"]["p-000"]["tracks"]] == ["low", "mid", "high"]


def test_overrides_skip_detection(song_path: Path, tmp_path: Path) -> None:
    out = tmp_path / "o.json"
    assert main([str(song_path), "-o", str(out), "--bpm", "100", "--offset-ms", "0"]) == 0
    project = json.loads(out.read_text())
    assert project["timing"] == {"tempos": [{"beat": 0, "bpm": 100.0}], "startPositionMs": 0.0}


def test_sequence_format_and_preview(song_path: Path, tmp_path: Path) -> None:
    out, png = tmp_path / "s.json", tmp_path / "p.png"
    args = [str(song_path), "-o", str(out), "--format", "sequence", "--bpm", "120", "--offset-ms", "0"]
    args += ["--steps-per-beat", "2", "--bands", "kick:20-150", "--preview", str(png)]
    assert main(args) == 0
    project = json.loads(out.read_text())
    assert project["version"] == 1
    assert [t["id"] for t in project["tracks"]] == ["kick"]
    assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_reports_errors_without_a_traceback(song_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main([str(song_path), "--format", "sequence", "--bpm", "120", "--offset-ms", "0"]) == 1
    assert "--format arrangement" in capsys.readouterr().err


def test_missing_file_is_an_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main([str(tmp_path / "missing.wav")]) == 1
    assert "audio-to-sequence:" in capsys.readouterr().err


def test_warns_when_tempo_detection_is_unreliable(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "short.wav"
    sf.write(path, synth(bars=2), SR)
    assert main([str(path), "-o", str(tmp_path / "o.json")]) == 0
    assert "unreliable" in capsys.readouterr().err
