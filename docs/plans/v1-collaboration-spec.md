# Vixeq 1.0 Collaboration Specification

- Status: Approved design baseline
- Approved: 2026-07-08
- Audience: Codex, Claude, and human maintainers
- Scope: `0.7.0` through `1.0.0`

This document is the working source of truth for the pre-1.0 redesign. Agents
must not infer behavior from the current implementation when it conflicts with
this specification. Changes to an approved behavior require an explicit design
decision and an update to this document before implementation.

## 1. Current baseline

At the time of approval:

- Workspace tests pass: 193 tests.
- Workspace typecheck and build pass.
- The repository is released at `0.6.0`.
- Pull-request CI, API reports, coverage gates, compatibility fixtures, and
  browser E2E are not implemented.
- The current uncommitted `docs/behavior.md` and related JSDoc changes describe
  known defects and inconsistencies. They are issue inventory, not the target
  1.0 contract, and must be rewritten rather than committed as permanent
  behavior.

## 2. Release sequence

All public packages remain on lockstep versions, including prereleases.

### 0.7.0 — Playback v2

Deliver the shared playback foundation:

- `PlaybackTransport`
- explicit playback state machine
- async transport operations
- clock-domain-safe channel sampling
- strict Engine validation
- updated React hooks
- transport-position-driven Envelopes
- migration documentation for removed and renamed APIs

Publish `0.7.0-beta.n` before stable. Promote only after packed-package
fixtures and official examples pass against the beta tarballs.

### 0.8.0 — Timeline and Arrangement v2

Deliver:

- `TimingMap` v2
- `TimelineProject` v2 and `TimelineEngine`
- `ArrangementProject` v2 with tempo-map playback
- explicit v1-to-v2 migration APIs
- `useTimeline()`
- variable-tempo integration tests

Use the same beta-to-stable process as 0.7.

### 0.9.0 — Release readiness

Deliver:

- committed API Extractor reports
- API-difference CI
- coverage and behavior-matrix gates
- packed-package ESM, CJS, types, SSR, and CSS checks
- Node, React, TypeScript, and browser compatibility matrices
- browser E2E
- multi-example Pages deployment
- finalized support and semver documentation

### 1.0.0-rc.1 and 1.0.0

Publish an RC only after all 0.7–0.9 gates are green. Keep the RC public for
at least 14 days with no blocker or critical defects and no public API changes.
Any public API change starts a new RC observation period.

## 3. Playback v2 contract

### 3.1 Playback state

```ts
type PlaybackState = "stopped" | "playing" | "paused" | "ended";
```

- `stopped`: position 0.
- `playing`: transport position is advancing.
- `paused`: position is frozen away from the terminal state.
- `ended`: a finite, non-looping Engine reached its local end, or the shared
  transport ended.
- `play()` from `ended` starts again from position 0.
- Disposal is a separate lifecycle condition and is not a playback state.

### 3.2 PlaybackTransport

`SequencerTransport` is renamed to `PlaybackTransport`, and the low-level
`SequencerClock` is renamed to `PlaybackClock`. Engines consume a transport,
not a raw clock. A default browser transport is created internally; custom
clocks use `createClockTransport(clock)`.

The exact TypeScript surface may be refined during implementation, but it must
provide these capabilities:

```ts
type PlaybackTransport = {
  getPlaybackState(): PlaybackState;
  getPositionMs(): number;
  getPlaybackRate(): number;
  getLoop(): boolean;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekMs(positionMs: number): Promise<void>;
  setPlaybackRate(rate: number): Promise<void>;
  setLoop(loop: boolean): Promise<void>;
  subscribe(listener: (event: PlaybackTransportEvent) => void): () => void;
  dispose(): void;
};
```

Transport events cover at least `play`, `pause`, `stop`, `seek`, `ratechange`,
`loop`, `ended`, and `error`.

Rules:

- Operations are serialized in invocation order.
- A rejected operation does not break the queue.
- Operations are idempotent. State-preserving `play`, `pause`, `stop`, rate,
  and loop calls emit no duplicate event.
- An explicit seek emits a seek event even when the target equals the current
  position.
- `stop()` always returns to position 0. The existing `stopAtMs` option is
  removed.
- Playback rate must be finite and greater than zero. Reverse playback is out
  of scope.
- A transport supports multiple subscribers and may be shared by multiple
  Engines.
