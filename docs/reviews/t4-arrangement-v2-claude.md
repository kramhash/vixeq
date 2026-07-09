# T4 Arrangement v2 Review

- Status: approved
- Task: T4 — Implement Arrangement v2 and migration
- Author: Codex
- Reviewer: Claude
- Normative contract: [`../behavior/timeline-arrangement-v2.md`](../behavior/timeline-arrangement-v2.md) §4, §5 (Arrangement portion)
- Matrix: [`../behavior/timeline-arrangement-v2-matrix.md`](../behavior/timeline-arrangement-v2-matrix.md) (`AR-001`..`011`, `MIG-006`..`008`)

## Scope

Implements ArrangementProject v2 in `@vixeq/core`:

- public Arrangement schema moves to `version: 2`
- `timing: TimingMap` and explicit `durationBeats`
- v2-only create/normalize/validate behavior
- explicit `migrateArrangementProject()` for v1 input
- `ArrangementEngine` uses `beatToMs()` / `msToBeat()` for variable tempo
- arrangement tests and migration docs/matrix updates

## Changed Files

- `docs/plans/v1-collaboration-spec.md`
- `docs/behavior/timeline-arrangement-v2-matrix.md`
- `docs/migrations/0.8-timeline-arrangement-v2.md`
- `docs/reviews/t4-arrangement-v2-claude.md`
- `packages/core/src/index.ts`
- `packages/core/src/arrangement/ArrangementEngine.ts`
- `packages/core/src/arrangement/ArrangementEngine.test.ts`
- `packages/core/src/arrangement/index.ts`
- `packages/core/src/arrangement/migration.ts`
- `packages/core/src/arrangement/migration.test.ts`
- `packages/core/src/arrangement/project.ts`
- `packages/core/src/arrangement/project.test.ts`
- `packages/core/src/arrangement/resolve.ts`
- `packages/core/src/arrangement/resolve.test.ts`
- `packages/core/src/arrangement/types.ts`

## Review Focus

- Confirm strict APIs do not implicitly migrate v1 `bpm`.
- Confirm `migrateArrangementProject()` should reject invalid v1 BPM instead of clamping.
- Confirm variable-tempo `ArrangementEngine` scheduling uses the correct scheduled positions and step durations.
- Confirm hot-swap preserves fractional beat when timing changes.
- Confirm `durationBeats` explicit trailing gaps and section bounds match spec §8.
- Confirm root exports are sufficient and do not overexpose migration internals.

## Commands Run

- `pnpm --filter @vixeq/core test -- src/arrangement/project.test.ts src/arrangement/migration.test.ts src/arrangement/resolve.test.ts src/arrangement/ArrangementEngine.test.ts`
- `pnpm --filter @vixeq/core test`
- `pnpm --filter @vixeq/core typecheck`
- `pnpm --filter @vixeq/core build`

## Known Failures

None in `@vixeq/core`.

T5 will update React hooks and any React-side Arrangement v1 assumptions.

---

## Review checklist

- [x] Strict `validateArrangement`/`normalizeArrangement`/`createArrangement` never call
      `migrateArrangementProject()` and reject a `bpm` field outright rather than
      converting it. Confirmed by reading `project.ts:38-40` (`input.bpm !== undefined` is
      itself the error — `AR-002`) and by `grep -n "migrateArrangementProject"
      packages/core/src/arrangement/project.ts packages/core/src/arrangement/ArrangementEngine.ts`
      returning no matches — the only caller of `migrateArrangementProject` anywhere in
      `packages/core/src` is `migration.test.ts`. Matches the `MIG-010` precedent
      established in T2.
