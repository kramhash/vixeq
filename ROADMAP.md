# Vixeq Roadmap

## Vision

Vixeq is a **general-purpose timing engine for the web**. The entry point is musical (BPM, steps, tracks) but the use cases are not limited to music: data visualization, ambient backgrounds, game-like periodic effects, UI choreography — anything that benefits from a clock-driven stream of `0.0`–`1.0` control values.

Two first-class use cases illustrate the breadth:

- **Visual sequencer**: A live-event landing page where every CSS property — glow intensity, scale, color, EQ bar heights — is driven by a single `SequenceProject` editable in real time. (`examples/website-pulse`)
- **Music-synchronized presentation**: A visual show driven by vixeq that follows an external audio file. The sequencer tracks in sync with the music — play, pause, seek, and scrub all reflected immediately in the visuals. vixeq does not play audio; it follows whatever is playing.

## Guiding Principles

- **Core stays dependency-free.** `@vixeq/core` will never take a runtime dependency.
- **Respect backward compatibility.** Since 1.0, breaking changes ship only in
  a major release, after a deprecation period, with a migration note in
  `CHANGELOG.md` (see `SUPPORT.md`).
- **Separation of concerns.** Pure logic (`core`) → hooks (`react`) → GUI (`player-react`). Each layer is independently usable.
- **Examples over documentation.** A working, runnable example is worth more than prose.

## Release Plan

### 0.3.0 — Engine Expressiveness ✓

**Theme**: Give the engine more degrees of freedom without breaking any existing code.

Delivered:
- `stepsPerBeat` on `SequenceProject` (default `4`). Enables eighth notes, thirty-second notes, triplets, or arbitrary step rates.
- `StepEvent.durationMs`: step length in milliseconds, derived automatically from BPM and `stepsPerBeat`.
- `StepEventTrack.nextValue`: the value at the next step index (wrapping), enabling deliberate `value → nextValue` interpolation within a step.
- New `easing` module: `linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeInCubic`, `easeOutCubic`, `easeInOutCubic`, `lerp`.
- `examples/website-svg`: SVG brandmark driven by a sequencer with continuous interpolation.
- `examples/website-pulse`: live-event landing page with real-time editable CSS choreography.

---

### 0.4.0 — Time-Driven Playback & Audio Sync ✓

**Theme**: Drive the sequencer from absolute time rather than an internal counter — enabling seek-accurate audio sync, tempo-variable timelines, and frame-accurate interpolation sampling.

Historical note: this section records the original 0.4 design. Playback v2
later replaced the public clock-domain API with `PlaybackTransport`; current
consumers should follow the 0.7+ migration notes rather than the older
`timeDriven` / `originMs` / `createAudioClock` examples below.

#### Time-driven playback mode

Currently `SequencerEngine` advances its step counter one increment per tick. This makes it impossible to seek: if the time source jumps forward or backward, the step counter does not follow.

The fix is a time-driven mode where step position is derived from the current timestamp at each tick:

```
stepIndex = floor((now - originMs) / stepDurationMs) mod stepCount
```

This makes seek, scrub, and variable playback rate trivially correct. The increment-based mode remains the default for backwards compatibility.

Files to touch:
- `packages/core/src/SequencerEngine.ts` — add time-driven mode option and step-from-time derivation
- `packages/core/src/types.ts` — extend `SequencerEngineOptions` with `timeDriven?: boolean`, `originMs?: number`

#### `sampleChannels(timeMs)` — frame-accurate interpolation

The current model requires callers to maintain their own `requestAnimationFrame` loop and re-derive `(now - event.timestamp) / stepDurationMs` from the last step event. `sampleChannels` replaces this boilerplate:

```ts
const values = engine.sampleChannels(performance.now());
// { trackId: interpolatedValue, ... }
```

Returns the easing-interpolated `value → nextValue` position for each track at an arbitrary timestamp. Requires the time-driven mode so the engine knows the origin.

Files to touch:
- `packages/core/src/SequencerEngine.ts` — add `sampleChannels(timeMs): Record<string, number>`
- `packages/core/src/types.ts` — add return type

#### `createAudioClock` — hybrid audio sync

A `SequencerClock` implementation that locks the sequencer to the playback position of an external `HTMLMediaElement` (`<audio>` or `<video>`).

Design — hybrid for smooth sync:
- `<audio>` element handles transport: play, pause, seek, loop, rate.
- `AudioContext` provides a high-resolution monotonic clock for interpolation between `currentTime` updates.
- `now = mediaTime + (ctx.currentTime - ctxAnchor) * rate` — updated on `play`, `pause`, `seeked`, `ratechange`.
- If no `AudioContext` is provided, falls back to `mediaEl.currentTime * 1000` directly (simpler, slightly coarser).

