# Timing, Timeline, and Arrangement v2 Behavioral Contract

- Status: Approved for 0.8 implementation
- Target: `0.8.0-beta.1`
- Parent plan: [`../plans/v1-collaboration-spec.md`](../plans/v1-collaboration-spec.md)
  §5 (TimingMap), §6 (TimelineProject), §7 (TimelineEngine), §8 (ArrangementProject),
  §9 (Migration)
- Test contract: [`timeline-arrangement-v2-matrix.md`](timeline-arrangement-v2-matrix.md)
- Migration: [`../migrations/0.8-timeline-arrangement-v2.md`](../migrations/0.8-timeline-arrangement-v2.md)

This document is normative for the 0.8 Timing/Timeline/Arrangement redesign. Public
names, arguments, return types, event payloads, errors, and validation behavior are
frozen for the 0.8 implementation. Private implementation structure is not
prescribed. Playback state, `PlaybackTransport`, and Engine controls are governed by
[`playback-v2.md`](playback-v2.md) and are not restated here except where Timing,
Timeline, or Arrangement add unit-specific behavior. `useTimeline()`'s React
contract (spec §7) is deferred to task T5 and is intentionally not covered by
this document.

## 1. TimingMap v2

```ts
export type TempoEvent = {
  beat: number;
  bpm: number;
};

export type TimingMap = {
  tempos: TempoEvent[];
  startPositionMs: number;
};
```

- `offsetMs` is renamed to `startPositionMs`. No compatibility alias is retained.
- `startPositionMs` is finite and non-negative. It is pre-roll measured from
  transport position 0, never a clock epoch and never negative pre-roll.
- `tempos` must contain at least one entry, and the first entry's `beat` must be
  `0`.
- Tempo beats are finite, non-negative, and strictly increasing; duplicate beats
  are invalid.
- BPM values must satisfy `SEQUENCER_LIMITS.minBpm`/`maxBpm` (`20`–`300`).
- Tempo changes are instantaneous at their beat. Tempo ramps are out of scope for
  1.0.
- `beatToMs(timing, beat)` and `msToBeat(timing, ms)` operate only on
  transport-relative positions built from `startPositionMs` and `tempos`; neither
  accepts or returns a clock-domain timestamp.

```ts
export function createTimingMap(options: CreateTimingMapOptions): TimingMap;
export function validateTimingMap(timing: TimingMap): void; // throws TypeError/RangeError
export function normalizeTimingMap(input: Partial<TimingMap> | CreateTimingMapOptions): TimingMap;
```

- `createTimingMap()` and `normalizeTimingMap()` repair or default within the v2
  schema (for example: inserting a synthesized beat-0 tempo, clamping BPM,
  defaulting `startPositionMs` to `0`). They never throw on malformed input.
- `validateTimingMap()` is strict: it throws `TypeError` for wrong-typed fields and
  `RangeError` for out-of-range or structurally invalid values (missing beat-0
  tempo, non-increasing beats, duplicate beats, out-of-range BPM, negative or
  non-finite `startPositionMs`). It performs no repair.
- Strict Engine and Project construction paths call `validateTimingMap()`, not
  `normalizeTimingMap()`. Import/migration paths call `normalizeTimingMap()` or
  `migrateTimelineProject()`/`migrateArrangementProject()` (§5) explicitly.

## 2. TimelineProject v2

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type TimelineTrack = {
  id: string;
  name: string;
  enabled: boolean;
  data?: JsonObject;
};

export type TimelineEvent<
  TType extends string = string,
  TData extends JsonObject = JsonObject,
> = {
  id: string;
  trackId: string | null;
  beat: number;
  type: TType;
  data?: TData;
};

export type TimelineProject<TEvent extends TimelineEvent = TimelineEvent> = {
  version: 2;
  timing: TimingMap;
  durationBeats: number;
  tracks: TimelineTrack[];
  events: TEvent[];
};
```

- Timeline supports point events only in 1.0. There is no `durationBeats` or
  `value` field on `TimelineEvent`; both are removed from the v1 shape.
- `TimelineTrack.type` is removed. Track identity and semantics are conveyed
  through `id`/`name`/`data`, not a track-level type tag.
- `TimelineEvent.type` is required and non-empty. It replaces the v1 optional
  `type` and the removed per-event `value`/`durationBeats` semantics.
- `trackId: null` represents a global event. The v1 magic string `"global"` is
  removed; `null` is the only global marker.
- A non-null `trackId` must reference an existing `TimelineTrack.id` in the same
  Project. Strict validation rejects a dangling reference.
- `durationBeats` is a top-level Project field: finite and strictly greater than
  `0`.
- Every event's `beat` satisfies `0 <= beat < durationBeats`.
- Events are sorted by `beat`. Events sharing a beat dispatch in array order;
  Timeline does not impose a secondary sort key.
- `TimelineTrack.id` and `TimelineEvent.id` are non-empty strings, unique within
  their own collection (track IDs unique among tracks; event IDs unique among
  events).
- Automatic ID generation (when a caller omits `id`) is deterministic and
  Project-local: `event-1`, `event-2`, ... and `track-1`, `track-2`, ..., using
  the first unused numeric suffix. Implementations must not use a module-global
  counter or introduce a UUID dependency.
- `TimelineTrack.data` and `TimelineEvent.data` must be JSON-compatible
  (`JsonObject`) and any numeric leaf values must be finite.
- Removing a track removes its events. There is no orphaned-event state.
- Immutable update helpers (add/update/remove track or event) are strict: they
  validate their input and throw rather than silently coercing, and a rejected
  update leaves the input Project value untouched (no partial mutation).
- `sequenceProjectToTimeline()` is removed. It encoded a lossy, implied
  substitution relationship between Sequence and Timeline that is not part of the
  v2 contract. There is no direct replacement; callers construct a
  `TimelineProject` explicitly.

### 2.1 Domain validation callback

```ts
export type TimelineEventValidator<TEvent extends TimelineEvent = TimelineEvent> =
  (event: TEvent) => void; // throws to reject a domain-invalid event