- [x] `migrateArrangementProject()`'s invalid-v1-BPM behavior investigated in full — see
      the dedicated **Decision required** section below (not scored against this
      verdict, per the task's instruction).
- [x] `ArrangementEngine` schedules exclusively through `beatToMs()`/`msToBeat()`; no
      `60000/bpm`-style literal arithmetic anywhere in the file (`grep -n "60000" packages/core/src/arrangement/ArrangementEngine.ts`
      returns nothing). Pattern-local `bpm` is never read by the Engine (`grep -n "\.bpm"
      packages/core/src/arrangement/ArrangementEngine.ts` returns nothing outside
      `getBpmAtBeat`'s own `arrangement.timing.tempos[...].bpm`) — only
      `pattern.stepsPerBeat`/`pattern.stepCount`/`pattern.tracks` are read from a
      `SequenceProject` pattern. Confirmed live with a genuinely variable-tempo fixture:
      `AR-007 AR-008` (`ArrangementEngine.test.ts:173-200`) builds a pattern with
      `bpm: 999` inside a two-tempo `TimingMap` (`60` at beat 0, `120` at beat 1) and
      asserts the dispatched steps' `scheduledPositionMs`/`bpm` fields
      (`"0:0:60", "1:1000:120", "2:1500:120"`) come from the Arrangement's `TimingMap`,
      not the pattern's `999`.
- [x] Step `durationMs` (`emitStepResolution`, `ArrangementEngine.ts:673-688`) is computed
      as `beatToMs(nextStepBeat) - resolved.scheduledPositionMs`, i.e. an actual ms delta
      through the tempo map for that specific interval, not a fixed-BPM constant — so a
      step's wall-clock length changes across a tempo boundary even though its beat width
      (`1 / stepsPerBeat`) does not. Not separately asserted on `event.durationMs` by any
      test (see N4 below), but the code path is shared with the already-verified
      `scheduledPositionMs`/`bpm` fields, and `beatToMs` itself is T1-approved.
- [x] `seekBeat`/`seekPositionMs` both round-trip exclusively through
      `beatToMs(this.arrangement.timing, ...)` (`ArrangementEngine.ts:243`, no separate
      arithmetic) and validate synchronously before touching the transport
      (`ArrangementEngine.ts:239-241`, `250-252`), confirmed by the synchronous
      `toThrow(RangeError)` assertions in `PB-EN-005` and the `seekPositionMs` test.
- [x] Hot-swap (`setArrangement`) preserves the fractional beat and re-anchors it through
      the *new* project's `TimingMap`: `previousBeat = msToBeat(previousArrangement.timing,
      previousPositionMs)` → `nextPositionMs = beatToMs(arrangement.timing, nextBeat)`
      (`ArrangementEngine.ts:316-330`), so a tempo change during hot-swap correctly
      re-derives the ms position for the same beat rather than reusing the old ms value.
      Confirmed by `PB-EN-011 PB-EN-025` (`ArrangementEngine.test.ts:276-297`): swapping
      from 120 BPM to 60 BPM at beat 1.5 keeps `beat: 1.5` but the transport stays at the
      already-elapsed `1500ms` (the anchor captures the *current* transport ms, not a
      recomputed one, which is correct — only the *Engine's own* subsequent position
      readback is what gets remapped through the new tempo, and no transport `seek*` call
      is ever made, matching `TL-EN-009`'s sibling requirement).
- [x] `durationBeats` trailing gap: `sectionAtBeat`/`resolveArrangementStep` return `null`
      for any beat with no covering section (`resolve.ts:31-45`, `56-79`), regardless of
      whether that beat is before `durationBeats` (a true trailing gap) or beyond it — the
      Engine's lifecycle logic (`isAtOrPastLocalEnd`, `getDurationMs`) is what
      distinguishes "still playing, outputting zero" from "ended," and it always uses
      `durationBeats`, never the last section's `endBeat`. `AR-004`
      (`resolve.test.ts:41-46`) explicitly builds a `durationBeats: 16` arrangement whose
      last section ends at beat 12 and confirms `sectionAtBeat(arrangement, 13)` is `null`
      (i.e., beat 13 is a valid, playable trailing-gap position, not out of range). See N3
      below for a coverage gap: no test drives the *Engine* through a genuine trailing gap
      end-to-end (play, observe zeroed channels, confirm it does not end early at the last
      section's `endBeat`).
- [x] Section bounds (`AR-005`) and non-overlap (`AR-006`) are enforced exactly as spec'd:
      `startBeat < 0` and `endBeat <= startBeat` both reject (`project.ts:109-119`);
      `endBeat > durationBeats` rejects (`project.ts:120-125`, using the strict `<=` the
      spec calls for); overlap is detected via a beat-sorted adjacency scan requiring
      `next.startBeat < previous.endBeat` (`project.ts:133-141`), which is a half-open
      check — two sections sharing an exact boundary (`endBeat === startBeat` of the next)
      do **not** trigger an overlap error, matching v1 and the spec's explicit "half-open"
      requirement. Confirmed against `AR-005`/`AR-006` (`project.test.ts:75-104`).
- [x] Hot-swap duration-shrink branching (`AR-009`/`010`) matches the Playback v2 §3.3
      rule exactly: non-looping uses `Math.max(0, Math.min(beat, durationBeats))`
      (`normalizeBeatForArrangement`, `ArrangementEngine.ts:811-817`), landing exactly at
      the new end, and `applyTransportSnapshot`'s `isAtOrPastLocalEnd` check
      (using the *new* arrangement's `getDurationMs()`, since `this.arrangement` is
      reassigned before the snapshot is re-applied) then flips `playbackState` to
      `"ended"`; looping uses `((beat % durationBeats) + durationBeats) % durationBeats`
      and playback continues. Confirmed by `PB-EN-014`/`PB-EN-015`
      (`ArrangementEngine.test.ts:299-333`): a 6-beat arrangement parked at beat 5,
      hot-swapped to `durationBeats: 2` — non-looping ends at `beat: 2`; looping lands at
      `beat: 1` (`5 % 2 === 1`) and stays `"playing"`.
- [x] Forced-reposition step emission (`AR-011`) is structurally correct by inspection —
      `setArrangement` computes the old and new step keys and calls
      `emitStepForPosition(this.cachedPositionMs, "project-change")` **at most once**,
      with no loop over any intermediate step range (`ArrangementEngine.ts:345-347`),
      unlike `tick()`'s `emitDueSteps`/`getDueStepResolutions`, which *does* enumerate a
      range for natural playback. So there is no code path by which a hot-swap could
      replay intermediate steps. However, **no test asserts this behavior directly** — see
      N2 below; this is a coverage gap in the matrix's `covered` claim, not a code defect.
- [x] Public exports (`arrangement/index.ts`, `packages/core/src/index.ts`): all five
      required entry points are present (`createArrangement`, `validateArrangement`,
      `normalizeArrangement`, `migrateArrangementProject`, `ArrangementEngine`), plus the
      pure resolve helpers and every documented type. No internal migration helper
      (`isValidBpm`, `validateV1Arrangement`, `isRecord`, `isFinitePositive`) is exported —
      `grep -n "^export"  packages/core/src/arrangement/migration.ts` shows only
      `migrateArrangementProject` itself. `ArrangementProjectV1` (the v1 input type) *is*
      exported from both index files, but this exactly mirrors T2's already-approved
      precedent of exporting `TimelineProjectV1` as the documented parameter type of
      `migrateTimelineProject` (`packages/core/src/timeline/index.ts:27`) — not a new
      surface-area problem. No lower-level v1 helper types (there are none needed here,
      since `ArrangementProjectV1` is flat) leak out, unlike Timeline's internal
      `TempoEventV1`/`TimingMapV1`/etc., which also stay unexported. Confirmed no stray v1
      `ArrangementProject` (the old `bpm: number` top-level shape) is exported under any
      other name.
- [x] Update-helper/validation pattern consistency with T2/T3: `ValidationResult`-returning
      `validateArrangement` (never throws), a throwing `assertValidArrangement` used only
      inside the Engine's constructor/`setArrangement` (matching T2's
      `assertValidTimelineProject` split), `MigrationIssue`/`MigrationResult<T>` reused
      from `../types` rather than redefined (`migration.ts:4`, `types.ts:1-9`), and no
      duplicated section/pattern validation logic between `validateArrangement` and
      `migration.ts`'s `validateV1Arrangement` (the latter is a distinct v1-shape check,
      structurally parallel but operating on the v1 field set, which is expected — it
      can't reuse `validateArrangement` since the input isn't v2 shaped yet).
- [x] No T3/T5/T6 scope leaked into the changed-files list: `git diff HEAD --stat` (see
      below) touches only `packages/core/src/arrangement/*`, `packages/core/src/index.ts`,
      and the docs bookkeeping files already listed; no `packages/react/`,
      `packages/player-react/`, `examples/website-pulse/`, or `timeline/TimelineEngine*`
      file is present.
- [x] Independently re-ran every requested command — **all four are green for
      `@vixeq/core` itself, but the full-workspace `pnpm typecheck` is red** — see B1
      below and Verification method.

## Verification method

Read spec §8/§9 (parent plan) and the frozen contract §4/§5
(`timeline-arrangement-v2.md`) line-by-line, then read every changed/new file
(`types.ts`, `project.ts`, `resolve.ts`, `migration.ts`, `ArrangementEngine.ts`,
`index.ts`, and all four test files) end to end, comparing each spec bullet and
each `AR-*`/`MIG-00[678]` row against the corresponding code path and test.
Cross-checked `ArrangementEngine`'s hot-swap/loop/end-of-timeline logic against
the already-approved `TimelineEngine` (T3) and the pre-existing (pre-v2, already
approved in P4) `ArrangementEngine` control-flow shell, since T4 only changed the
schema/timing layer underneath an already-reviewed Playback v2 shell — confirmed
the diff (`git diff HEAD -- packages/core/src/arrangement/ArrangementEngine.ts`)
touches only the timing/duration-related lines (`beatToMs`/`msToBeat` calls,
`getDurationBeats`/`getDurationMs`, `normalizeBeatForArrangement`), not the
transport-command/event-dispatch plumbing that P4 already established.

**On the invalid-v1-BPM question:** see the dedicated Decision required section
below — this required reading `docs/behavior/timeline-arrangement-v2.md:300-302`,
`packages/core/src/timeline/timing.ts:15-21` (`normalizeTempoEvent`), and
`packages/core/src/timeline/migration.ts:89-124` (`migrateTimelineProject`'s
`offsetMs` handling, the closest existing precedent) side by side with
`packages/core/src/arrangement/migration.ts:20-24, 40-46` and the test at
`migration.test.ts:49-54`.

**On the full-workspace typecheck failure (B1):** ran `pnpm typecheck` (fails),
then `pnpm -r --no-bail typecheck` to see every project's result without an
early stop:

```
Summary: 3 fails, 7 passes
examples/cycling-workout: TS2339 (arrangement.bpm), TS2322 (version 1 not assignable to 2)
packages/react:            TS2353/TS2339 (bpm) in useArrangement.test.tsx
examples/arrangement-demo: TS2353/TS2339 (bpm) in src/arrangement.ts
```

Checked each failing package's dependency on `@vixeq/react` to determine which
failures the author's "T5 will update React hooks and any React-side Arrangement
v1 assumptions" note actually covers:

- `packages/react` (fails in its own test file) and `examples/arrangement-demo`
  (`grep -n "@vixeq/react\|useArrangement" examples/arrangement-demo/src/App.tsx`
  confirms it imports `useArrangement` from `@vixeq/react`) are both genuinely
  "React-side," so this is expected, disclosed fallout — T5 (`useArrangement`
  migration) depends on T4 per the task table, and hasn't started.
- `examples/cycling-workout` (`grep -n "@vixeq/react" examples/cycling-workout/package.json`
  — no match; it depends only on `@vixeq/core`) is **not** React-side. It builds
  a literal v1-shaped object (`{ version: 1, bpm: 60, patterns, sections }` in
  `examples/cycling-workout/src/workout.ts:82`) typed as `ArrangementProject`,
  which the v2 schema change breaks. This is a real, reproducible regression the
  "Known Failures" section does not cover under any existing or disclosed
  explanation, and no task in `v1-collaboration-spec.md`'s task table
  (T4–T7, or the completed P7) currently claims ownership of migrating it.

Independently re-ran every requested command:

- `pnpm --filter @vixeq/core test` — 19 files, **269 tests passed**, no failures.
- `pnpm --filter @vixeq/core typecheck` — clean, no output.
- `pnpm --filter @vixeq/core build` — ESM/CJS/DTS all succeeded.
- `pnpm typecheck` (full workspace) — **fails**; `examples/cycling-workout`,
  `packages/react`, `examples/arrangement-demo` all error (see B1).
- `git diff HEAD --stat` — confirmed the touched-file set matches the "Changed
  Files" section (plus the new, untracked `migration.ts`/`migration.test.ts`),
  with no `packages/react/`, `packages/player-react/`, or `timeline/` file
  present.

## Findings

### B1 (blocking) — full-workspace `pnpm typecheck` is red; `examples/cycling-workout` is an undisclosed, unowned regression

**File:** `examples/cycling-workout/src/workout.ts:82`, `examples/cycling-workout/src/workout.test.ts:15`.

This is not a defect in any of T4's reviewed source files — `packages/core/src/arrangement/*`
is correct per spec, and removing the v1 `bpm`/`version: 1` shape is exactly what
§4/§5 require. The problem is that `examples/cycling-workout` still constructs
`ArrangementProject` literally as `{ version: 1, bpm: 60, patterns, sections }`
and reads `arrangement.bpm` in its test, both of which the v2 type now rejects at
compile time (`TS2322`: `1` not assignable to `2`; `TS2339`: `bpm` does not exist).

Unlike `packages/react` and `examples/arrangement-demo` — both of which fail for
the same root cause but are legitimately covered by the review request's "T5 will
update React hooks and any React-side Arrangement v1 assumptions" disclosure,
since both depend on `@vixeq/react`'s `useArrangement` — `examples/cycling-workout`
depends only on `@vixeq/core` (confirmed via its `package.json`) and has no
relationship to T5's React scope. No task row in `docs/plans/v1-collaboration-spec.md`
(§13's task table: T4, T5, T6, T7, or the already-`done` P7) currently claims
responsibility for migrating it, and the review request's "Known Failures: None
in `@vixeq/core`" line, while narrowly true, does not surface that the full
workspace no longer typechecks as a result of this change, which several prior
tasks (T1, T2, T3) treated as a standard part of their own verification and
reported as clean.

**Failure scenario:** Anyone running `pnpm typecheck` (or `pnpm build` across the
whole workspace, or CI wired to the full workspace) after this change lands sees
two compile errors in a shipped example that was passing before T4, with no
in-flight task that will fix it.

**Not a proposed fix, per the task's instructions — options for the user to
choose between:** (a) fold a small `workoutToArrangement` v2 update into T4 itself
(it is a small, mechanical change: `version: 2`, `timing: createTimingMap({ bpm:
60 })`, an explicit `durationBeats`), (b) explicitly assign it to an existing task
(e.g. widen T7's "Core tests, fixtures, docs" scope, since T7 already depends on
T4) or a new task row, or (c) at minimum, amend this review request's "Known
Failures" section to disclose it explicitly and get the user's sign-off that it's
acceptable debt until some later task closes it. Whichever path is chosen, this
should be resolved (or explicitly, visibly deferred) before T4 is marked `done`,
since "the full workspace typechecks" has been true at every prior 0.8 task
boundary.

### N1 (non-blocking) — `docs/api/core.md`'s Arrangement section was not updated for the v2 public API change

**File:** `docs/api/core.md:16`.

Per spec §13.6 ("Update API docs, migration notes, and the API report in the same
change as the public API modification"), and per T2's own precedent (which did
update `docs/api/core.md` for the Timeline v2 change, including a `(0.8, v2)` tag
and a description of `migrateTimelineProject`), the Arrangement section of this
same file should have received an equivalent update. It did not — `git diff HEAD
-- docs/api/core.md` is empty for this change. Concretely, line 16 still reads:

> `createArrangement(options?)` — creates an `ArrangementProject` with one BPM, a
> pattern map, and non-overlapping sections.

This is stale for v2: there is no top-level "one BPM" anymore (`timing` is a full
`TimingMap`, which may carry multiple tempo events), `durationBeats` (required,
explicit, trailing-gap-capable) is not mentioned at all, and `migrateArrangementProject()`
— a new, documented-in-the-migration-guide public function — has no line in this
file, unlike `migrateTimelineProject` which does (line 30). `docs/migrations/0.8-timeline-arrangement-v2.md`
itself is thorough and correct (this is not a spec-comprehension problem, just an
omitted file in this change's edits).

**Failure scenario:** none at runtime — this is a documentation-accuracy gap. A
reader of `docs/api/core.md` alone (without also finding the migration guide)
would not learn that `bpm` was removed, that `durationBeats` exists, or that
`migrateArrangementProject()` exists.

**Fix (not applied by this review):** add an Arrangement equivalent of the
Timeline `(0.8, v2)` paragraph — mention `timing: TimingMap` replacing `bpm`,
`durationBeats` (required, trailing-gap semantics), and `migrateArrangementProject(v1Project,
options)` with its required `durationBeats` option — mirroring `core.md:29-30`'s
level of detail.

### N2 (non-blocking) — `AR-011` marked `covered` in the matrix without a test that discriminates it from other hot-swap behavior

**File:** `docs/behavior/timeline-arrangement-v2-matrix.md` (`AR-011` row);
`packages/core/src/arrangement/ArrangementEngine.test.ts`.

`AR-011`'s expected result is specific: "hot-swap forced reposition → exactly one
destination step with cause project-change." The three `setArrangement` tests
that exist (`PB-EN-011 PB-EN-025`, `PB-EN-014`, `PB-EN-015`,
`ArrangementEngine.test.ts:276-333`) all assert on `getPosition()`/`getPlaybackState()`/
the `"project"` event, but **none of them subscribes to the `"step"` event at
all**, so none can distinguish "the engine correctly emits exactly one step with
`cause: "project-change"`" from "the engine emits zero steps," "the engine emits
the right step but tagged `cause: "tick"`," or (hypothetically, if a future edit
introduced a loop) "the engine replays every intermediate step." The behavior is
correct by direct code inspection (see the Review checklist above — there is
structurally no loop that could replay intermediate steps), but the matrix's
`covered` status for this specific row is not backed by an assertion that would
actually fail if that guarantee regressed.

**Failure scenario:** a future refactor of `setArrangement`'s step-emission logic
that accidentally reintroduces a `getDueStepResolutions`-style intermediate-step
loop (mirroring `tick()`'s natural-playback path) would pass every existing test
in this file while violating `AR-011`.

**Fix (not applied by this review):** add a `"step"` listener to one of the
existing hot-swap tests (or a new one) that jumps the beat position by more than
one step during the swap, and asserts the emitted `steps` array is exactly one
entry with `cause: "project-change"` at the destination step index — not the
intermediate ones.

### N3 (non-blocking) — no Engine-level test drives playback through a genuine trailing gap end-to-end

**File:** `packages/core/src/arrangement/ArrangementEngine.test.ts`;
`packages/core/src/arrangement/resolve.test.ts`.

`AR-004`'s dedicated test (`resolve.test.ts:41-46`) only checks the pure
`sectionAtBeat` helper returns `null` at a trailing-gap beat; the generic
"outputs 0 for every track in a gap" test in the same file exercises an
*inter-section* gap, not a *trailing* one (past the last section, before
`durationBeats`). No test plays the `ArrangementEngine` through a trailing gap
and confirms (a) it keeps `playbackState: "playing"` (not `"ended"`) throughout
the gap, and (b) `step`/`sampleChannels()` output stays zeroed, until it reaches
the actual `durationBeats` boundary. This is a real combination the spec calls
out explicitly ("may exceed the last section's endBeat, leaving a trailing gap"),
and the two pieces of behavior it requires (extended playback lifetime + zeroed
output) are each tested only in isolation (playback lifetime via the ordinary
non-gap `PB-EN-016` end test; zeroed output via the pure `resolve.ts` helpers).
Not a suspected code defect — `isAtOrPastLocalEnd`/`getDurationMs` already
correctly use `durationBeats`, not the last section's `endBeat` — just a coverage
gap.

### N4 (minor, non-blocking) — no test asserts a `StepEvent.durationMs` value across a tempo boundary

**File:** `packages/core/src/arrangement/ArrangementEngine.ts:673-688`;
`ArrangementEngine.test.ts:173-200` (`AR-007 AR-008`).

The existing variable-tempo test asserts `scheduledPositionMs` and `bpm` per
step, which is enough to confirm beat→ms scheduling is tempo-aware, but nothing
asserts `event.durationMs` itself changes across the tempo boundary (it should:
a step before the beat-1 tempo change at 60 BPM is 1000ms long; a step after, at
120 BPM, is 500ms long). The code path computing `durationMs` is a straight-line
extension of the already-verified `beatToMs` calls, so this is a low-risk gap,
but it is the one field in `StepEvent` that most directly encodes "does step
length actually respond to a tempo change," and it currently has zero direct
assertions anywhere in the suite.

### N5 (minor, non-blocking) — `migrateArrangementProject(input: unknown, ...)` diverges from T2's typed-parameter precedent

**File:** `packages/core/src/arrangement/migration.ts:159-161` vs.
`packages/core/src/timeline/migration.ts:97-100`.

T0's frozen signature (`timeline-arrangement-v2.md:291`) shows
`migrateArrangementProject(project: ArrangementProject_v1, options?)`, and T2's
`migrateTimelineProject` implements that literally (`project: TimelineProjectV1`).
T4 instead types its first parameter as `unknown` and does full structural
validation at runtime (`validateV1Arrangement`). This is arguably *more*
defensive — a real caller passing genuinely untrusted/dynamic data (the exact
scenario a migration function exists for) gets full runtime validation either
way, and TypeScript's structural typing means a `ArrangementProjectV1`-typed
parameter provides no actual runtime protection against malformed input — but it
is an unannounced, unexplained deviation from both T0's literal signature and the
established T2 sibling-function precedent. Purely a signature-style
inconsistency; no behavioral gap (the runtime validation is present and correct
either way). Not worth blocking on; worth a one-line note in a future pass if the
two migration functions' signatures are meant to stay symmetric.

## Decision required (non-blocking to this verdict) — `migrateArrangementProject()` rejects, rather than clamps, an invalid v1 `bpm`

Recorded separately per the task's explicit instruction, mirroring how T3's
"cue" vs. "event" terminology question was recorded: this is a real,
confirmed divergence between T0's literal wording and the implementation, but it
does not affect the verdict above (B1 is the only issue changing this review's
status).

**What T0 says, quoted exactly** (`docs/behavior/timeline-arrangement-v2.md:300-302`):

> "`ArrangementProject_v1.bpm` maps to a single `TempoEvent` at `beat: 0` with
> that BPM value (clamped/validated the same way `normalizeTempoEvent` already
> behaves in v1)."

**What `normalizeTempoEvent` actually does** (`packages/core/src/timeline/timing.ts:15-21`,
T1-approved, unmodified by T4):

```ts
export const normalizeTempoEvent = (tempo: Partial<TempoEvent>, fallbackBeat = 0): TempoEvent => ({
  beat: ...,
  bpm: clamp(
    Number.isFinite(tempo.bpm) ? Number(tempo.bpm) : SEQUENCER_LIMITS.defaultBpm,
    SEQUENCER_LIMITS.minBpm,
    SEQUENCER_LIMITS.maxBpm,
  ),
});
```

This **clamps** an out-of-range or non-finite `bpm` into `[20, 300]` (or defaults
to `120` if non-finite) — it never rejects. Read literally, T0's parenthetical
says `migrateArrangementProject` should behave "the same way," i.e. clamp.

**What the implementation actually does** (`packages/core/src/arrangement/migration.ts:20-24, 40-46`):

```ts
const isValidBpm = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= SEQUENCER_LIMITS.minBpm &&
  value <= SEQUENCER_LIMITS.maxBpm;
// ...
if (!isValidBpm(input.bpm)) {
  errors.push({ code: "ARRANGEMENT_BPM", message: `Arrangement bpm must be a finite number between ${SEQUENCER_LIMITS.minBpm} and ${SEQUENCER_LIMITS.maxBpm}.`, path: "bpm" });
}
```

An out-of-range or non-finite `bpm` makes `validateV1Arrangement` fail, which
makes `migrateArrangementProject` return `{ ok: false, errors: [...] }` —
`normalizeTempoEvent`/`clamp` is never called on the v1 `bpm` value anywhere in
`migration.ts`. This is **reject**, not clamp, and it is deliberate: the author
added a test explicitly titled `"rejects invalid v1 bpm instead of clamping at
the migration boundary"` (`migration.test.ts:49-54`), and the review request's
own "Review Focus" section asked the reviewer to "confirm `migrateArrangementProject()`
should reject invalid v1 BPM instead of clamping" — i.e., the author knew the two
readings diverge and asked for a second opinion rather than silently picking one.
`docs/migrations/0.8-timeline-arrangement-v2.md:235-237` documents the reject
behavior in the migration guide's prose ("It returns `ok:false` for an invalid v1
`bpm`...").

**Comparison to `migrateTimelineProject`'s precedent for an analogous numeric
field** (`packages/core/src/timeline/migration.ts:112-120`, T2-approved): v1
`timing.offsetMs` maps to `startPositionMs` "only when it is a valid, non-negative
finite number; otherwise migration records an error rather than defaulting
silently to `0`" (T0 §5, `timeline-arrangement-v2.md:297-299`, implemented
exactly that way and explicitly reviewed/approved in T2). That is also a
**reject**, not a silent-default/clamp, for a numeric v1 field with no
caller-supplied conversion option. So within the *migration* functions
specifically, the established pattern for "a v1 numeric field is present but out
of the value's valid range, and there's no caller-supplied way to resolve it" is
reject-with-`MigrationIssue`, not silent repair — Arrangement's `bpm` handling is
internally consistent with that pattern. The tension is specifically between this
pattern and T0 §5's own `bpm`-specific parenthetical, which points at
`normalizeTempoEvent`'s *different* (clamp) precedent instead.

**Two ways to read this, without picking one:**

1. **Unannounced spec deviation.** T0 §5 gives an explicit, unambiguous
   instruction ("clamped/validated the same way `normalizeTempoEvent` already
   behaves") and the implementation does something else. Per §13.10, discovering
   a conflict with the specification should stop the work item and record that a
   decision is required — which the review request's phrasing ("confirm ... should
   reject ... instead of clamping") arguably already does, but T0 itself was never
   updated to match (unlike T3's cue/event case, where the user has since updated
   T0 to match the implementation).
2. **A defensible correction the spec's own wording invites.** `normalizeTempoEvent`
   is a *repair* function by name and by every other use site (`normalize*()` "repairs
   data within one schema version," per spec §9/§5) — migration is explicitly a
   different, stricter concern ("Migration never silently invents domain meaning.
   Where v1 data does not determine a required v2 value, migration requires an
   explicit caller-supplied option and returns `ok: false`... when absent," T0 §5).
   An out-of-range v1 `bpm` (e.g. `9999`) silently becoming `300` on migration is
   arguably exactly the kind of silent meaning-invention the surrounding paragraphs
   of the same §5 warn against — the caller's `9999` and the eventual `300` are
   different numbers with no indication anything changed unless they read
   `warnings` (and clamping produces no warning in the `normalizeTempoEvent`
   convention — it's a silent repair). Reject-with-error is arguably the *more*
   consistent reading of §5's overall spirit, even though it contradicts the one
   specific parenthetical about `bpm`.

**Behavioral impact on callers, either way:** none currently — no downstream
code in this repository calls `migrateArrangementProject` with an out-of-range
v1 `bpm` (confirmed via `grep -rn "migrateArrangementProject"` outside
`migration.test.ts`: zero call sites). If a future caller does pass one: under
"reject" (current behavior), they get `{ ok: false }` and must handle the error
themselves (adjust their source `bpm` or catch/report it); under "clamp" (T0's
literal wording), they'd get `{ ok: true }` with a silently-adjusted `bpm` and no
signal that anything changed unless they inspect `project.timing.tempos[0].bpm`
against their original input.

**Decision (resolved by the user):** `reject` is canonical, matching the
implementation and `migrateTimelineProject`'s `offsetMs` precedent. T0's
parenthetical (`docs/behavior/timeline-arrangement-v2.md:300-302`) has been
rewritten to describe reject-with-error explicitly, dropping the
`normalizeTempoEvent`/clamp comparison and noting that clamping remains
correct for `normalizeTempoEvent`'s own (same-schema-version repair) use case
but does not apply at the migration boundary. `docs/migrations/0.8-timeline-arrangement-v2.md`
already documented the reject behavior correctly and needed no change. No
implementation change was made or needed.

## Final verdict

**Changes requested.** The reviewed Arrangement v2 implementation itself is
correct and closely matches the frozen contract: strict `validateArrangement`/
`normalizeArrangement`/`createArrangement` never implicitly migrate a v1 `bpm`
and reject its mere presence (`AR-002`, `MIG-010` precedent); `ArrangementEngine`
schedules exclusively through `beatToMs()`/`msToBeat()` with no fixed-BPM
arithmetic anywhere, verified live against a genuinely variable two-tempo
`TimingMap` while a pattern's own `bpm: 999` is confirmed ignored (`AR-007`/`AR-008`);
hot-swap correctly preserves the fractional beat and re-anchors it through the
new project's `TimingMap` without ever seeking the transport; the explicit
`durationBeats` trailing-gap, section-bounds (`0 <= startBeat < endBeat <=
durationBeats`), and half-open non-overlap rules are all enforced exactly as
specified (`AR-004`/`005`/`006`); the non-looping/looping hot-swap-shrink branches
match the Playback v2 §3.3 rule precisely (`AR-009`/`010`); the forced-reposition
step-emission path structurally cannot replay intermediate steps (`AR-011`,
correct by inspection though under-tested — N2); and the public export surface is
complete, appropriately scoped, and consistent with T2's own precedent for
exporting a documented v1 input type. All four `@vixeq/core`-scoped commands from
the review request are independently confirmed green (19 files, 269 tests;
clean typecheck; clean ESM/CJS/DTS build).

However, **B1 is a genuine, verified problem outside the reviewed files but
caused by this change**: `pnpm typecheck` across the full workspace is red.
Two of the three failures (`packages/react`, `examples/arrangement-demo`) are
legitimately anticipated by the review request's own disclosure ("T5 will update
React hooks and any React-side Arrangement v1 assumptions"), but the third
(`examples/cycling-workout`) is not — it depends only on `@vixeq/core`, is not
React-side, was passing before this change, and no task in the collaboration
spec's task table currently claims responsibility for migrating it. This should
be resolved — either as a small addition to this task, an explicit reassignment
to an existing/new task row, or at minimum an explicit, disclosed "known failure
+ acceptable debt" call from the user — before T4 is marked `done`, consistent
with T1/T2/T3 all having kept the full workspace typechecking cleanly at their
own handoff points.

The four non-blocking findings (N1: `docs/api/core.md`'s Arrangement section
wasn't updated for the v2 API per §13.6; N2: `AR-011`'s matrix `covered` status
isn't backed by a discriminating test; N3: no Engine-level test exercises a
genuine trailing gap end-to-end; N4: no test asserts `durationMs` changing across
a tempo boundary; N5: `migrateArrangementProject`'s `unknown`-typed parameter is a
minor, arguably-improved deviation from T2's typed-parameter precedent) do not
block sign-off on their own and may be addressed at the author's discretion.

Separately, and **explicitly not affecting this verdict** per the task's
instruction: this review surfaced a factual divergence between T0's literal text
("clamped/validated the same way `normalizeTempoEvent` already behaves") and the
implementation's actual, deliberate behavior (reject-with-`MigrationIssue` for an
out-of-range v1 `bpm`), analogous in shape to T3's cue/event terminology
question. See the "Decision required" section above for the full comparison,
the internal-consistency argument on each side, and the recommendation to resolve
it (by updating T0's wording or the implementation) before T7's migration
fixtures depend on `MIG-006`'s exact behavior.

Recommend: resolve B1 (fix or explicitly, visibly defer `examples/cycling-workout`),
then re-request review; N1–N5 may be addressed in the same or a later pass at the
author's discretion; the BPM clamp/reject question needs the user's decision but
does not block this task.

## Re-review (fixes verification)

Re-reviewed after the user's two follow-up changes: (1) a fix to
`examples/cycling-workout` for B1, and (2) a decision resolving the
clamp-vs-reject question, applied to T0's doc text only (no implementation
change).

### B1 — RESOLVED

**File:** `examples/cycling-workout/src/workout.ts`, `examples/cycling-workout/src/workout.test.ts`.

`workoutToArrangement()` (`workout.ts:71-84`) now returns a v2-shaped
`ArrangementProject`: `{ version: 2, timing: createTimingMap({ bpm: 60 }),
durationBeats: elapsedSeconds, patterns, sections }`. Verified:

- `createTimingMap` is imported from `@vixeq/core` (`workout.ts:1`), alongside
  the existing `ArrangementProject`/`SequenceProject`/`Track` type imports.
  Confirmed by reading `packages/core/src/timeline/timing.ts:49` and
  `packages/core/src/timeline/index.ts`/`packages/core/src/index.ts`'s
  `export *` chain that `createTimingMap` is a genuine `@vixeq/core` root
  export, not a stray local helper.
- `createTimingMap({ bpm: 60 })` produces exactly `{ tempos: [{ beat: 0, bpm:
  60 }], startPositionMs: 0 }` (60 is within `SEQUENCER_LIMITS`
  `[minBpm=20, maxBpm=300]`, so `normalizeTempos` passes it through
  unclamped) — this matches the test's `expect(arrangement.timing.tempos).toEqual([{
  beat: 0, bpm: 60 }])` (`workout.test.ts:15`) exactly, including the field
  name `tempos` (`TimingMap.tempos`, `timeline/types.ts:14-17`).
- `durationBeats: elapsedSeconds` is correct: `elapsedSeconds` accumulates as
  `elapsedSeconds = section.endBeat` inside the `sections.map(...)` loop
  (`workout.ts:74-81`), so after the loop it equals the last section's
  `endBeat` — the sum of all interval durations, with no trailing gap
  introduced. For the two-interval slice in the test (`warm-up`: 60s,
  `build`: 45s), `elapsedSeconds` = 105, matching
  `expect(arrangement.durationBeats).toBe(105)` (`workout.test.ts:16`) and the
  expected `sections` array's `endBeat: 60`/`endBeat: 105`
  (`workout.test.ts:17-20`).
- Independently re-ran all four requested commands:
  - `pnpm --filter vixeq-example-cycling-workout typecheck` — clean, `tsc
    --noEmit` reports "Done", no errors.
  - `pnpm --filter vixeq-example-cycling-workout test` — 5/5 tests pass
    (`workout.test.ts`).
  - `pnpm typecheck` (root) and `pnpm -r --no-bail typecheck` — `examples/cycling-workout`
    now reports "Done" (previously the two `TS2322`/`TS2339` errors). The only
    remaining full-workspace failures are `packages/react`
    (`src/useArrangement.test.tsx:103,106,112` — `TS2353`/`TS2339` on `bpm`)
    and `examples/arrangement-demo` (`src/arrangement.ts:11,29` — same `bpm`
    shape). Both are exactly the T5-scope, React-side failures the original
    review already classified as disclosed, anticipated fallout ("T5 will
    update React hooks..."), not new or cycling-workout-related. No other
    package regressed.
  - `pnpm --filter @vixeq/core test` — 19 files, 269 tests, all pass; no
    regression in the T4 core implementation from this follow-up change.

B1 was the sole blocking finding. With it resolved and no new regressions
introduced, **Status is updated to `approved`.**

### Decision required (bpm clamp vs. reject) — RESOLVED

**File:** `docs/behavior/timeline-arrangement-v2.md:300-308`.

The parenthetical that previously read "clamped/validated the same way
`normalizeTempoEvent` already behaves in v1" has been rewritten to state
reject-with-error explicitly: "...only when it is a finite number within
`SEQUENCER_LIMITS.minBpm`/`maxBpm`; otherwise migration records an error
rather than silently clamping it," with an added sentence clarifying that
`normalizeTempoEvent`'s clamping remains correct for its own (same-schema-version
repair) use case but does not apply at the migration boundary. This removes the
literal-text conflict this review flagged — T0 §5 now matches the
implementation's actual (reject) behavior, the `migration.test.ts:49-54`
test title ("rejects invalid v1 bpm instead of clamping at the migration
boundary"), and `docs/migrations/0.8-timeline-arrangement-v2.md`'s existing
prose (`ok:false` for an invalid v1 `bpm`), which required no further change
and remains consistent.

Confirmed `packages/core/src/arrangement/migration.ts` has no diff against
what this review originally examined (`git status --porcelain` shows it as an
untracked new file, unchanged; `isValidBpm`/`validateV1Arrangement` still
reject rather than clamp) — matching the stated intent that no implementation
change was made or needed, since the implementation was already the canonical
behavior and only the doc text was wrong.

This item was explicitly marked non-blocking to the verdict in the original
review and remains resolved-and-non-blocking here.

### N1–N5 — not addressed, left to author's discretion (non-blocking)

None of N1 (stale `docs/api/core.md` Arrangement section), N2 (`AR-011` matrix
`covered` status lacks a discriminating `"step"`-event test), N3 (no
Engine-level test drives a genuine trailing gap end-to-end), N4 (no test
asserts `StepEvent.durationMs` across a tempo boundary), or N5
(`migrateArrangementProject`'s `unknown`-typed first parameter vs. T2's typed
precedent) were addressed in this pass — confirmed by re-reading each cited
file/line and finding no corresponding change in `git diff HEAD --stat`
beyond the B1 fix and the T0 doc-text change above. This matches this
session's explicit scope decision (blocking-only). All five remain
non-blocking and are left to the author's discretion for a future pass, per
the original review's own verdict.