- A supplied transport is borrowed. Engine disposal unsubscribes but does not
  pause, stop, or dispose it.
- An internally created default transport is owned and disposed by its Engine.
- Attaching an Engine to an already-playing transport immediately adopts the
  transport snapshot but emits no synthetic historical/current step or cue.

Audio integration is transport-only:

- Keep `createMediaElementTransport`.
- Keep `createAudioBufferTransport`.
- Add `createClockTransport`.
- Remove `createAudioClock` and `createAudioContextClock`.
- Keep `browserClock` only as a low-level clock utility.

### 3.3 Engine controls

Core Engines use consistent asynchronous controls:

```ts
await engine.play();
await engine.pause();
await engine.stop();
```

- Remove `start()` and `reset()`.
- `stop()` means stop and return to the beginning.
- `pause()` means freeze and resume from the same position.
- Engine methods reject with transport failures.
- Promise rejection is the sole explicit command-error channel in Core. Do
  not emit a duplicate error event for a rejected command or add `lastError`
  state. Unsolicited asynchronous transport failures use the Engine playback
  `error` event.
- Engine playback events are named `"playback"`, not `"transport"`, to
  distinguish local Engine transitions from `PlaybackTransport` events.
- A consumer listener exception must not stop scheduling or prevent other
  listeners. Report it through optional `onListenerError`, then
  `globalThis.reportError`, then `console.error` as fallback.

Unit-specific seek names are mandatory:

- `SequencerEngine.seekStep(stepIndex)`
- `ArrangementEngine.seekBeat(beat)`
- `TimelineEngine.seekBeat(beat)` (added in 0.8)
- `PlaybackTransport.seekMs(positionMs)`

Seek inputs are strict and throw `RangeError`; do not clamp or modulo them.

- Sequence: finite integer, `0 <= stepIndex < stepCount`.
- Arrangement/Timeline: finite, `0 <= beat <= durationBeats`.

`toggle()` remains a React/UI convenience only. It is serialized and evaluates
the latest state when its queued operation executes.

### 3.4 Engine timing

- Remove the `timeDriven` option. `SequencerEngine` is always time-driven.
- Remove public `originMs` options.
- With no explicit transport position change, first `play()` anchors the
  Engine's current logical position.
- `pause()` stores position; replay anchors from that position.
- Project tempo changes preserve the current fractional beat without seeking
  external media.
- A later external `seekMs` discards the temporary live-edit anchor and
  recalculates from the current Project starting at position 0.
- Delayed natural playback uses `missedStepPolicy`. Explicit seek never does.

### 3.5 Sampling and ChannelSource

Replace the clock-domain-sensitive API:

```ts
sampleChannels(timeMs, easing?)
```

with:

```ts
sampleChannels(easing?)
sampleChannelsAt(timeMs, easing?)
```

- `sampleChannels()` samples the Engine's current logical transport position.
- It freezes while paused/stopped.
- `sampleChannelsAt()` is a pure evaluation at Project-relative elapsed
  milliseconds, not an absolute clock timestamp.
- Specialized pure beat-based helpers may remain for Arrangement.

`ChannelSource` includes the minimum state required by animation consumers:

```ts
type ChannelSource = {
  sampleChannels(easing?: EasingFunction): Record<string, number>;
  sampleChannelsAt(timeMs: number, easing?: EasingFunction): Record<string, number>;
  getPosition(): { positionMs: number; beat: number };
  getPlaybackState(): PlaybackState;
  on(event: "step", listener: (event: StepEvent) => void): Unsubscribe;
  on(event: "playback", listener: (event: EnginePlaybackEvent) => void): Unsubscribe;
  on(event: "project", listener: (event: ChannelProjectEvent) => void): Unsubscribe;
};
```

`SequencerEngine` and `ArrangementEngine` implement it. `TimelineEngine` does
not, because Timeline is a cue scheduler rather than a continuous channel
source.

### 3.6 Event timing

Remove ambiguous clock-domain `timestamp` fields. Step dispatch includes:

```ts
type StepEvent = {
  scheduledPositionMs: number;
  transportPositionMs: number;
  lateByMs: number;
  cause: "play" | "tick" | "seek" | "project-change";
  // existing step/project fields
};
```

- Natural delays: apply `missedStepPolicy`.
- Seek: do not emit crossed steps; emit one destination step with
  `cause: "seek"`.