```

- Core validates only common structure and JSON compatibility (§2): required
  fields, `trackId` reference integrity, beat range, and `data` JSON
  compatibility. It does not add a schema-library dependency and does not
  validate the domain meaning of a specific `TType`/`TData` combination.
- Callers may pass an optional `TimelineEventValidator` to
  `validateTimelineProject()`/the strict construction helpers and to
  `TimelineEngine` construction options. When provided, it runs once per event
  after Core's structural/JSON checks pass, for every event in the Project.
- The validator throws to reject a domain-invalid event; the thrown error
  propagates from construction/validation exactly like a structural validation
  failure. A validator that does not throw accepts the event.
- Omitting the validator performs no extra domain validation; behavior is
  identical to the Core-only checks in §2.

### 2.2 Query options and range queries

```ts
export type TimelineQueryOptions = {
  trackIds?: string[];
  includeDisabledTracks?: boolean;
  includeGlobalEvents?: boolean; // default true
  eventTypes?: string[];
};
```

- `includeGlobalEvents` defaults to `true`. Setting it to `false` excludes events
  with `trackId: null` independently of `trackIds`/`includeDisabledTracks`, which
  govern only non-null-track events.
- `trackIds`, when present, filters to events whose non-null `trackId` is in the
  list. It has no effect on global events; `includeGlobalEvents` is the only
  global-event control.
- `includeDisabledTracks` defaults to `false`: events on a disabled track are
  excluded unless the option is `true`.
- `eventTypes`, when present, filters to events whose `type` is in the list.

Range queries (`getEventsInBeatRange` and any beat-range helper) are strict and
half-open:

- The caller must supply `0 <= fromBeat <= toBeat <= durationBeats`.
- An invalid range (reversed, out-of-bounds, or non-finite) throws `RangeError`.
  Implementations must not reorder or clamp an invalid range into a valid one.
- The matched set is `[fromBeat, toBeat)`.

## 3. TimelineEngine semantics

`TimelineEngine` uses `PlaybackTransport` and `TimingMap` and implements the
Playback v2 state machine and async controls (`play`/`pause`/`stop`,
`seekPositionMs`) from [`playback-v2.md`](playback-v2.md) §3. It adds:

```ts
TimelineEngine.seekBeat(beat: number): Promise<void>;
```

- `TimelineEngine` does not implement `ChannelSource`. It is a cue scheduler, not
  a continuous channel source; it has no `sampleChannels()`/`sampleChannelsAt()`.
- `seekBeat()` validates synchronously (`0 <= beat <= durationBeats`, finite, or
  throws `RangeError`) and emits no cue events for the seek itself. Consumers that
  need events "as of" a seek position use a pure query (§2.2), not a dispatch
  side effect.
- Dispatch policy for events skipped by natural transport delay is
  `missedCuePolicy`, mirroring Sequence/Arrangement `missedStepPolicy`:
  - default `"emit"`: every event between the previous and current tick position
    dispatches, in beat order, each carrying its own `lateByMs`.
  - optional `"skip"`: only the most advanced due event dispatches; earlier
    missed cues in the same tick are discarded unconditionally (no separate
    lateness threshold — mirrors `ArrangementEngine`'s `missedStepPolicy:
    "skip"`, which resolves and emits only the current position).
- Explicit seek (`seekBeat`, `seekPositionMs`) never invokes `missedCuePolicy`;
  it always emits zero cue events for the traversed range.
- Loop dispatch repeats every event on every iteration, including any event at
  beat `0`. A looping `TimelineEngine` does not deduplicate the boundary event
  across iterations.
- Dispatch events (delivered on the `"cue"` event channel) include:

```ts
export type TimelineCueEvent<TEvent extends TimelineEvent = TimelineEvent> = {
  event: TEvent;
  iteration: number;
  scheduledPositionMs: number;
  transportPositionMs: number;
  lateByMs: number;
};
```

- During Project hot-swap (`setProject()`), the current beat position is
  preserved; hot-swap never seeks the transport.
- Events newly added at or before the current beat by a hot-swap are not emitted
  retroactively. They become eligible only on a future pass through that beat
  (natural playback past it again, or a loop iteration).
- A `TimelineEngine` reaching its local end (non-looping, `beat >= durationBeats`)
  transitions to local `ended` and does not stop a shared transport, matching the
  Playback v2 local-end rule.
- Query and scheduling indexes provide `O(log n + k)` range access for a lookup of
  `k` matching events out of `n` total events. Per-tick dispatch must not scan all
  events. A large fixture (target: 100,000 events) is required to guard this
  without depending on unstable wall-clock CI thresholds; the fixture asserts
  algorithmic behavior (bounded index probes, not scan count) rather than timing.

## 4. ArrangementProject v2

```ts
export type ArrangementProject = {
  version: 2;
  timing: TimingMap;
  durationBeats: number;
  patterns: Record<string, SequenceProject>;
  sections: ArrangementSection[];
};
```

- The single `bpm: number` field is removed. Arrangement timing is a shared
  `TimingMap` (§1), giving Arrangement the same tempo-map capability as Timeline.
- `durationBeats` is an explicit, required, finite, positive Project field. It may
  exceed the last section's `endBeat`, leaving a trailing gap that outputs `0` on
  every channel, exactly as an inter-section gap does today.
- Sections remain non-overlapping and half-open (`[startBeat, endBeat)`), as in
  v1.
- Every section's beats must fit within `[0, durationBeats]`
  (`0 <= startBeat < endBeat <= durationBeats`).
- Pattern-local `bpm` on a `SequenceProject` used as an Arrangement pattern
  continues to be ignored during Arrangement playback; the Arrangement's
  `TimingMap` is authoritative for beat-to-position conversion.
- A tempo change inside the Arrangement's `TimingMap` affects beat-to-position
  conversion only. It never changes section or pattern beat placement.
- Hot-swap duration handling matches the Sequence/Arrangement Playback v2 rule
  (`playback-v2.md` §3.3):
  - non-looping: if the new `durationBeats` is below the current beat position,
    move to the new end and transition to local `ended`;
  - looping: modulo the current beat position into the new `durationBeats` and
    continue playback.
- A forced reposition from hot-swap emits exactly one destination step with
  `cause: "project-change"`. Intermediate steps between the old and new position
  are never replayed.

## 5. Migration rules

```ts
export type MigrationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type MigrationResult<T> =
  | { ok: true; project: T; warnings: MigrationIssue[] }
  | { ok: false; errors: MigrationIssue[] };