```ts
import { createAudioClock } from "@vixeq/core";

const clock = createAudioClock(audioEl, { audioContext: ctx });
const engine = new SequencerEngine(project, { clock, timeDriven: true });

audioEl.play();   // sequencer advances with the audio
audioEl.pause();  // sequencer pauses
audioEl.currentTime = 30; // sequencer jumps to the matching step
```

Core stays dependency-free: `AudioContext` and `HTMLMediaElement` are browser globals, not npm imports.

Files to touch:
- `packages/core/src/clock.ts` — add `createAudioClock`
- `packages/core/src/types.ts` — extend `SequencerClock` if needed, add `AudioClockOptions`
- `packages/core/src/index.ts` — export `createAudioClock`

#### Timeline module connection

The `@vixeq/core` package already has a complete data layer for tempo-variable timelines (`TimingMap`, `TimelineProject`, `beatToMs`, `getEventsInBeatRange`). The same time-driven foundation that enables audio sync also connects this module to `SequencerEngine`: tempo-change boundaries become first-class schedule points rather than postprocessing.

Work:
- Extend or companion `SequencerEngine` to accept a `TimelineProject` and schedule tick times using `beatToMs` across tempo-change boundaries.
- Ensure `missedStepPolicy` semantics carry over.

#### Flagship example update

Update `examples/website-pulse` with an audio sync demo: a short CC0/royalty-free loop plays alongside the existing visual choreography, synchronized via `createAudioClock`. The existing editable sequencer UI remains. Audio source license to be attributed in the example README.

**Deliverables**: updated packages, tests for new code paths, `website-pulse` updated with audio sync demo.

---

### 0.5.0 — Bindings & Envelope ✓

**Theme**: Formalize the "rAF loop + envelope + CSS var" pattern that appears in every beat-driven visual, removing the DIY boilerplate.

Delivered:
- `createEnvelope(options)` — time-based attack/decay envelope with configurable `attack`, `decay`, and `curve`. Trigger on a step event; sample at any timestamp.
- `createDecayEnvelope(config)` — impulse-and-exponential-decay envelope backed by `smoothing.ts`. Reproduces the percussive "punch-and-drop" pattern from `website-pulse`.
- `Envelope` interface (`trigger(timeMs, value?)` / `sample(timeMs)`) — unified contract implemented by both envelope types.
- `@vixeq/core/dom` subpath — `bindChannelsToElement(element, values, mapping)` writes a channel value map to CSS custom properties. Core remains DOM-free; the binder is a separate tree-shakable entry.
- `useAnimatedChannels(engine, options)` in `@vixeq/react` — rAF loop with two modes:
  - **Envelope mode**: subscribes to step events; triggers and samples `Envelope` instances per frame.
  - **Interpolation mode**: calls `engine.sampleChannels(now, easing)` per frame.
  - `reducedMotion` option; `onFrame` callback for zero-overhead DOM writes; `latestEvent` option for use without direct engine access.
- `engine: SequencerEngine | null` added to `useSequencerEngine` / `useSequencePlayer` return value.
- `examples/website-pulse` — `useSmoothedChannels.ts` deleted; refactored to use the new public API with identical visual output.

**Arrangement / section switching** was deferred to a future release. It requires a new playback model in `SequencerEngine` (currently a single looping `SequenceProject`) and benefits from independent scope.

---

### 0.6.0 — Arrangement & Reliability ✓

**Theme**: Multi-pattern arrangement, test coverage, and SSR ergonomics.

Delivered in 0.6.0: ArrangementEngine and React integration, missing lifecycle and editor coverage, SSR-safe reduced-motion detection, a non-musical interval workout example, and Markdown API references.

#### Arrangement / section switching

Currently a `SequenceProject` is a single looping pattern. Building a full-song visual show requires sequencing multiple patterns in time. Work:
- Arrange API: a sequence of (`patternId`, `startBeatOrMs`, `endBeatOrMs`) entries that the engine resolves at runtime.
- Pattern switching on the existing timeline foundation from 0.4.0.

#### Test coverage

Known gaps (as of v0.5.0):
- `packages/react/src/useSequencerEngine.ts` — no tests (lifecycle, project hot-swap, StrictMode)
- `packages/player-react/src/SequencePlayer.tsx` — no tests (pointer-drag editing, imperative ref, nine edit reason types)
- `packages/core/src/validation.ts` — no dedicated tests for `validateProject` / `normalizeProject`

