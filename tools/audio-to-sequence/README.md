# audio-to-sequence

A private (unpublished) CLI that turns an audio file into vixeq step values:
one track per frequency band, each step holding that band's loudness. The
output is an `ArrangementProject` v2 that plays in sync with the same audio
through `ArrangementEngine` and a media transport.

It analyzes audio offline and ships nothing in `@vixeq/*`, so it does not touch
the "Audio engine" item in `ROADMAP.md`'s out-of-scope list.

## Setup

Needs [uv](https://docs.astral.sh/uv/). WAV/FLAC/OGG decode through soundfile;
MP3/M4A fall back to ffmpeg if it is on `PATH`.

```sh
cd tools/audio-to-sequence
uv sync
```

## Usage

```sh
uv run audio-to-sequence song.mp3 -o song.json --preview song.png
```

stderr reports the tempo, the first beat, `startPositionMs`, and the step count.
Check `--preview` before using the result: it draws the waveform with the beat
grid (red lines are bars) above one lane of step values per track.

| Option | Default | Meaning |
|---|---|---|
| `--format arrangement\|sequence` | `arrangement` | `sequence` writes one `SequenceProject` and fails beyond 128 steps |
| `--bpm` | detected | Constant tempo |
| `--offset-ms` | detected | Audio position of a downbeat |
| `--steps-per-beat` | `4` | Grid resolution (1–32) |
| `--beats-per-bar` | `4` | Bar length; patterns split on bars |
| `--bars-per-pattern` | `8` | Bars per pattern (at most 128 steps) |
| `--bands` | `low:20-150,mid:150-2000,high:2000-16000` | `name:lowHz-highHz,...`; names become track ids (max 16) |
| `--floor-db` | auto | dB below a track's peak that maps to 0.0 |

### How the values and grid are made

- **Value:** the band's mean power over the step, in dB. The loudest step of each
  track is 1.0. Without `--floor-db`, each track's 5th-percentile step is 0.0.
  This spreads mastered music (a few dB of step-to-step range) and raw stems
  (tens of dB) over 0–1. There is no temporal smoothing, so use vixeq's
  easing or envelopes on playback.
- **Grid:** librosa's beat tracker, refined by a line fit over all beats, gives
  the tempo and first beat. Beat 0 then moves back whole bars so audio 0 ms is
  covered (`timing.startPositionMs <= 0`), and the end rounds up to a bar.
  Steps outside the audio are 0.

### Known limits

- **Constant tempo only.** Songs that drift need `--bpm` / `--offset-ms`, or
  they lose sync over time.
- **Short loops (fewer than 16 detected beats) give unreliable estimates.** The
  CLI warns; pass `--bpm` and `--offset-ms`.
- **The tracker can lock onto off-beats** when they are sharper than the beats
  (e.g. loud hats with a soft kick). The preview shows bar lines between the
  kicks; fix it with `--offset-ms`.
- **Bars are aligned to the first detected beat, not a detected downbeat.**
- **`--format sequence` cannot carry `startPositionMs`.** Align beat 0 on the
  transport side; the CLI prints the offset.

## Tests

```sh
uv run pytest
# Also check the output against @vixeq/core's validators:
pnpm --filter @vixeq/core build   # from the repository root
VIXEQ_CONTRACT=1 uv run pytest
```