```

- `normalize*()` (for example `normalizeTimingMap()`, a future
  `normalizeTimelineProject()`/`normalizeArrangementProject()`) repairs data
  within a single schema version. It never changes `version`.
- `migrateTimelineProject(project: TimelineProject_v1, options?): MigrationResult<TimelineProject>`
  and `migrateArrangementProject(project: ArrangementProject_v1, options?): MigrationResult<ArrangementProject>`
  convert v1 to v2. They are distinct entry points from normalization and are
  never invoked implicitly by Engine or Project construction.
- Migration never silently invents domain meaning. Where v1 data does not
  determine a required v2 value, migration requires an explicit caller-supplied
  option and returns `{ ok: false, errors: [...] }` when that option is absent.
- `TimelineProject_v1.timing.offsetMs` maps to `startPositionMs` only when it is a
  valid, non-negative finite number; otherwise migration records an error rather
  than defaulting silently to `0`.
- `ArrangementProject_v1.bpm` maps to a single `TempoEvent` at `beat: 0` with that
  BPM value only when it is a finite number within
  `SEQUENCER_LIMITS.minBpm`/`maxBpm`; otherwise migration records an error
  rather than silently clamping it (consistent with `startPositionMs`'s
  invalid-`offsetMs` handling above — migration rejects rather than repairs
  an out-of-range numeric v1 field with no caller-supplied conversion
  option). `normalizeTempoEvent`'s clamping behavior remains correct for its
  own use — repairing already-v2-shaped data within one schema version — but
  does not apply at the migration boundary.
- `ArrangementProject_v1` has no `durationBeats`. Migration requires an explicit
  option to supply it (for example, derived from section extents plus a caller
  margin, or an explicit value); it does not infer a value on the caller's behalf
  by default. Absent that option, migration returns `ok: false`.
- Removed Timeline fields (`TimelineEvent.durationBeats`, `TimelineEvent.value`,
  `TimelineTrack.type`) produce a `MigrationIssue` warning per affected
  event/track when migration succeeds, or block migration with an error when the
  removed field's meaning cannot be preserved without caller-provided conversion
  (for example, a caller wants `value` folded into `data` under a specific key —
  migration does not choose that key on its own).
- The v1 magic `trackId: "global"` maps to `trackId: null` during migration; this
  is a safe, meaning-preserving rename and never produces a warning.
- CHANGELOG and package README updates that ship with T1–T5 implementation must
  include concrete before/after examples for each renamed or removed field,
  matching the pattern in
  [`../migrations/0.7-playback-v2.md`](../migrations/0.7-playback-v2.md).