Work: Vitest + React Testing Library tests for the above. Any API surface adjustments identified during testing.

#### `prefers-reduced-motion` and SSR ergonomics

`@vixeq/react` hooks run in `useEffect` which is safe for SSR. Remaining work:
- `useAnimatedChannels` currently takes `reducedMotion` as an option. Add a `usePrefersReducedMotion()` helper hook that reads `window.matchMedia` — so callers don't need to wire this manually.
- No `window` accesses in the module entry point.

#### Non-musical example

Add one example demonstrating a use case with no musical framing — e.g., a data visualization dashboard where bar heights are driven by a `SequenceProject`, or a generative ambient background shader. This proves the "general-purpose timing engine" claim concretely.

#### API reference documentation

Document the public API surface — types, function signatures, options — in a format suitable for a future docs site.

---

### 0.7.0 — Playback v2 ✓

**Theme**: Replace clock-domain-dependent playback with one transport-owned,
testable state model before extending Timeline.

- [x] Approve the Playback v2 behavioral contract, behavior matrix, and 0.7 migration map.
- [x] Replace `SequencerTransport` and direct Engine clock options with shareable `PlaybackTransport`.
- [x] Standardize async `play` / `pause` / `stop` / unit-specific seek semantics.
- [x] Make `SequencerEngine` always time-driven and remove public `timeDriven` / `originMs`.
- [x] Make channel sampling and Envelopes use logical transport position.
- [x] Apply strict Engine validation and atomic Project hot-swap.
- [x] Align React hooks and `player-react` with playback state, pending operations, errors, position refs, and reduced motion.
- [x] Migrate official examples and verify packed `0.7.0-beta.n` packages before stable release.

The approved contract is in
[`docs/behavior/playback-v2.md`](./docs/behavior/playback-v2.md). Detailed task
ownership and dependencies are in
[`docs/plans/v1-collaboration-spec.md`](./docs/plans/v1-collaboration-spec.md).

---

### 0.8.0 — Timeline and Arrangement v2 ✓

**Theme**: Add variable-tempo cue scheduling and connect Arrangement playback
to the same timing map without building a DAW editor.

- [x] Replace `TimingMap.offsetMs` with transport-relative `startPositionMs` and enforce a strict tempo map.
- [x] Introduce point-event-only `TimelineProject` v2 with explicit duration and JSON-safe payloads.
- [x] Add indexed `TimelineEngine` and `useTimeline()`.
- [x] Introduce `ArrangementProject` v2 with shared `TimingMap` and explicit duration.
- [x] Add explicit, issue-reporting Timeline and Arrangement v1-to-v2 migration APIs.
- [x] Integrate Sequencer animation and Timeline cues over one shared audio transport in `website-pulse`.
- [x] Verify packed `0.8.0-beta.n` packages and migration fixtures before stable release.

---

### 0.9.0 — Release Readiness ✓

**Theme**: Make public stability measurable before the API freeze.

Published 2026-07-13. The one item left open at publish time (coverage in CI)
was completed by RC1E before the RC.

- [x] Commit API Extractor reports for all three public packages and fail CI on unreviewed differences (see `pnpm api:check`/`pnpm api:update` and `.github/workflows/ci.yml`).
- [x] Add coverage configuration enforcing Core branch coverage of at least 90%,
  React/player-react branch coverage of at least 85%, and 100% on critical
  playback/timing/migration modules (`pnpm test:coverage` per package). RC0
  lifted Core global branch coverage above 90%, and RC1A-RC1D closed the
  remaining 100%-tier gaps.
- [x] Test Node.js 22 and 24 (CI matrix), React 18 and 19, TypeScript `>=5.5 <6`,
  SSR imports, and ESM/CJS packed consumers. React 18/TypeScript 5.5 are
  verified via `SMOKE_REACT_VERSION=18`/`SMOKE_TS_VERSION=5.5 pnpm smoke:pack`
  fixtures wired into CI; `publint` and Are The Types Wrong also run against
  every packed tarball (`pnpm smoke:pack`). Runner OS stays Ubuntu-only; the
  browser matrix is separate (see the E2E item below).
- [x] Run actual media E2E in the locked Playwright Chromium, Firefox, and WebKit versions.
  `@playwright/test` pinned at exact `1.61.1`. A deterministic harness
  (`e2e/harness/`, Playwright Clock API) covers exact-timing
  play/pause/stop/seek/rate/loop/natural-end/error/shared-Engine-sync
  assertions (`e2e/tests/media.spec.ts`); `website-pulse`'s real
  `AudioBuffer` transport is driven end to end with loose tolerances
  (`e2e/tests/product.spec.ts`), capability-gating WebKit's real audio
  position progression. Wired into CI as a separate `e2e` job.