- `stopped -> play`: emit step 0.
- `paused -> play`: do not re-emit the current step.
- `ended -> play`: return to the start and emit step 0.
- Project shortening may emit one destination event with
  `cause: "project-change"`; never replay intermediate steps.

### 3.7 Looping and local end

- 1.0 supports full-Project loop only. Arbitrary loop ranges are out of scope.
- Loop ranges are half-open: `[0, duration)`.
- Sequence patterns repeat by design.
- Arrangement and Timeline expose local `loop: boolean` behavior.
- Engine loop and transport loop are separate explicit settings.
- Engines do not mutate transport loop configuration implicitly.
- A local Engine reaching its end transitions to local `ended` but does not
  stop a shared transport.
- A transport-level end is observed by all attached Engines.

### 3.8 Envelope and reduced motion

Envelopes use logical transport positions, not `performance.now()`:

- Trigger with `scheduledPositionMs`.
- Sample with current transport position.
- Pause freezes Envelope time.
- Add `Envelope.reset()`.
- Stop and any seek reset all Envelopes; a destination step may retrigger the
  applicable Envelope.

`useAnimatedChannels` uses:

```ts
motionPreference?: "system" | "reduce" | "no-preference";
```

Default is `"system"`. Under reduced motion, cancel rAF, sample once, update
the ref and callback once, then freeze. Do not continue discrete step updates.

### 3.9 Validation and disposal

- Engine constructors and Project hot-swap APIs strictly validate input and
  throw `TypeError` on invalid data.
- Typed execution APIs never silently normalize.
- Import boundaries call explicit normalize or migration functions.
- Failed hot-swap is atomic and preserves old data, position, state, and event
  cursor.
- `dispose()` is idempotent and terminal.
- After disposal, playback, seek, update, subscribe, and sample APIs throw.

## 4. React v2 contract

`useSequencerEngine`, `useArrangement`, and `useTimeline` share this shape
where applicable:

- `engine`
- `playbackState`
- `positionRef`
- `latestEvent`
- `projectError`
- `transportError`
- `play`, `pause`, `stop`, `toggle`
- unit-specific seek operation

Continuous position is not React state:

```ts
positionRef.current // { beat, positionMs }
onPosition?.(position)
```

This prevents full component rerenders on every animation frame.

Error rules:

- `projectError`: construction or Project hot-swap validation.
- `transportError`: playback command rejection.
- A successful operation clears only its corresponding error category.
- Command Promises still reject after updating React error state.
- Hook state is derived from Engine events; do not maintain a competing
  playback-state source.

`@vixeq/player-react` remains a Sequence-only GUI. Arrangement and Timeline
receive Core Engines, React hooks, and examples, but no generic editor/player
component before 1.0.

## 5. TimingMap v2

```ts
type TempoEvent = {
  beat: number;
  bpm: number;
};

type TimingMap = {
  tempos: TempoEvent[];
  startPositionMs: number;
};
```

- Rename `offsetMs` to `startPositionMs`.
- It is finite, non-negative pre-roll measured from transport position 0.
- It is never a clock epoch.
- The first tempo event must be at beat 0.
- Tempo beats are finite, non-negative, and strictly increasing.
- Duplicate tempo beats are invalid.
- BPM values must satisfy supported limits.
- Tempo changes are instantaneous. Tempo ramps are out of scope for 1.0.
- `beatToMs` and `msToBeat` operate only on transport-relative positions.
- Strict APIs reject invalid maps; import normalization may repair within the
  same schema version.

## 6. TimelineProject v2

Timeline is a tempo-mapped sparse cue scheduler. It does not replace Sequence
or Arrangement and does not implement `ChannelSource`.

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

type TimelineTrack = {
  id: string;
  name: string;
  enabled: boolean;
  data?: JsonObject;
};

type TimelineEvent<
  TType extends string = string,
  TData extends JsonObject = JsonObject,
> = {
  id: string;
  trackId: string | null;
  beat: number;
  type: TType;
  data?: TData;
};

