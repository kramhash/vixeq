"""Command-line entry point: audio file in, vixeq JSON out."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from .analysis import DEFAULT_BANDS, band_step_values, estimate_tempo, load_audio, make_grid, parse_bands
from .project import MAX_TRACKS, build_arrangement, build_sequence


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="audio-to-sequence",
        description="Convert an audio file into vixeq per-band loudness step values.",
    )
    parser.add_argument("input", type=Path, help="audio file (anything librosa can decode)")
    parser.add_argument("-o", "--output", type=Path, help="write JSON here instead of stdout")
    parser.add_argument("--format", choices=("arrangement", "sequence"), default="arrangement")
    parser.add_argument("--bpm", type=float, help="tempo; detected when omitted")
    parser.add_argument("--offset-ms", type=float, help="audio position of a downbeat; detected when omitted")
    parser.add_argument("--steps-per-beat", type=int, default=4)
    parser.add_argument("--beats-per-bar", type=int, default=4)
    parser.add_argument("--bars-per-pattern", type=int, default=8)
    parser.add_argument(
        "--bands",
        default=",".join(f"{b.id}:{b.low_hz:g}-{b.high_hz:g}" for b in DEFAULT_BANDS),
        help='"name:lowHz-highHz,..."; each name becomes a track id (default: %(default)s)',
    )
    parser.add_argument(
        "--floor-db",
        type=float,
        help="dB below a track's peak that maps to 0.0 (default: each track's 5th percentile)",
    )
    parser.add_argument("--preview", type=Path, help="also write a diagnostic PNG")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        bands = parse_bands(args.bands)
        if len(bands) > MAX_TRACKS:
            raise ValueError(f"At most {MAX_TRACKS} bands are allowed, got {len(bands)}.")
        if args.steps_per_beat < 1 or args.beats_per_bar < 1:
            raise ValueError("--steps-per-beat and --beats-per-bar must be at least 1.")

        y, sr = load_audio(args.input)
        warnings: list[str] = []
        if args.bpm is not None and args.offset_ms is not None:
            bpm, first_beat_ms = args.bpm, args.offset_ms
        else:
            estimate = estimate_tempo(y, sr, bpm=args.bpm)
            bpm = estimate.bpm
            first_beat_ms = args.offset_ms if args.offset_ms is not None else estimate.first_beat_ms
            if not estimate.reliable:
                warnings.append(
                    f"only {estimate.beat_count} beats detected; the estimate is unreliable, pass --bpm and --offset-ms."
                )
        bpm = round(bpm, 3)

        grid = make_grid(bpm, first_beat_ms, len(y) / sr * 1000.0, args.steps_per_beat, args.beats_per_bar)
        values = band_step_values(y, sr, grid, bands, args.floor_db)
        if args.format == "sequence":
            project = build_sequence(grid, values)
        else:
            project = build_arrangement(grid, values, args.bars_per_pattern)
    except (ValueError, OSError) as error:
        print(f"audio-to-sequence: {error}", file=sys.stderr)
        return 1

    text = json.dumps(project, indent=2) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)

    if args.preview:
        from .preview import render_preview

        render_preview(args.preview, y, sr, grid, values)

    print(
        f"bpm {grid.bpm:.3f}  first beat {first_beat_ms:.1f} ms  startPositionMs {grid.start_position_ms:.1f}"
        f"  steps {grid.step_count}",
        file=sys.stderr,
    )
    for track_id, steps in values.items():
        print(f"  {track_id}: mean {sum(steps) / len(steps):.3f}", file=sys.stderr)
    if args.format == "sequence" and grid.start_position_ms != 0:
        warnings.append(f"SequenceProject has no start offset; beat 0 is at {grid.start_position_ms:.1f} ms of the audio.")
    for warning in warnings:
        print(f"  warning: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