- [x] Add pull-request CI for typecheck, tests, builds, API reports,
  behavior-matrix checks, compatibility fixtures, package smoke tests, and
  browser E2E.
- [x] Wire coverage into pull-request CI after the RC1 critical-file branch
  gaps are closed (RC1E).
- [x] Polish `website-pulse`, `cycling-workout`, and playground release
  fixtures for the 0.9 release-readiness line. Any RC-blocking fixture gaps
  are tracked by the 1.0 RC gates.
- [x] Publish a Pages index with `/playground/`, `/website-pulse/`, and `/cycling-workout/`.
  `scripts/build-pages.mjs` assembles `_site/` and also publishes
  `/arrangement-demo/` and `/docs/`; `.github/workflows/pages.yml` builds and
  deploys the artifact, with a builder test wired into CI.
- [x] Finalize support, semver, migration, and release documentation before
  `1.0.0-rc.1` (`SUPPORT.md`, the migration guide index, and the 1.0 release
  checklist).
- [x] React hooks render-frugal refactor: `latestEvent` state → `latestEventRef` ref
  (see the render-frugal migration guide).

All public packages use lockstep versions, including prereleases, through these milestones.

---

### 1.0.0-rc.1 — API Freeze

**Theme**: Freeze the candidate API and validate the distributable packages under real usage.

