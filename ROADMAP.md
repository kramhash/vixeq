# Vixeq Roadmap

## Vision

Vixeq is a **general-purpose timing engine for the web**. The entry point is musical (BPM, steps, tracks) but the use cases are not limited to music: data visualization, ambient backgrounds, game-like periodic effects, UI choreography — anything that benefits from a clock-driven stream of `0.0`–`1.0` control values.

The hosted `website-pulse` example shows this concretely: a live-event landing page where every CSS property — glow intensity, scale, color, EQ bar heights — is driven by a single `SequenceProject` editable in real time.

## Guiding Principles

- **Core stays dependency-free.** `@vixeq/core` will never take a runtime dependency.
- **Respect backward compatibility.** Even in early development, breaking changes are documented in `CHANGELOG.md` with a migration note.
- **Separation of concerns.** Pure logic (`core`) → hooks (`react`) → GUI (`player-react`). Each layer is independently usable.
- **Examples over documentation.** A working, runnable example is worth more than prose.

## Release Plan

### 0.3.0 — Engine Expressiveness

**Theme**: Give the engine more degrees of freedom without breaking any existing code.

#### Variable step resolution (`stepsPerBeat`)

Currently the step duration is hardcoded to one sixteenth note (`60000 / bpm / 4`). Adding `stepsPerBeat` (default `4`) to `SequenceProject` lets callers choose eighth notes, thirty-second notes, triplets, or arbitrary rates.

Files to touch:
- `packages/core/src/types.ts` — add `stepsPerBeat?: number` to `SequenceProject`
- `packages/core/src/limits.ts` — add `SEQUENCER_LIMITS.stepsPerBeat` range
- `packages/core/src/project.ts` — thread `stepsPerBeat` through `createProject` default
- `packages/core/src/validation.ts` — clamp in `normalizeProject`
- `packages/core/src/SequencerEngine.ts:202` — `60000 / bpm / stepsPerBeat`

All existing projects without `stepsPerBeat` normalize to `4`, preserving current behavior.

#### Step interpolation helpers (`nextValue` + easing functions)

Discrete step events are currently the only source of truth. Smooth continuous motion requires the caller to roll their own rAF decay loop. To support **deliberate** continuous interpolation, two small additions:

1. `StepEvent.tracks[n].nextValue` — the value at the *next* step index (wrapping). The caller can lerp `value → nextValue` over the step duration using the elapsed phase `(now - event.timestamp) / stepDurationMs`.

2. A new `easing.ts` module (or extension of `smoothing.ts`) exporting pure stateless easing functions:
   - `linear(t)`
   - `easeInQuad(t)` / `easeOutQuad(t)` / `easeInOutQuad(t)`
   - `easeInCubic(t)` / `easeOutCubic(t)` / `easeInOutCubic(t)`

The engine's tick machinery is **not changed**. Interpolation remains a caller-side concern; vixeq provides the ingredients.

Files to touch:
- `packages/core/src/types.ts` — add `nextValue` to `StepEventTrack`
- `packages/core/src/SequencerEngine.ts` — populate `nextValue` when emitting step events
- `packages/core/src/easing.ts` (new) — pure easing functions + tests

**Deliverables**: updated packages, tests for new code paths, one example updated to demonstrate continuous interpolated motion.

---

### 0.4.0 — Timeline Playback Integration

**Theme**: Activate the existing `timeline/` module by connecting it to `SequencerEngine`.

The `@vixeq/core` package already has a complete data layer for tempo-variable timelines (`TimingMap`, `TimelineProject`, `getEventsInBeatRange`), but `SequencerEngine` only plays `SequenceProject`. This gap means multi-tempo compositions and beat-accurate scheduling are currently impossible.

Work in this cycle:
- Extend `SequencerEngine` (or introduce a parallel `TimelineEngine`) to accept a `TimelineProject` and schedule tick times using `beatToMs` across tempo-change boundaries.
- Ensure `missedStepPolicy` semantics carry over.
- Add a timeline-aware example or playground mode.

This is an architectural change and therefore kept separate from 0.3.0.

---

### 0.5.0 — Reliability and Stabilization

**Theme**: Fill test gaps and polish the API surface before removing the "early development" label.

Known coverage gaps (as of v0.2.0):
- `packages/react/src/useSequencerEngine.ts` — no tests (lifecycle, project hot-swap, StrictMode)
- `packages/player-react/src/SequencePlayer.tsx` — no tests (pointer-drag editing, imperative ref, nine edit reason types)
- `packages/core/src/validation.ts` — no dedicated tests for `validateProject` / `normalizeProject`

Work in this cycle:
- Vitest + React Testing Library tests for the above.
- Any API surface adjustments identified during testing.
- Evaluate if `"early development"` can be retired from the README.

---

### Ongoing — Documentation and Adoption

These tasks run in parallel with the release cycles above:

- **Update `README.md`**: add `website-pulse` and `website-svg` to the examples section; update the "Current Scope" list to reflect 0.3.0 additions.
- **Non-musical example**: add one example demonstrating a use case with no musical framing (e.g., data visualization dashboard, ambient background shader, or UI state machine).
- **Preset expansion**: add more named presets to `presets.ts` (e.g., triplet, waltz, slow pulse, burst).

## Explicitly Out of Scope

These items are not planned and are unlikely to be added:

- Audio engine or audio scheduling (Web Audio API, Tone.js integration)
- MIDI input/output
- DAW-style timeline editing UI
- URL sharing / project serialization beyond JSON export
- Production stability guarantees before 1.0
