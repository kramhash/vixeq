# Changelog

## 0.3.0 - 2026-06-20

### Changed

- **Breaking**: Package names renamed from `@viseq/*` to `@vixeq/*`. Update all imports:
  - `@viseq/core` → `@vixeq/core`
  - `@viseq/react` → `@vixeq/react`
  - `@viseq/player-react` → `@vixeq/player-react`
- CSS class prefix renamed: `.viseq-player__*` → `.vixeq-player__*`.

### Added

- `stepsPerBeat` field on `SequenceProject` (default `4`). Enables arbitrary step rates — eighth notes, 32nd notes, triplets, etc. Existing projects without this field normalize to `4` and behave identically.
- `StepEvent.durationMs`: step length in milliseconds, derived from `60000 / bpm / stepsPerBeat`. Callers no longer need to compute this manually.
- `StepEventTrack.nextValue`: the value at the next step index (wrapping). Together with `durationMs` and `event.timestamp`, this enables deliberate `value → nextValue` interpolation within a step.
- New `easing` module exported from `@vixeq/core`: `linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeInCubic`, `easeOutCubic`, `easeInOutCubic`, `lerp`. All functions clamp `t` to `[0, 1]`.
- `examples/website-svg`: SVG brandmark driven by a sequencer. Demonstrates continuous interpolation (`value → nextValue` + easing) on the arm channel alongside impulse-decay envelopes on the rings.
- `examples/website-pulse`: live-event landing page where CSS properties are driven by a single `SequenceProject` editable in real time.
- Brand assets in `brand/`: primary logo SVG, light-mode variant, standalone grid mark, and favicon.

### Notes

- `examples/website-svg` and `examples/website-pulse` are not yet hosted on GitHub Pages. The playground remains the only hosted example.

## 0.2.0 - 2026-06-19

### Added

- Added core track transform helpers: `clearTrack`, `rotateTrackSteps`, and `randomizeTrack`.
- Added `examples/vanilla-core` for framework-free `@vixeq/core` usage.
- Added `examples/react-player` for controlled `SequencePlayer` usage with external controls.
- Expanded package README usage guidance for adoption-focused examples.

## 0.1.0 - 2026-06-19

Initial release.

### Added

- `@vixeq/core` with the UI-agnostic sequencer engine, immutable project helpers, validation, presets, smoothing helpers, and timeline utilities.
- `@vixeq/react` with React hooks for driving the core engine from React apps.
- `@vixeq/player-react` with an embeddable editable sequence player and bundled styles.
- Playground app with visualizer, presets, JSON import/export, and local project persistence.

### Notes

- Vixeq is in early development.
- This release does not include an audio engine, MIDI support, DAW-style timeline editing UI, URL sharing, or production stability guarantees.