type TimelineProject<TEvent extends TimelineEvent = TimelineEvent> = {
  version: 2;
  timing: TimingMap;
  durationBeats: number;
  tracks: TimelineTrack[];
  events: TEvent[];
};
```

Rules:

- Timeline supports point events only in 1.0.
- Remove top-level `durationBeats` and `value` from Timeline events.
- Remove `TimelineTrack.type`; event `type` is required and non-empty.
- `trackId: null` represents a global event. Remove the magic `"global"` ID.
- Non-null event track IDs must reference an existing track.
- Project duration is finite and greater than zero.
- Event beats satisfy `0 <= beat < durationBeats`.
- Events are sorted by beat. Same-beat dispatch order is array order.
- IDs are non-empty and unique within their collection.
- Automatic IDs are deterministic and Project-local (`event-1`, `track-1`,
  first unused suffix). Do not use a module-global counter or add a UUID
  dependency.
- Track/event data must be JSON-compatible and finite where numeric.
- Immutable update helpers are strict and atomic.
- Removing a track removes its events.
- `sequenceProjectToTimeline()` is removed because it is lossy and implies an
  unsupported substitution relationship.

Generic event unions are supported by TypeScript. Runtime domain validation is
provided through an optional callback accepted by validation and Engine
construction. Core validates common structure and JSON compatibility without
adding a schema-library dependency.

Query options include independent global-event control:

```ts
type TimelineQueryOptions = {
  trackIds?: string[];
  includeDisabledTracks?: boolean;
  includeGlobalEvents?: boolean; // default true
  eventTypes?: string[];
};
```

Range queries are strict and half-open. Require
`0 <= fromBeat <= toBeat <= durationBeats`; do not reorder or clamp invalid
ranges.

## 7. TimelineEngine semantics

- Uses `PlaybackTransport` and `TimingMap`.
- Implements playback state and async controls from Playback v2.
- Does not implement `ChannelSource`.
- `seekBeat()` emits no cue events. Consumers use pure queries when they need
  events at a selected position.
- Default delayed-event policy is `"emit"`; optional `"skip"` discards all
  missed cues.
- Explicit seek never invokes the delayed-event policy.
- Loop dispatch repeats events every iteration, including beat-0 events.
- Dispatch includes `iteration`, `scheduledPositionMs`,
  `transportPositionMs`, and `lateByMs`.
- During Project hot-swap, preserve beat position.
- Newly added events at or before the current beat are not emitted
  retroactively; they become eligible on a future loop.
- Natural local end does not stop a shared transport.
- Query and scheduling indexes provide `O(log n + k)` range access. Avoid
  scanning all events for each tick.
- Add a large fixture (target: 100,000 events) to prevent algorithmic
  regression without using unstable wall-clock timing as a CI threshold.

Add `useTimeline()` in `@vixeq/react`. It exposes discrete React state and a
mutable position ref, and it does not connect to `useAnimatedChannels`.

## 8. ArrangementProject v2

```ts
type ArrangementProject = {
  version: 2;
  timing: TimingMap;
  durationBeats: number;
  patterns: Record<string, SequenceProject>;
  sections: ArrangementSection[];
};
```

- Replace the single `bpm` with shared `TimingMap` semantics.
- `durationBeats` is explicit and may include a trailing gap.
- Sections remain non-overlapping and half-open.
- Section beats must fit within Project duration.
- Pattern-local BPM remains ignored; Arrangement timing is authoritative.
- Tempo changes affect beat-to-position conversion without changing section
  or pattern beat placement.
- If a hot-swap shortens duration below current position:
  - non-looping: move to the new end and transition to `ended`;
  - looping: modulo by the new duration and continue.
- Emit only the destination step with `cause: "project-change"`; do not replay
  intermediate steps.

## 9. Migration rules

Strict APIs accept only their current schema versions. Migration is separate
from normalization:

```ts
type MigrationResult<T> =
  | { ok: true; project: T; warnings: MigrationIssue[] }
  | { ok: false; errors: MigrationIssue[] };