- [x] Close the remaining 100%-tier Engine branch gaps and wire `pnpm test:coverage` into CI (RC1B-RC1E).
- [x] Refresh the toolchain to the 1.0 support targets: Node 22/24/26, TypeScript `>=5.5` verified on 5.5, the 6.0 workspace, and a 7.0 consumer fixture, and Playwright re-locked at `1.64.0` with an updated browser table in `SUPPORT.md` (RC1F).
- [x] Close the Engine re-entrancy gaps found by the adversarial review of RC1B–RC1D: catch-up dispatch in Timeline/Arrangement and the Timeline local-end branch must stop when a listener re-entrantly seeks, hot-swaps, changes loop, or disposes (RC1G).
- [x] Make Arrangement delayed-tick dispatch honor `missedStepPolicy` across a local loop wrap, section gaps, and local end, with section and step events in time order (RC1H).
- [x] Make Timeline `missedCuePolicy: "skip"` dispatch only the most advanced due cue of a whole delayed tick, not one per crossed loop iteration (RC1I).
- [x] Let callers supply track ids and make generated ids project-local and deterministic, so ids no longer depend on call order (RC1J, issue [#3](https://github.com/kramhash/vixeq/issues/3); moved here from 1.1.0 because generated ids change).
- [x] Handle a negative `TimingMap.startPositionMs` (beat 1 before the start of the audio) instead of silently clamping it to 0 (RC1K, issue [#4](https://github.com/kramhash/vixeq/issues/4)).
- [x] Harden the tag-triggered publish workflow before the RC: run every repository gate, publish prereleases under the `next` dist-tag, attach npm provenance, and create a GitHub Release. The RC itself is published through this workflow (RC2).
- [x] Freeze all three public package APIs against their committed reports.
- [x] Publish all public packages at the same RC version.
- [x] Make the official examples consume the packed RC packages rather than workspace source paths for release verification.
- [x] Verify fresh installation from npm tarballs, including ESM, CJS, types, exports, and CSS entry points.
- [x] Validate the RC in a real consumer: upgrade the frapx integration lab from 0.9 using only the published migration notes, then build it and exercise every page. This replaced the 14-day observation window on 2026-10-30, because the RCs had no outside users who could report defects in that time.
- [x] Require zero known blocker or critical defects.
- [x] Require the compatibility matrix to remain green. A defect that needs a public API change ships in a new RC, which is validated the same way.

---

### 1.0.0 — Stability Commitment

**Theme**: Retire the early-development label and begin explicit semver guarantees.

- [x] Confirm every 0.7–0.9 and RC gate is complete.
- [x] Publish `@vixeq/core`, `@vixeq/react`, and `@vixeq/player-react` at the same `1.0.0` version.
- [x] Remove the README and package README early-development and pre-1.0 stability disclaimers.
- [x] Confirm the compatibility matrix, semver policy, and support policy still
  match the final published `1.0.0` artifacts.
- [x] Deprecate public APIs with `@deprecated` and migration notes for at least two minor releases; remove them only in the next major release, except for security or correctness emergencies.
- [x] Publish through the tag-triggered release workflow hardened in RC2 (all gates, npm provenance, GitHub Release); `1.0.0` must not be the first release to take that path.
- [x] Run a post-publish clean-install smoke test.

---

### 1.1.0 — Time-Based Evaluation

**Theme**: Fill the gaps the frapx integration lab found when driving shaders
and offline rendering from vixeq. Every item is additive; no 1.0 API changes.

- [ ] Pure time-based evaluation for shader and offline rendering: a free-function sampler for a single `SequenceProject`, a "last step at or before" query, envelopes evaluated from position alone (with attack and look-ahead), and a hold easing (issue [#5](https://github.com/kramhash/vixeq/issues/5)).
- [x] Output-latency compensation on the audio transports (issue [#6](https://github.com/kramhash/vixeq/issues/6)).
- [ ] Move the playground visualizer to `@frapx/fx-canvas` with `bindUniforms`, after the pure evaluation API lands (issue [#7](https://github.com/kramhash/vixeq/issues/7)).
- [ ] Public `getDurationMs()` / `getDurationBeats()` on `SequencerEngine`, `ArrangementEngine`, and `TimelineEngine`.

Caller-supplied track ids moved to 1.0.0-rc.1 (RC1J).

---

### 1.2.0 — Channel Sinks

**Theme**: Make the per-frame channel output pluggable. Every item is additive.

- [ ] `ChannelSink` contract: a target that receives a sampled channel value map each frame.
- [ ] `animateChannels(source, sinks)` in `@vixeq/core/dom`: the non-React rAF loop that `cycling-workout` currently hand-writes, writing to any number of sinks.
- [ ] `createElementSink(element, mapping)`: the CSS custom property sink, built on the same contract as `bindChannelsToElement`.

The sink contract ships one minor release before the first external sink so
that MIDI can build on a contract that real usage has already validated.

---

### Candidate — Arrangement Editing in `@vixeq/player-react`

Editing an `ArrangementProject` (sections on a beat timeline, with a pattern
picker) in the player (issue [#2](https://github.com/kramhash/vixeq/issues/2)).
Its scope and release are decided after 1.1.0 ships.

---

### 1.3.0 — MIDI CC Output

**Theme**: Send channel values to hardware and DAWs as MIDI control changes.

- [ ] `@vixeq/midi` with `createMidiCcSink`: maps channel `0.0`–`1.0` to 7-bit CC `0`–`127` over the Web MIDI API (no npm dependency), sending only on change and with throttling.
- Continuous CC output only. Note/trigger output, MIDI clock master, and MIDI input stay out of scope (see below): they require sub-millisecond scheduling or inbound control, which conflicts with vixeq following external time rather than producing it.

---

### Future — OSC Output

OSC output through the same `ChannelSink` contract is a candidate after 1.3.
Browsers cannot send raw UDP, so it needs a WebSocket-to-UDP bridge; its design
is deferred until `@vixeq/midi` has shipped.

---

### Ongoing — Documentation and Adoption

These tasks run in parallel with the release cycles above:

- **Update `README.md`**: list the current examples and keep the scope, package status, and exclusions aligned with shipped behavior.
- **Preset expansion**: add more named presets to `presets.ts` (e.g., triplet, waltz, slow pulse, burst). Started with a `default` preset; the named rhythmic variants are still open.
- **Docs site (`apps/docs`)** ✓: an Astro/Starlight + TypeDoc reference site, published to
  `/docs/` alongside the playground. TSDoc comments in `packages/*/src` are now the
  primary source for the public API reference (generated on every build via
  `pnpm --filter vixeq-docs docs:api`); the old hand-written `docs/api/*.md` files
  were retired in favor of it. This is independent of **R0** (0.9.0 — committed API
  Extractor reports for CI diffing, a machine-readable contract check) and **R4**
  (0.9.0 — a Pages index unifying `/playground/`, `/website-pulse/`, and
  `/cycling-workout/`), neither of which this work replaces.

## Explicitly Out of Scope

These items are not planned:

- **Audio engine** — vixeq does not generate, synthesize, or schedule audio. It follows external audio through `PlaybackTransport`; it does not produce it. Tone.js integration, sample playback APIs, Web Audio graph construction, and MIDI scheduling remain out of scope.
- **MIDI input, MIDI note/trigger output, and MIDI clock** — continuous CC output is planned for 1.3.0 (see above).
- **DAW-style timeline editing UI**
- **URL sharing / project serialization beyond JSON export**
