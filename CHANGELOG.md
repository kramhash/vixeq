# Changelog

## Unreleased

## 0.8.0 - 2026-07-11

Stable release of Timing/Timeline/Arrangement v2, promoting the 0.8 beta
line.

### Published

- Promoted `@vixeq/core`, `@vixeq/react`, and `@vixeq/player-react` to
  `0.8.0` under the `latest` dist-tag.
  - [`@vixeq/core@0.8.0`](https://www.npmjs.com/package/@vixeq/core/v/0.8.0)
  - [`@vixeq/react@0.8.0`](https://www.npmjs.com/package/@vixeq/react/v/0.8.0)
  - [`@vixeq/player-react@0.8.0`](https://www.npmjs.com/package/@vixeq/player-react/v/0.8.0)
- Keeps the `beta` dist-tag on `0.8.0-beta.1`.
- Verified against a clean consumer installing directly from the npm
  registry (not local tarballs): ESM/CJS imports, the v1-to-v2 migration
  API (`migrateTimelineProject()`/`migrateArrangementProject()`), public
  types, React SSR, and `@vixeq/player-react/styles.css` resolution all
  pass.

### Added

- `TimingMap`, `TimelineProject` v2, indexed `TimelineEngine`, `useTimeline()`,
  `ArrangementProject` v2 with tempo-map playback, and explicit
  `migrateTimelineProject()` / `migrateArrangementProject()` APIs.
- `website-pulse` Timeline integration and reusable migration fixtures.

### Breaking

- Same breaking changes as `0.8.0-beta.1`: no deprecated aliases are provided.
  See the [0.8 migration guide](./docs/migrations/0.8-timeline-arrangement-v2.md)
  before upgrading.

## 0.8.0-beta.1 - 2026-07-10

Timing/Timeline/Arrangement v2: a shared, tempo-mapped `TimingMap` for
Timeline and Arrangement, an indexed `TimelineEngine` with cue scheduling,
`ArrangementProject` v2 playback against a tempo map, and `useTimeline()`.
There are no deprecated aliases in 0.8 — see the
[migration guide](./docs/migrations/0.8-timeline-arrangement-v2.md) before
upgrading.

### Published

- Published to npm under the `beta` dist-tag; the `latest` tag is untouched
  (still `0.5.0`). Install explicitly with `@beta`, e.g.
  `npm install @vixeq/core@beta`.
  - [`@vixeq/core@0.8.0-beta.1`](https://www.npmjs.com/package/@vixeq/core/v/0.8.0-beta.1)
  - [`@vixeq/react@0.8.0-beta.1`](https://www.npmjs.com/package/@vixeq/react/v/0.8.0-beta.1)
  - [`@vixeq/player-react@0.8.0-beta.1`](https://www.npmjs.com/package/@vixeq/player-react/v/0.8.0-beta.1)
- Verified against the packed tarballs (`pnpm smoke:pack`), including the
  v1-to-v2 migration fixture
  ([`fixtures/migration/v1-to-v2.json`](./fixtures/migration/v1-to-v2.json)),
  and against a clean consumer installing directly from the npm registry:
  ESM/CJS imports, public types, React SSR, and
  `@vixeq/player-react/styles.css` resolution all pass.
- Known caveat: this is a prerelease with no deprecated aliases for the 0.7
  API — see the migration guide above before adopting the beta.

### Added

- `TimingMap`, shared by Timeline and Arrangement: a tempo-map (`tempos`) plus
  `startPositionMs` pre-roll, with `createTimingMap()`, `normalizeTimingMap()`,
  `validateTimingMap()`, and pure `beatToMs()`/`msToBeat()` conversions.
- `TimelineProject` v2: explicit, required `durationBeats`; sparse point
  events addressed by an indexed `TimelineEngine` (`eventIndex`) for O(log n)
  range queries via `getEventsAtBeat()`/`getEventsInBeatRange()`/
  `getNextEvents()`. `TimelineEngine` schedules and emits due cues against a
  `PlaybackTransport`, with a configurable `missedCuePolicy` (`"emit"` |
  `"skip"`) for catch-up behavior after a delayed callback.
- `ArrangementProject` v2: `bpm` is replaced by a `timing: TimingMap`, and
  `durationBeats` is now an explicit required field instead of being implicit.
  `ArrangementEngine` plays sections against the tempo map, so variable-tempo
  arrangements (tempo changes mid-arrangement) are supported end-to-end.
- `migrateTimelineProject()` and `migrateArrangementProject()` in
  `@vixeq/core`, converting v1 project data to the v2 schema. Both follow a
  strict "reject invalid, don't repair" policy: they return `{ ok: false,
  errors }` for malformed v1 input rather than silently clamping or
  normalizing it. `migrateArrangementProject()` requires an explicit
  `durationBeats` option (there is no v1 source for it) and rejects an
  invalid v1 `bpm`.
- `useTimeline()` in `@vixeq/react`: mirrors the `useArrangement()`/
  `useSequencerEngine()` contract (`playbackState`, `pendingOperation`/
  `isBusy`, `positionRef`/`onPosition`, `projectError`/`transportError`,
  `play`/`pause`/`stop`/`toggle`/`seekPositionMs`/`seekBeat`/
  `setPlaybackRate`/`setLoop`) around `TimelineEngine`, with atomic
  project hot-swap and a serialized command queue.
- `website-pulse` example now demonstrates `TimelineEngine`-driven caption/
  marker cues alongside the existing Sequencer-driven pulse effects, as a
  full-show loop.
- Reusable beta migration fixture
  ([`fixtures/migration/v1-to-v2.json`](./fixtures/migration/v1-to-v2.json))
  covering Timeline and Arrangement migration success, warnings, and failure
  cases; used by both the Core unit tests and `pnpm smoke:pack`.

### Changed

- `TimelineTrack.data`/`TimelineEvent.data` narrows from
  `Record<string, unknown>` to a JSON-compatible `JsonObject` (finite numeric
  leaves only).
- `TimelineQueryOptions` gains `includeGlobalEvents` (default `true`),
  decoupled from `trackIds` filtering. An invalid beat range now throws
  `RangeError` instead of being silently reordered.

### Breaking

- `TimingMap.offsetMs` is renamed `TimingMap.startPositionMs` (pure rename,
  same pre-roll semantics).
- `TimelineEvent.durationBeats` and `TimelineEvent.value` are removed;
  Timeline supports point events only. Fold any previously-meaningful value
  into `TimelineEvent.data`.
- `TimelineTrack.type` is removed with no replacement field; use
  `TimelineEvent.type` (now required) or a `data` key instead.
- `TimelineEvent.trackId: "global"` is renamed `TimelineEvent.trackId: null`.
- `sequenceProjectToTimeline()` is removed with no direct replacement;
  construct a `TimelineProject` explicitly (see the migration guide).
- `TimelineProject.version` and `ArrangementProject.version` are bumped to
  `2`; `TimelineProjectV1`/`ArrangementProjectV1` are the v1 shapes accepted
  by the migration functions.

### Fixed

- `SequencerEngine` no longer permanently stops emitting `"step"` events (and
  therefore stops triggering envelope-driven channel animation, e.g.
  `useAnimatedChannels`) after the first time a transport it is attached to
  loops. Discovered via `website-pulse`'s full-show loop feature (0.8/T6):
  any Sequencer + looping-transport combination previously froze after one
  loop wrap, because the step-emission monotonicity guard was never
  re-anchored on the transport's `"loop"` event.
- `StepEventCause` gains a `"loop"` member (`"play" | "tick" | "seek" |
  "project-change" | "loop"`), emitted by `SequencerEngine` for the
  re-anchoring step described above. `ArrangementEngine` shares the same
  `StepEventCause` type but does not produce `"loop"`: its step re-emission
  guard compares section+step identity rather than an ever-increasing
  absolute counter, so a loop-caused position wrap naturally re-fires
  without needing an explicit `"loop"` branch.

### Migration Notes

- Full before/after examples for every change above are in the
  [0.8 migration guide](./docs/migrations/0.8-timeline-arrangement-v2.md),
  including the
  [Timing/Timeline/Arrangement v2 contract](./docs/behavior/timeline-arrangement-v2.md).
- `normalize*()` functions (`normalizeTimingMap()`,
  `normalizeTimelineProject()`, `normalizeArrangement()`) repair data within
  one schema version and never change `version`; they are not a substitute
  for `migrateTimelineProject()`/`migrateArrangementProject()` across
  versions.

## 0.7.0-beta.1 - 2026-07-09

Playback v2: transport-owned sampling and standardized play/pause/stop/seek
semantics across Core, React, and Player React. There are no deprecated
aliases in 0.7 — see the
[migration guide](./docs/migrations/0.7-playback-v2.md) before upgrading.

### Published

- Published to npm under the `beta` dist-tag; the `latest` tag is untouched
  (still `0.5.0`). Install explicitly with `@beta`, e.g.
  `npm install @vixeq/core@beta`.
  - [`@vixeq/core@0.7.0-beta.1`](https://www.npmjs.com/package/@vixeq/core/v/0.7.0-beta.1)
  - [`@vixeq/react@0.7.0-beta.1`](https://www.npmjs.com/package/@vixeq/react/v/0.7.0-beta.1)
  - [`@vixeq/player-react@0.7.0-beta.1`](https://www.npmjs.com/package/@vixeq/player-react/v/0.7.0-beta.1)
- Verified against the packed tarballs (`pnpm smoke:pack`) and against a
  clean consumer installing directly from the npm registry: ESM/CJS imports,
  public types, React SSR, and `@vixeq/player-react/styles.css` resolution
  all pass.
- Known caveat: this is a prerelease with no deprecated aliases for the 0.6
  API — see the migration guide above before adopting the beta.

### Added

- Shared `PlaybackTransport` contract in `@vixeq/core`, with `PlaybackClock`,
  `PlaybackSnapshot`, and `PlaybackError` types. `SequencerEngine` and
  `ArrangementEngine` both consume a `PlaybackTransport` via the `transport`
  option.
- `SequencerPlaybackEvent` (`EnginePlaybackEvent` with a
  `SequencerPlaybackSnapshot`), the Sequencer-specific event type for
  `SequencerEventMap["playback"]`. `EnginePlaybackEvent.snapshot` stays the
  generic `EnginePlaybackSnapshot` so other Engines (Arrangement) define their
  own concrete playback event type under the shared name.
- `Envelope.reset()` on the `Envelope` interface, for consistent re-triggering
  across transport seeks and Project changes.
- `motionPreference` option (`"system" | "reduce" | "no-preference"`) on
  `useAnimatedChannels`, replacing the boolean `reducedMotion` flag. In
  reduced mode, ordinary step ticks are ignored but explicit seek/stop/Project
  changes still produce one fresh static sample.
- Packed-tarball beta smoke harness (`pnpm smoke:pack`) verifying ESM/CJS
  imports, public types, React SSR, and `styles.css` resolution from the
  packed `@vixeq/core`, `@vixeq/react`, and `@vixeq/player-react` tarballs
  across all examples.

### Changed

- `SequencerEngine` and `ArrangementEngine` controls are now asynchronous:
  `play()`, `pause()`, `stop()`, `seekStep()`, and `seekPositionMs()` replace
  `start()`, `reset()`, `setBpm()`, and the raw `clock`/`timeDriven`/`originMs`
  options. `stop()` always returns to position 0; use unit seek to pause in
  place.
- `sampleChannels()` reads the Engine's current transport position directly
  (no `performance.now()` argument); `sampleChannelsAt(elapsedMs, easing)`
  samples a Project-relative offset instead.
- Step and Arrangement section events carry `scheduledPositionMs`,
  `transportPositionMs`, `lateByMs`, and `cause` instead of a raw clock
  `timestamp`, removing consumer-maintained timestamp interpolation.
- `@vixeq/react` hooks (`useSequencerEngine`, `useSequencePlayer`,
  `useArrangement`) expose `playbackState`, `pendingOperation`/`isBusy`,
  `positionRef`/`onPosition`, and separate `projectError`/`transportError`
  state, replacing `isPlaying`, `isStarting`, and the single `error` field.
- `SequencePlayerRef` (`@vixeq/player-react`) replaces `reset()` with `play()`,
  `pause()`, `stop()`, `toggle()`, `seekStep()`, `seekPositionMs()`,
  `setPlaybackRate()`, and `setTransportLoop()`. Built-in controls render a
  Play/Pause toggle plus a separate Stop action.
- `SequencerEngine`, `ArrangementEngine`, and Project update methods validate
  and throw `TypeError` on malformed typed input instead of normalizing it;
  normalize untrusted JSON explicitly with `normalizeProject()` before
  construction. Seek and rate inputs are no longer clamped or
  modulo-normalized.

### Breaking

- `AudioClock`/`AudioContextClock`, `createAudioClock()`, and
  `createAudioContextClock()` are removed; use `createMediaElementTransport()`
  or `createAudioBufferTransport()`. `SequencerTransport` is renamed
  `PlaybackTransport`; `SequencerClock` is renamed `PlaybackClock`.
- `TransportEvent` and `ArrangementTransportEvent` are unified into
  `EnginePlaybackEvent`; the Engine `"transport"` event and
  `onTransportChange` callbacks are renamed `"playback"` /
  `onPlaybackChange`.
- `timeDriven` and `originMs` Engine options are removed (playback is always
  time-driven; the Engine owns logical anchoring). The transport
  `stopAtMs` option is removed.
- `useAnimatedChannels({ reducedMotion })` is removed; pass
  `motionPreference: "reduce"` instead. Envelope mode requires a
  `ChannelSource` and no longer accepts `latestEvent` without an Engine.

### Migration Notes

- Full before/after examples for every change above are in the
  [0.7 migration guide](./docs/migrations/0.7-playback-v2.md), including the
  [Playback v2 contract](./docs/behavior/playback-v2.md) and
  [behavior matrix](./docs/behavior/playback-v2-matrix.md).
- An Engine borrows its transport: `engine.dispose()` does not dispose a
  caller-supplied transport. Dispose the transport separately.

## 0.6.0 - 2026-07-05

### Added

- Arrangement projects, pure resolution helpers, and `ArrangementEngine` for multi-pattern playback with gaps, section events, seek, optional looping, deterministic ending, and atomic hot-swap.
- `useArrangement()` with recoverable error state and live arrangement updates.
- `usePrefersReducedMotion()`, an opt-in helper for wiring the OS reduced-motion preference into `useAnimatedChannels({ reducedMotion })`.
- Lifecycle, StrictMode, hot-swap, pointer editing, imperative ref, and validation tests across Core, React, and Player React.
- Non-musical `examples/cycling-workout` demonstration and package API references under `docs/api`.

### Changed

- `useAnimatedChannels()` accepts the shared `ChannelSource` contract and therefore supports both sequencer engines.
- Arrangement loop behavior is an engine option rather than project data, keeping playback policy separate from arrangement content.

### Breaking

- `validateProject` now enforces bpm/stepCount/stepsPerBeat ranges, `steps.length === stepCount`, step values within 0-1, and non-empty/unique track ids. Projects that previously validated may now be rejected — run them through `normalizeProject` to repair.

### Migration Notes

- Use `ArrangementEngineOptions.loop` or `useArrangement({ loop: true })` instead of storing `loop` on `ArrangementProject`.
- `ArrangementEngine.reset()` is now parameterless and always returns to beat 0. Use `seek(beat)` to move to an arbitrary position.

## 0.5.0 - 2026-06-30

### Added

- **Envelope primitives** in `@vixeq/core`:
  - `createEnvelope(options)` — time-based attack/decay envelope with configurable curve (`attack?`, `decay?`, `curve?`, `peak?`).
  - `createDecayEnvelope(config)` — impulse-and-exponential-decay envelope backed by the existing `smoothing.ts` helpers (`exciteSmoothedValue` / `decaySmoothedValue`). Matches the beat-driven "punch-and-drop" pattern used in visual choreography.
  - Both implement the `Envelope` interface (`trigger(timeMs, value?)` / `sample(timeMs)`).
- **`@vixeq/core/dom` subpath** — DOM utility, tree-shakable and separately importable:
  - `bindChannelsToElement(element, values, mapping, options?)` — writes a `Record<string, number>` of channel values as CSS custom properties on an `HTMLElement`. Replaces hand-rolled `element.style.setProperty` loops.
- **`useAnimatedChannels` hook** in `@vixeq/react`:
  - Runs a `requestAnimationFrame` loop and samples channel values every frame.
  - **Envelope mode**: pass `envelopes` (a map of `trackId → Envelope`); the hook subscribes to step events and calls `envelope.trigger()` / `envelope.sample()` each frame.
  - **Interpolation mode** (default, no envelopes): calls `engine.sampleChannels(now, easing)` each frame for smooth lerp-based animation.
  - Accepts `latestEvent` in options as an alternative envelope trigger source when the engine is not directly accessible (e.g. when using `SequencePlayer`'s `onStep` callback).
  - `reducedMotion` option pauses the rAF loop. SSR-safe (no `window.matchMedia` access).
  - Values are stored in a mutable ref and pushed via `onFrame` callback — no React re-renders per frame.
- **`engine` field** on `useSequencerEngine` / `useSequencePlayer` return value — exposes the underlying `SequencerEngine | null` for consumers who need direct engine access (e.g. for `useAnimatedChannels`).
- **`onEngineChange` prop** on `SequencePlayer` (`@vixeq/player-react`) — callback called with the `SequencerEngine` when it becomes available and with `null` when disposed. Allows consumers of `SequencePlayer` to pass the engine to `useAnimatedChannels` for zero-re-render animation.

### Changed

- `examples/website-pulse` refactored to use the new public API: `useSmoothedChannels.ts` (hand-rolled rAF + CSS variable writes) replaced by `useAnimatedChannels` + `bindChannelsToElement`. Visual output is identical.

### Notes

- `@vixeq/core/dom` introduces the first `HTMLElement` usage in the core package. `@vixeq/core` itself remains DOM-free; the DOM utilities are behind the `./dom` subpath and are never imported by the main entry point.
- Envelope mode and interpolation mode produce different animation curves. Use `createDecayEnvelope` for percussion-style "impulse and decay"; use `sampleChannels`-based interpolation for smooth continuous morphing between step values.

## 0.4.0 - 2026-06-22

### Added

- Added the public `SequencerTransport` type for clock-backed playback sources.
- Added browser audio transport helpers in `@vixeq/core`:
  - `createMediaElementTransport()` for `HTMLMediaElement` playback.
  - `createAudioBufferTransport()` for Web Audio `AudioBuffer` playback and seamless loops.
- Added transport-aware controls to `@vixeq/react`:
  - `useSequencerEngine({ transport })`.
  - `isStarting` and `transportError` state.
  - async `play()`, `stop()`, `toggle()`, and `reset()` controls.
- Added `transport` and `showTransportControls` props to `SequencePlayer`.
- Added audio clock and time-driven sequencer coverage, including AudioContext and transport tests.

### Changed

- `SequencePlayerRef` control methods now return `Promise<void>`.
- `useSequencerEngine()` and `useSequencePlayer()` control methods now return `Promise<void>`.
- `examples/website-pulse` now uses an audio-buffer transport for loop-synced choreography and supports loading a custom audio file.

### Migration Notes

- React event handlers can ignore the returned promise with `void player.toggle()` or await it when handling transport failures.
- Cleanup callbacks should not return these promises directly:
  ```ts
  return () => {
    void player.stop();
  };
  ```

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