```

- `normalize*()` repairs data within one schema version.
- `migrateTimelineProject()` handles Timeline v1 to v2.
- `migrateArrangementProject()` handles Arrangement v1 to v2.
- Migration never silently invents domain meaning.
- If duration cannot be derived safely, require an explicit migration option
  and return `ok: false` when absent.
- Arrangement v1 BPM maps to one tempo event at beat 0.
- Timeline v1 `offsetMs` maps to `startPositionMs` only when valid and
  non-negative.
- Removed Timeline range/value fields produce documented warnings or require
  caller-provided conversion where meaning cannot be preserved.
- CHANGELOG and package READMEs include concrete before/after examples.

## 10. Compatibility and release gates

Supported matrix for 1.0:

- Node.js 22 and 24. Node 20 is EOL and is removed.
- React 18 and 19; peer range `>=18 <20`.
- TypeScript `>=5.5 <6`; test the minimum and workspace versions.
- Chromium, Firefox, and WebKit versions bundled by the locked Playwright
  release. Record exact versions in the support policy.
- ESM and CJS consumers.
- SSR imports without browser globals at module evaluation.

Coverage gates:

- Core branch coverage: at least 90%.
- React branch coverage: at least 85%.
- PlaybackTransport, all three Engines, timing conversion, and migration:
  100% branch coverage.
- Generated declarations, export-only modules, and examples are excluded.
- Coverage does not replace the behavior matrix.

API and package gates:

- Use API Extractor and commit one `.api.md` report per public package.
- CI fails on unreviewed API report differences.
- Use `publint` and Are The Types Wrong on packed packages.
- Test clean ESM/CJS/type/SSR imports and player CSS exports from tarballs.
- Official examples consume packed prerelease packages before stable release.

Browser gates:

- Run actual media transport E2E in Chromium, Firefox, and WebKit.
- Cover play, pause, stop, seek, playback-rate changes, loop, natural end,
  errors, and shared-Engine synchronization.
- Use deterministic fake transports for exact timing assertions.
- Do not use unrealistically tight real-media millisecond tolerances in E2E.

## 11. Official examples and hosting

`website-pulse` is the integration flagship. It shares one audio transport
between:

- Sequencer channel animation;
- Timeline scene/caption cues.

It must demonstrate play, pause, stop, seek, scrub, playback rate, full-show
loop, custom audio loading, reduced motion, and error states.

Other release fixtures:

- Playground: package-stack, import/export, and persistence smoke coverage.
- Cycling workout: non-musical Arrangement editing and playback.
- Arrangement demo: tempo-map and section-boundary coverage as needed.

Pages publishes an index with at least `/playground/`, `/website-pulse/`, and
`/cycling-workout/`.

## 12. Explicit non-goals for 1.0

- Audio generation or synthesis
- MIDI
- DAW-style Timeline editor
- Generic Arrangement/Timeline component in `player-react`
- Tempo ramps
- Reverse playback
- Arbitrary loop ranges
- Standard transport media-range/offset abstraction
- Sequence-to-Timeline semantic conversion
- Runtime dependency in `@vixeq/core`

## 13. Agent collaboration protocol

Codex and Claude must follow these rules when working concurrently:

1. Read this document and the files in the target package before editing.
2. Claim one work item in the task table below before implementation.
3. Do not edit the same files concurrently. Split work by package or by a
   clearly non-overlapping file list.
4. Preserve unrelated and pre-existing uncommitted changes.
5. Put behavioral changes in tests before or with implementation.
6. Update API docs, migration notes, and the API report in the same change as
   the public API modification.
7. Report exact commands run and any checks not run.
8. Do not mark a work item complete until its focused tests, package
   typecheck, and package build pass.
9. Run the full workspace suite at each release integration boundary.
10. If implementation reveals a conflict with this specification, stop that
    work item and record the decision required; do not silently choose a new
    public behavior.
11. Review requests and review results are recorded in git-tracked
    `docs/reviews/<task>-claude.md` files. Before handoff, Codex creates or
    updates the review file with `Status: review_requested`, scope, changed
    files, review focus, commands run, and known expected failures. Claude
    writes findings, re-review notes, and approval status in the same file.
    Chat prompts should only point Claude at the review file, not duplicate
    the full request.

### Task table

Status values: `pending`, `in_progress`, `blocked`, `done`.

| ID | Release | Work item | Depends on | Status | Owner | Primary files |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | 0.7 | Commit Playback v2 behavior matrix and API migration map | — | done | Codex (author), Claude (reviewer) | `docs/behavior/`, `CHANGELOG.md` |
| P1 | 0.7 | Implement `PlaybackTransport` contract and browser/clock transports | P0 | done | Codex (author), Claude (reviewer) | `packages/core/src/` transport files |
| P2 | 0.7 | Rebuild media and AudioBuffer transports | P1 | done | Codex (author), Claude (reviewer) | `packages/core/src/audioClock.ts` or replacement |
| P3 | 0.7 | Refactor `SequencerEngine` to Playback v2 | P1 | done | Codex (author), Claude (author of blocker fixes + reviewer) | `packages/core/src/SequencerEngine.ts` |
| P4 | 0.7 | Refactor `ArrangementEngine` playback shell without schema v2 | P1 | done | Codex (author), Claude (reviewer) | `packages/core/src/arrangement/ArrangementEngine.ts` |
| P5 | 0.7 | Refactor sampling, `ChannelSource`, and Envelopes | P3, P4 | done | Codex (author), Claude (reviewer) | Core types/envelope files |
| P6 | 0.7 | Refactor React hooks and reduced-motion behavior | P3, P4, P5 | done | Codex (author), Claude (reviewer) | `packages/react/src/` |
| P7 | 0.7 | Migrate `player-react` and examples to Playback v2 | P6 | done | Codex (author), Claude (reviewer) | `packages/player-react/`, examples/apps |
| P7F | 0.7 | Address P7 non-blocking review findings before beta smoke | P7 | done | Codex (author), Claude (reviewer) | Player React guard naming, official examples |
| P8 | 0.7 | Add packed beta smoke fixtures and publish checklist | P1–P7F | done | Codex (author), Claude (reviewer) | test fixtures, docs |
| T0 | 0.8 | Commit Timing/Timeline/Arrangement v2 schema specification | P8 | done | Claude (author), Claude (reviewer) | `docs/behavior/`, `docs/migrations/` |
| T1 | 0.8 | Implement `TimingMap` v2 and conversion tests | T0 | done | Claude (author), Claude (reviewer) | `packages/core/src/timeline/timing.ts` |
| T2 | 0.8 | Implement Timeline schema, strict helpers, and migration | T1 | done | Claude (author), Claude (reviewer) | `packages/core/src/timeline/` |
| T3 | 0.8 | Implement indexed `TimelineEngine` | T1, T2 | done | Codex (author), Claude (reviewer, B1/N2 fix author) | new Timeline Engine files |
| T4 | 0.8 | Implement Arrangement v2 and migration | T1 | done | Codex (author), Claude (reviewer, B1 fix author) | `packages/core/src/arrangement/` |
| T5 | 0.8 | Add `useTimeline` and migrate `useArrangement` | T3, T4 | done | Codex (author), Claude (reviewer, B1/B2 fix author) | `packages/react/src/` |
| T6 | 0.8 | Integrate Timeline v2 into `website-pulse` | T3, T5 | done | Codex (author), Claude (reviewer, paperwork for SequencerEngine fix) | `examples/website-pulse/`, `packages/core/src/SequencerEngine.ts` (P3 loop-resume regression fix surfaced by this task) |
| T7 | 0.8 | Add v1-to-v2 migration fixtures and beta smoke tests | T2, T4, T6 | done | Codex (author), Claude (reviewer, N1 fix author) | Core tests, fixtures, docs |
| T8 | 0.8 | Promote 0.8.0 stable release docs and package versions | T7 | done | Codex (author), Claude (reviewer, CHANGELOG fix, npm publish + registry smoke) | package metadata, README/API docs, release docs |
| R0 | 0.9 | Add API Extractor reports and API-diff CI | P8, T7 | pending | — | package configs, `.github/` |
| R1 | 0.9 | Add coverage configuration and behavior-matrix gates | P8, T7 | pending | — | Vitest configs, CI |
| R2 | 0.9 | Add Node/React/TypeScript/package compatibility fixtures | P8, T7 | pending | — | fixtures, CI |
| R3 | 0.9 | Add three-browser media and product E2E | T6 | pending | — | Playwright tests, CI |
| R4 | 0.9 | Build multi-example Pages index and deploy workflow | T6 | pending | — | apps/site or deploy scripts, `.github/` |
| R5 | 0.9 | Finalize support, semver, migration, and release docs | R0–R4 | pending | — | root/package docs |

### Integration order

Within each release, merge the specification/tests before implementation.
Core transport work precedes Engine work; Core Engines precede React; React
precedes GUI/examples. Timeline timing/schema work precedes Timeline and
Arrangement Engines. CI/release gates integrate only after both public API
redesigns have stable beta fixtures.

## 14. Definition of done

A release work item is complete only when:

- approved behavior is covered by focused tests;
- strict invalid-input and recovery paths are tested;
- package typecheck and build pass;
- public API changes update API references and migration notes;
- browser-facing changes are verified in desktop and mobile viewports where
  applicable;
- no unrelated working-tree changes are overwritten;
- the task table records owner and final status;
- the handoff states remaining risks and skipped checks.
