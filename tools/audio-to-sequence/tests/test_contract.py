"""CLI output must pass @vixeq/core's own validators.

Needs Node and a built packages/core (`pnpm --filter @vixeq/core build`). Set
VIXEQ_CONTRACT=1 to require it (CI does); otherwise it is skipped.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from audio_to_sequence.cli import main

VALIDATOR = Path(__file__).resolve().parents[1] / "contract" / "validate.mjs"

pytestmark = pytest.mark.skipif(
    os.environ.get("VIXEQ_CONTRACT") != "1", reason="set VIXEQ_CONTRACT=1 with a built packages/core"
)


def test_output_passes_core_validation(song_path: Path, tmp_path: Path) -> None:
    arrangement = tmp_path / "arrangement.json"
    custom = tmp_path / "custom.json"
    sequence = tmp_path / "sequence.json"
    assert main([str(song_path), "-o", str(arrangement)]) == 0
    assert main([str(song_path), "-o", str(custom), "--bands", "kick:30-120,snare:150-400,hat:6000-12000",
                 "--steps-per-beat", "2", "--bars-per-pattern", "3"]) == 0
    assert main([str(song_path), "-o", str(sequence), "--format", "sequence", "--bpm", "120",
                 "--offset-ms", "0", "--steps-per-beat", "2"]) == 0

    result = subprocess.run(
        ["node", str(VALIDATOR), str(arrangement), str(custom), str(sequence)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
