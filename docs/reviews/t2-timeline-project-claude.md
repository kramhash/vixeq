# T2 TimelineProject v2 Implementation — Review

- Reviewer: Claude (review agent)
- Author: Claude
- Status: approved
- Normative contract: [`../behavior/timeline-arrangement-v2.md`](../behavior/timeline-arrangement-v2.md) §2, §2.1, §2.2, §5 (Timeline portion)
- Matrix: [`../behavior/timeline-arrangement-v2-matrix.md`](../behavior/timeline-arrangement-v2-matrix.md) (`TL-*`, `TL-Q-*`, `MIG-001`..`005`, `MIG-009`/`010`)

## Scope

Implement TimelineProject v2 per the frozen T0 contract: v2 schema types
(`JsonPrimitive`/`JsonValue`/`JsonObject`, generic `TimelineEvent`/`TimelineProject`),
a rewritten strict `validateTimelineProject` (trackId referential integrity,
id uniqueness, beat range, `durationBeats`, nested `TimingMap` validation,
pre-sorted-events invariant, optional `TimelineEventValidator` integration),
deterministic project-local id generation (replacing a v1 module-global
counter), strict half-open range queries, and `migrateTimelineProject()`.
Removes `sequenceProjectToTimeline()` entirely. No `TimelineEngine` (T3),
no `ArrangementProject` v2/migration (T4), no `useTimeline()` (T5).

## Changed files

- `packages/core/src/timeline/types.ts` — v2 schema types
- `packages/core/src/timeline/project.ts` — validate/normalize/update helpers rewrite, new `nextAvailableId`
- `packages/core/src/timeline/query.ts` — `trackId: null` global marker, `includeGlobalEvents`, strict half-open range
- `packages/core/src/timeline/migration.ts` (new) — `migrateTimelineProject`
- `packages/core/src/timeline/fromSequence.ts` — deleted
- `packages/core/src/timeline/index.ts` — export updates
- `packages/core/src/types.ts` — new shared `MigrationIssue`/`MigrationResult<T>`
- `packages/core/src/timeline/project.test.ts` (new), `query.test.ts` (new), `migration.test.ts` (new)
- `packages/core/src/timeline/timeline.test.ts` — deleted (split into the three new files)
- `docs/api/core.md`, `docs/behavior/timeline-arrangement-v2-matrix.md`, `docs/plans/v1-collaboration-spec.md`

## Review focus

- `validateTimelineProject` matches T0 §2 exactly: `version 2`, `durationBeats`
  finite `> 0`, nested `timing` validated via `validateTimingMap()` (caught
  and converted to a `path: "timing"` issue, not left to throw through),
  track/event id uniqueness (`Set`-based, matching the Arrangement
  convention), `trackId` referential integrity (`null` or existing track
  id), strict half-open beat range (`0 <= beat < durationBeats`), required
  non-empty `type`, JSON-compatibility + finite-numeric-leaf checks for
  `data`, and the events-pre-sorted invariant (reject non-decreasing-beat
  violations rather than silently re-sorting).
- `TimelineEventValidator` integration: runs only on events that already
  passed structural/JSON checks, throws are caught and converted to
  `path: "events.${index}"` issues — `validateTimelineProject` never
  actually throws.
- Deterministic id generation: `nextAvailableId()` is a pure function of the
  current collection's existing ids (no module-global counter anywhere), and
  finds the first unused numeric suffix per T0 §2.
- `sortTimelineEvents` drops the old `trackId`/`id` secondary sort key and
  is a stable sort by `beat` only, so same-beat entries keep their original
  relative order (verify stability claim against `Array.prototype.sort`
  guarantees, mirroring the T1 `normalizeTempos` precedent).
- `getEventsInBeatRange` throws `RangeError` for reversed/out-of-bounds/
  non-finite ranges instead of reordering/clamping; `getEventsAtBeat`/
  `getNextEvents` correctly use the new `trackId: null`/`includeGlobalEvents`
  semantics without over-applying the strict-range requirement where T0
  doesn't ask for it.
- `migrateTimelineProject()`: `offsetMs` -> `startPositionMs` only when
  valid (else error, not silent default), `"global"` -> `null` with no
  warning, `type`/`durationBeats`/`value` removed-field warnings, `ok:false`
  when `durationBeats` option is absent, output actually satisfies strict
  `validateTimelineProject()`.
- `sequenceProjectToTimeline()` removal is complete (function, type, exports,
  tests) and confirmed to have no consumers outside `timeline/` before removal.
- No T3/T4/T5 scope (TimelineEngine, ArrangementProject v2, useTimeline)
  leaked into this change.
- Matrix rows flipped to `covered` actually have a corresponding test with
  that ID; `MIG-006`..`008` (Arrangement-specific) correctly left `planned`.

## Commands run

- `pnpm --filter @vixeq/core test` — 16 files, 248 tests passed (65 new tests across `project.test.ts`, `query.test.ts`, `migration.test.ts`; `timing.test.ts` unchanged from T1).
- `pnpm --filter @vixeq/core typecheck` — clean.
- `pnpm --filter @vixeq/core build` — ESM/CJS/DTS all succeeded.
- `pnpm typecheck` (full workspace) — all 10 projects clean; confirms `sequenceProjectToTimeline` removal and the `TimelineEvent`/`TimelineTrack`/`TimelineProject` type changes have no consumers outside `packages/core/src/timeline/`.
- `grep -rn 'sequenceProjectToTimeline\|SequenceToTimelineOptions'` before deleting `fromSequence.ts` — confirmed fully contained to `timeline/`.

## Deliberate interpretation note for the reviewer

Several matrix rows (`TL-003/004/007/008/009/013/014/017`) say "strict construction
throws" in shorthand. `validateTimelineProject()` itself never throws — it returns
`ValidationResult`, matching the existing `validateProject`/`validateArrangement`
convention (which also never throw despite handling type/range violations). These
rows are tested via `validateTimelineProject(...).ok === false`, not an actual
thrown exception, **except** where the *update helpers* (`addTimelineEvent`, etc.)
are exercised directly — those genuinely throw `TypeError`, per the newly-added
strictness requirement in spec §2 ("Immutable update helpers... validate... and
throw rather than silently coercing"). Please confirm this interpretation is
consistent with spec intent; if not, flag it as a finding.

Also note a design correction made mid-implementation: the update helpers
(`addTimelineTrack`/`addTimelineEvent`/`updateTimelineEvent`/`removeTimelineTrack`/
`removeTimelineEvent`/`setTimelineTrackEnabled`) were initially drafted reusing the
lenient `normalizeTimelineProject()` (matching the old v1 pattern), then corrected
to a strict `assertValidTimelineProject()` (validate + throw) after re-reading
spec §2's explicit strictness requirement for update helpers. Please double-check
this correction is complete and no call site still routes through the lenient
path.

## Known expected failures

None expected.

## Review checklist

- [x] `validateTimelineProject` matches spec §2 rule-by-rule, read line-by-line
      against `docs/behavior/timeline-arrangement-v2.md` §2: `version === 2`;
      `durationBeats` finite `> 0`; nested `timing` delegated to
      `validateTimingMap()` inside try/catch and converted to a single
      `path: "timing"` issue; track/event id non-empty + `Set`-based
      uniqueness; `trackId` `null`-or-existing-track referential integrity;
      strict half-open event beat range `0 <= beat < durationBeats`; required
      non-empty event `type`; rejection of the removed `TimelineTrack.type`
      and `TimelineEvent.durationBeats`/`value` fields; events-pre-sorted
      (non-decreasing beat) invariant. All confirmed correct — **except one
      gap, see B1**: the `data` JSON-compatibility check does not verify the
      top-level shape is an object (`JsonObject`), only that it is JSON-value
      compatible.
- [x] `TimelineEventValidator` integration runs only after structural/JSON
      checks pass (`structurallyValid` flag gates the call), a thrown error is
      caught and converted to a `path: "events.${index}"` issue, and
      `validateTimelineProject` itself never throws. Confirmed by reading
      `project.ts:319-328` and by the dedicated test "the validator only runs
      on events that already passed structural checks"
      (`project.test.ts:360-377`), which proves the callback is skipped (call
      count `0`) for a structurally-invalid event.
- [x] `nextAvailableId` is a pure function of its `existingIds` argument (no
      module-global counter anywhere in `project.ts`/`migration.ts`).
      Hand-traced the `normalizeTimelineProject` batch loop
      (`project.ts:138-155`) against `tracks = [{id:"track-1"}, {id:"track-1"},
      {}]`: index 0 keeps `"track-1"` (`usedTrackIds = {"track-1"}`); index 1's
      requested `"track-1"` collides, so it falls to
      `nextAvailableId("track", {"track-1"})` → `"track-2"`
      (`usedTrackIds = {"track-1","track-2"}`); index 2 has no requested id, so
      `nextAvailableId("track", {"track-1","track-2"})` → `"track-3"`. Result
      `["track-1","track-2","track-3"]` — all unique, deterministic, and a
      second run over the same input array produces the identical result
      (confirmed by the existing "id generation is deterministic across
      repeated calls" test). Also traced a case where an early
      auto-generated id "steals" a low suffix a later explicit id wanted
      (`[{}, {}, {id:"track-1"}]` → `["track-1","track-2","track-3"]`, the
      third track's explicit `"track-1"` request is silently reassigned to
      `"track-3"`); this is correct behavior for a *lenient/repair* function
      and does not violate any spec rule (spec does not require normalize to
      honor a colliding explicit id).
- [x] All six update helpers (`addTimelineTrack`, `addTimelineEvent`,
      `updateTimelineEvent`, `removeTimelineTrack`, `removeTimelineEvent`,
      `setTimelineTrackEnabled`) call `assertValidTimelineProject` — verified
      by reading every one of their bodies in `project.ts:361-432`. No update
      helper calls `normalizeTimelineProject`; the only caller of
      `normalizeTimelineProject` in the file is `createTimelineProject`
      (a lenient constructor, not an update helper), which is the correct,
      spec-sanctioned split. The author's "design correction" claim in the
      review request is accurate and complete.
- [x] `addTimelineEvent`/`updateTimelineEvent` call `sortTimelineEvents`
      before `assertValidTimelineProject` (`project.ts:403-407`,
      `project.ts:419-424`), so a beat-changing patch or an appended event
      cannot trip the events-pre-sorted invariant against itself. Confirmed
      by the "updateTimelineEvent re-sorts and re-validates after a beat
      patch" test (`project.test.ts:315-321`), which patches an event to an
      earlier beat and asserts the resulting array order changed accordingly.
- [x] The "matrix says throws, implementation returns `ValidationResult`"
      interpretation note is addressed — see Verification method. Judged
      **acceptable, non-blocking** (N2).
- [x] The "update helpers corrected from lenient to strict" note is addressed
      — see the update-helper checklist item above. Confirmed complete, no
      lenient call site remains.
- [x] `migrateTimelineProject`'s warning/error branching
      (`onRemovedField` absent → warn + drop; present and resolves → fold
      into `data`, no warning; present and returns `undefined` → `ok:false`)
      matches spec §5's general principle exactly: dropping is not "inventing
      domain meaning" (the field's value is simply discarded, documented via
      warning), while *preserving* the value under a caller-chosen `data` key
      requires an explicit, caller-supplied conversion, and an unresolved
      conversion blocks migration. Confirmed via `migration.ts:43-86` and
      `migration.test.ts` MIG-004's three variants (default-drop,
      `onRemovedField` resolves, `onRemovedField` returns `undefined`).
- [x] `matchesQueryOptions` in `query.ts:11-31` applies `eventTypes`
      unconditionally (before branching on `trackId === null`), and only
      `trackIds`/`includeDisabledTracks` are scoped to non-null-`trackId`
      events, matching spec §2.2 exactly ("`eventTypes`, when present,
      filters..." has no global-event carve-out; "`trackIds` ... has no
      effect on global events"; "`includeDisabledTracks` ... govern only
      non-null-track events"). Confirmed via `TL-Q-005`
      (`query.test.ts:60-65`).
- [x] `getEventsInBeatRange` throws `RangeError` for reversed/out-of-bounds/
      non-finite ranges (`query.ts:44-52`); `getEventsAtBeat`/`getNextEvents`
      (`query.ts:59-79`) contain no `RangeError`/bounds logic at all — neither
      is a "beat-range helper" in spec §2.2's sense (one takes a point + a
      symmetric tolerance, the other a starting beat + a count), so this is
      correctly scoped, not under- or over-applied.
- [x] `sequenceProjectToTimeline` removal is complete: `fromSequence.ts` is
      deleted, no export references it anywhere in `timeline/index.ts` or
      `packages/core/src/index.ts`, `project.test.ts`'s `TL-018` explicitly
      asserts the export is absent from the module namespace, and a repo-wide
      `grep -rn 'sequenceProjectToTimeline\|SequenceToTimelineOptions'`
      (re-run independently) finds matches only in prose docs
      (`docs/behavior/`, `docs/migrations/`, `docs/api/core.md`,
      `docs/plans/`, review files) — none in live `.ts` source.
- [x] No T3 (`TimelineEngine`)/T4 (`ArrangementProject` v2)/T5 (`useTimeline`)
      scope leaked in. `git diff HEAD --stat` touches only
      `packages/core/src/timeline/*`, `packages/core/src/types.ts`, and docs
      bookkeeping; no `arrangement/`, `packages/react/`, or `*Engine*` file
      is touched, and no `TimelineEngine`-shaped file exists anywhere under
      `packages/core/src/timeline/`.
- [x] Every flipped matrix row (`TL-*`, `TL-Q-*`, `MIG-001`..`005`, `MIG-009`,
      `MIG-010`) has a same-ID (or clearly corresponding, for the two
      unlabeled tests) test with assertions matching its "Expected result"
      column; spot-checked all of them against `project.test.ts`/
      `query.test.ts`/`migration.test.ts`. `MIG-006`..`008` correctly remain
      `planned` (Arrangement-specific, T4 scope).
- [x] Independently re-ran every command the task and the review request
      asked for — see Commands run below. All green, matching the author's
      reported counts exactly.

## Verification method

Read `docs/plans/v1-collaboration-spec.md` §2, §6, §7, §9, §13 and the frozen
contract `docs/behavior/timeline-arrangement-v2.md` §2/§2.1/§2.2/§5 in full,
then read every changed file (`types.ts`, `project.ts`, `query.ts`,
`migration.ts`, `index.ts`, `packages/core/src/types.ts`, and all three new
test files) end to end, comparing each `validateTimelineProject` branch and
each update helper against the corresponding spec bullet.

**On the "deliberate interpretation note" (matrix "throws" language):**
Confirmed the existing codebase convention first — `validateProject`
(`packages/core/src/validation.ts:8`) and `validateArrangement`
(`packages/core/src/arrangement/project.ts:25`) both return `ValidationResult`
and never throw, despite handling exactly the kind of type/range violations
the Timeline matrix rows describe. Compared how T0's frozen contract writes
function signatures for `TimingMap` (§1 gives an explicit code block with
`validateTimingMap(timing: TimingMap): void; // throws TypeError/RangeError`)
against how it writes the `TimelineProject` section (§2 gives only the
*type* definitions plus prose bullets — no function-signature code block for
`validateTimelineProject` at all, throwing or otherwise). Given that
asymmetry, and that codebase precedent for "`validateX`" functions is
non-throwing, `validateTimelineProject()` returning `ValidationResult` is a
reasonable, precedent-consistent reading of an intentionally looser matrix
shorthand — not a deviation from an explicit contract. The matrix's "strict
construction throws" language is best read as describing the overall strict
validation *pathway* (validate-and-reject, via whichever mechanism), not
literally mandating a new throwing constructor function that doesn't
otherwise appear anywhere in the frozen contract. This is a legitimate,
non-blocking interpretation (recorded as **N2** below); a wording fix to the
matrix (e.g. "rejected via `ok:false` or, via update helpers, a thrown
`TypeError`") would remove the ambiguity for future tasks but is not required
for this task to be correct.

**On the `data` JSON-compatibility gap (B1):** Wrote and ran an ad hoc probe
test directly against the built module (temporarily added to
`packages/core/src/timeline/`, run via
`pnpm --filter @vixeq/core exec vitest run`, then deleted — not left in the
tree) to confirm the gap is real rather than a misreading of the source:

```
validateTimelineProject({ ...durationBeats:4, events: [{ id:"e1", trackId:null, beat:0, type:"cue", data: "not-an-object" }] })
  → { ok: true, errors: [] }
validateTimelineProject({ ...durationBeats:4, events: [{ id:"e1", trackId:null, beat:0, type:"cue", data: [1,2,3] }] })
  → { ok: true, errors: [] }
```

Both should be `ok: false` per spec §2 ("`TimelineTrack.data` and
`TimelineEvent.data` must be JSON-compatible (`JsonObject`)",
`timeline-arrangement-v2.md:121-122`) and per the frozen type
(`data?: TData` where `TData extends JsonObject`, never a bare string/array/
number/boolean). Root cause, read directly in `project.ts:230` and
`project.ts:306`: the check is `if (track.data !== undefined &&
!isJsonCompatible(track.data))` / `if (event.data !== undefined &&
!isJsonCompatible(event.data))` — `isJsonCompatible` (line 23-41) accepts any
`JsonValue` (primitive, array, *or* object), not specifically an object. The
normalize/repair path (`buildTrackFields`/`buildEventFields`, lines 106 and
117) gets this right — it gates on `isRecord(track.data)` /
`isRecord(event.data)` *before* calling `toJsonCompatible` — so the omission
is specific to the strict validator, not a systemic misunderstanding of the
rule elsewhere in the file. This means every one of the six update helpers
(all of which route through `validateTimelineProject` via
`assertValidTimelineProject`) inherits the same gap, and `TL-013`/`TL-014`
are under-tested: both existing tests for those rows only exercise a
non-JSON-compatible/non-finite value *nested inside* an already-object
`data`, never a non-object `data` itself.

Independently re-ran every command:

- `pnpm --filter @vixeq/core test` — 16 files, 248 tests passed. Matches the
  author's reported count exactly.
- `pnpm --filter @vixeq/core typecheck` — clean, no output (as expected for a
  passing `tsc --noEmit`).
- `pnpm --filter @vixeq/core build` — ESM/CJS/DTS all succeeded.
- `pnpm typecheck` (full workspace) — all 10 projects (`core`, `react`,
  `player-react`, `apps/playground`, all 6 examples) clean.
- `grep -rn 'sequenceProjectToTimeline\|SequenceToTimelineOptions\|fromSequence'`
  across the repo (re-run independently) — no live `.ts`/`.tsx` match; only
  prose-doc and test-name matches, as expected.
- `git diff HEAD --stat` — confirmed the touched-file set is exactly what the
  "Changed files" section claims, with no `arrangement/`, `packages/react/`,
  or `*Engine*` file present.

## Findings

### B1 (blocking) — `validateTimelineProject` accepts non-object `data`, violating the frozen `JsonObject` contract

**File:** `packages/core/src/timeline/project.ts:230` (track) and
`packages/core/src/timeline/project.ts:306` (event).

Spec (`docs/behavior/timeline-arrangement-v2.md:121-122`): "`TimelineTrack.data`
and `TimelineEvent.data` must be JSON-compatible (`JsonObject`) and any
numeric leaf values must be finite." The frozen type
(`docs/behavior/timeline-arrangement-v2.md:79-82`) declares
`data?: TData` where `TData extends JsonObject` — `data`, if present, must be
a plain object, never a bare array/string/number/boolean.

The implementation checks `!isJsonCompatible(track.data)` /
`!isJsonCompatible(event.data)`, but `isJsonCompatible` (line 23) accepts any
`JsonValue` — including top-level arrays, strings, numbers, and booleans —
not specifically a `JsonObject`. A `data` value that is JSON-value-compatible
but not itself an object (e.g. `data: "hello"`, `data: [1, 2, 3]`,
`data: 42`) incorrectly passes strict validation.

**Failure scenario:** Untrusted/dynamic project JSON (exactly the input this
function exists to guard, since a TypeScript caller can't produce this shape
under the real `JsonObject`-constrained type) with
`events: [{ id: "e1", trackId: null, beat: 0, type: "cue", data: "oops" }]`
is accepted by `validateTimelineProject` (`ok: true`) and by every one of the
six update helpers (`addTimelineTrack`/`addTimelineEvent`/etc., which all
route through the same check via `assertValidTimelineProject`). Downstream
code written against the declared type (`event.data` is a `JsonObject`, so
code may do `Object.keys(event.data)`, `{...event.data, extra: 1}`, or pass
it to a domain `TimelineEventValidator` expecting object shape) receives a
string/array/number at runtime instead, silently, with no validation error to
explain why.

Confirmed empirically (see Verification method) — this is not a misreading
of the source; `validateTimelineProject(...)` returns `{ ok: true, errors: []
}` for both a string and an array `data`.

**Fix:** gate the `data` check on `isRecord(...)` before (or together with)
`isJsonCompatible(...)`, mirroring exactly what `buildTrackFields`/
`buildEventFields` (lines 106, 117) already do correctly for the lenient
normalize path, e.g.:

```ts
if (track.data !== undefined && (!isRecord(track.data) || !isJsonCompatible(track.data))) { ... }
```

**Test-coverage gap:** `TL-013`/`TL-014` (`project.test.ts:161-187`) only
exercise a non-JSON-compatible/non-finite value *nested inside* an
already-object `data`; neither tests a non-object `data` itself. Add a case
per row once the check is fixed.

### N1 (non-blocking) — `docs/api/core.md` misstates `validateTimelineProject`'s error-reporting contract

**File:** `docs/api/core.md:30`.

The line reads: "`validateTimelineProject(input, eventValidator?)` and the
immutable update helpers (...) are strict and throw `TypeError` on invalid
input." As written, this attributes "throw `TypeError`" to
`validateTimelineProject` itself, which is incorrect —
`validateTimelineProject` returns `ValidationResult` (`{ ok, errors }`) and
never throws (confirmed by every `TL-*` test in `project.test.ts`, all of
which call it directly and assert `.ok`, never `expect(() =>
validateTimelineProject(...)).toThrow()`). Only the six update helpers
throw. Suggest rewording to something like: "`validateTimelineProject(input,
eventValidator?)` returns a `ValidationResult` (never throws); the immutable
update helpers (...) are strict and throw `TypeError` on invalid input by
calling it internally and rejecting on `ok: false`." Purely a documentation
accuracy issue — no runtime behavior is affected — but worth fixing before
this line is relied on by an external consumer, since it directly
contradicts the actual, tested contract.

### N2 (non-blocking, confirmed acceptable) — matrix "strict construction throws" shorthand vs. non-throwing `validateTimelineProject`

Addressed in full under Verification method above. The author's own
interpretation (matrix rows describe the overall strict-rejection pathway,
not a literal throw from `validateTimelineProject` itself) is consistent
with the pre-existing `validateProject`/`validateArrangement` convention and
with the frozen contract's own asymmetry (TimingMap's function signatures
are given explicitly with throw annotations; TimelineProject's are not).
No code or test change required. Recommend, as a documentation-only
follow-up, rewording the matrix's "Expected result" column for
`TL-003/004/007/008/009/013/014/017` to spell out `ok:false` explicitly
(reserving "throws" for the rows that actually exercise an update helper),
so a future reader doesn't have to re-derive this reasoning from scratch.

### N3 (non-blocking) — exported `normalizeTimelineTrack`/`normalizeTimelineEvent` can produce colliding ids if used to normalize sibling items

**File:** `packages/core/src/timeline/project.ts:109-124`.

Both functions generate a missing `id` via `nextAvailableId(prefix, [])` — a
hardcoded empty existing-ids collection, not the caller's project or
sibling-item context. Calling either function in a loop over multiple
partial tracks/events that all omit `id` (e.g.
`tracks.map((t) => normalizeTimelineTrack(t))`) yields `"track-1"` for every
one of them, producing duplicate ids that a subsequent
`validateTimelineProject` call would then reject. This is different from —
and not protected by — the correct, `Set`-based per-collection dedup logic
that `normalizeTimelineProject`'s own batch loop implements
(`project.ts:138-155`); that internal loop does not call
`normalizeTimelineTrack`/`normalizeTimelineEvent` at all, so the batch path
itself is unaffected.

These two functions are not part of the frozen T0 public contract (only
`createTimelineProject`/`normalizeTimelineProject` are documented in
`docs/api/core.md:30`), are not exercised by any test in this change, and are
not called anywhere internally — so this does not affect any tested or
spec-mandated behavior in T2. But they are exported from
`timeline/index.ts`, expanding the public API surface beyond what T0 froze,
with a real footgun for any external caller using them as a per-item
normalizer for a batch. Recommend one of: accept an `existingIds` parameter,
add a doc comment noting the single-item-only, non-project-safe id
generation, or drop the export until there's a use case (and matching test)
for it.

### N4 (minor, non-blocking) — `addTimelineTrack`/`addTimelineEvent` store a caller-supplied `id` without trimming

**File:** `packages/core/src/timeline/project.ts:361-365`,
`packages/core/src/timeline/project.ts:394-398`.

`addTimelineTrack`/`addTimelineEvent` accept `track.id`/`event.id` as-is (only
checking `.trim().length > 0`, then using the untrimmed `track.id`/`event.id`
verbatim), while `normalizeTimelineProject`'s batch loop
(`project.ts:141-142`, `150-151`) uses the *trimmed* id as the stored value.
An id like `" a "` passed to `addTimelineTrack` would be stored with its
whitespace intact; this is internally self-consistent (later `trackId`
lookups compare against the same untrimmed string) so it is not a
referential-integrity bug, just a minor inconsistency between the two entry
paths' repair behavior. Not worth blocking on.

## Final verdict

**Changes requested.** The bulk of T2 is implemented correctly and matches
the frozen T0 contract closely: id generation is genuinely pure and
project-local (hand-traced, no module-global state); all six update helpers
correctly route through the strict, throwing `assertValidTimelineProject`
with no lenient-path leftovers; `addTimelineEvent`/`updateTimelineEvent`
correctly re-sort before validating, avoiding the self-contradiction the task
called out; the query semantics (`trackId: null`, `includeGlobalEvents`,
`eventTypes` applying uniformly, `trackIds`/`includeDisabledTracks` scoped to
non-null tracks) match spec §2.2 exactly; `getEventsInBeatRange`'s strict
`RangeError` half-open range is correctly *not* over-applied to
`getEventsAtBeat`/`getNextEvents`; `migrateTimelineProject`'s warning/error
branching matches spec §5's "drop by default, require an explicit conversion
to preserve meaning" principle precisely; `sequenceProjectToTimeline` removal
is complete with no live-code reference remaining anywhere; and no T3/T4/T5
scope leaked into the change. All four requested commands
(`pnpm --filter @vixeq/core test`/`typecheck`/`build`,
`pnpm typecheck`) were independently re-run and are green, matching the
author's reported results exactly.

However, **B1 is a genuine, empirically-confirmed correctness gap**:
`validateTimelineProject` (and therefore every one of the six update
helpers) accepts a non-object `data` value (a bare string, array, number, or
boolean) for `TimelineTrack.data`/`TimelineEvent.data`, when spec §2
explicitly requires `data` to be JSON-compatible *and* a `JsonObject`
specifically. This is exactly the kind of structural gap strict validation
exists to catch — it's a one-line fix (`isRecord(...) &&
isJsonCompatible(...)`, matching what the normalize path already does
correctly) plus a couple of added assertions to `TL-013`/`TL-014`, but it
should be fixed and re-verified before this task is marked `done`. The three
non-blocking findings (N1: a documentation line in `docs/api/core.md`
misattributes throwing behavior to `validateTimelineProject`; N2: the
matrix's "throws" shorthand is confirmed to be an acceptable, non-blocking
interpretation, addressing the author's request directly; N3: the exported
but untested `normalizeTimelineTrack`/`normalizeTimelineEvent` have a latent
id-collision footgun when used outside the batch path; N4: a minor
untrimmed-id inconsistency between two lenient entry points) do not block
sign-off on their own, but N1 is worth fixing in the same pass as B1 since
both touch the same "does this throw?" question.

Recommend: fix B1, add the two missing `TL-013`/`TL-014` non-object-`data`
assertions, and reword the `docs/api/core.md:30` line per N1, then re-request
review. N2/N3/N4 may be deferred at the author's discretion.

## Re-review (fixes verification)

Scope: fixes-only re-verification of B1/N1/N2/N3/N4 from the previous review
round (no from-scratch re-review). Each item was checked by reading the
current source/doc at the cited lines and, where applicable, hand-tracing the
logic; the full command suite was independently re-run.

### B1 — **RESOLVED**

`packages/core/src/timeline/project.ts:243` (track) and `:319` (event) now
read:

```ts
if (track.data !== undefined && (!isRecord(track.data) || !isJsonCompatible(track.data))) { ... }
if (event.data !== undefined && (!isRecord(event.data) || !isJsonCompatible(event.data))) { ... }
```

Hand-traced: for `data: "not-an-object"` or `data: [1,2,3]`, `isRecord(...)`
is `false`, so `!isRecord(...)` is `true`, short-circuiting the `||` to
`true` regardless of `isJsonCompatible`, and the branch pushes an error —
both the track and event paths now correctly reject a non-object `data`. For
a genuine `JsonObject` (e.g. `{ nested: { value: 1 } }`), `isRecord(...)` is
`true`, so the check falls through to `!isJsonCompatible(...)`, preserving
the original nested-leaf validation (`TL-014`) unchanged. This exactly
mirrors the fix suggested in the original finding and matches
`buildTrackFields`/`buildEventFields`'s existing `isRecord`-gated normalize
path.

Test coverage added: `packages/core/src/timeline/project.test.ts:177-195`,
a new `"TL-013 rejects a non-object data value (data must be a JsonObject,
not any JsonValue)"` test, asserting `ok: false` for a string `data` on an
event and an array `data` on a track. The pre-existing `TL-013`/`TL-014`
tests (nested non-JSON-compatible / non-finite leaf inside an object `data`)
are untouched and still pass. Re-ran the exact probe from the original
finding directly against `validateTimelineProject` with `data: "not-an-object"`
and `data: [1,2,3]` — both now return `{ ok: false, ... }` (confirmed via the
new test passing, superseding the ad hoc probe used in the first review
round).

### N1 — **RESOLVED**

`docs/api/core.md:30` now reads: "`validateTimelineProject(input,
eventValidator?)` returns a `ValidationResult` and never throws; the
immutable update helpers (...) are strict and throw `TypeError` on invalid
input by calling it internally and rejecting on `ok: false` (auto-generating
a missing `id` is the one sanctioned exception)." This correctly attributes
the throw to the update helpers only, matches the actual tested contract,
and additionally documents the "auto-generate missing id" exception that
wasn't explicitly called out before — a small accuracy improvement beyond
what N1 asked for.

### N2 — **RESOLVED**

`docs/behavior/timeline-arrangement-v2-matrix.md` rows `TL-003`, `TL-004`,
`TL-007`, `TL-008`, `TL-009`, `TL-017` (lines 39, 40, 43, 44, 45, 53) all now
read `"validateTimelineProject ok:false; update helpers throw TypeError"` in
the Expected result column, replacing the ambiguous "strict construction
throws" shorthand this finding flagged. This precisely reflects the real
split confirmed in the original review (`validateTimelineProject` itself
never throws; only the update helpers do).

Note: `TL-013`/`TL-014` (lines 49-50) still read `"strict construction/update
throws"` — the original N2 finding text and the review checklist explicitly
scoped the ambiguous-wording complaint to `TL-003/004/007/008/009/017`
(`TL-013`/`TL-014` were separately handled as part of B1's test-coverage
gap, not N2's wording gap), and today's task instructions list the same six
rows for verification. So this is consistent with what was actually
requested; it is called out here only for completeness, not as an
outstanding issue against N2's scope.

### N3 — **RESOLVED**

`packages/core/src/timeline/project.ts:109-116` (`normalizeTimelineTrack`)
and `:128-132` (`normalizeTimelineEvent`) now carry doc comments explicitly
stating: "When `id` is missing, this generates `\"track-1\"` every time (no
sibling context) — safe as a standalone utility, but do not use it to
normalize multiple items in a batch (they would collide)" (and the
corresponding event-batch caveat, cross-referencing why
`normalizeTimelineProject`'s own batch loop doesn't call these functions).
This documents exactly the footgun N3 identified, satisfying the
"add a doc comment" option from the original finding's recommendation list.

### N4 — **RESOLVED**

`packages/core/src/timeline/project.ts:376-378` (`addTimelineTrack`) and
`:409-411` (`addTimelineEvent`) now compute `id` as
`track.id.trim().length > 0 ? track.id.trim() : nextAvailableId(...)` /
`event.id.trim().length > 0 ? event.id.trim() : nextAvailableId(...)` — the
trimmed value is what gets stored (spread into the new track/event object),
matching `normalizeTimelineProject`'s batch-loop behavior. An id like
`" a "` is now stored as `"a"` in both entry paths, removing the
inconsistency N4 flagged.

### Command re-run results

- `pnpm --filter @vixeq/core test` — 16 files, **249 tests passed** (248 + 1
  new `TL-013` non-object-`data` test; no regressions, no unexplained count
  change).
- `pnpm --filter @vixeq/core typecheck` — clean, no output.
- `pnpm --filter @vixeq/core build` — ESM/CJS/DTS all succeeded.
- `pnpm typecheck` (full workspace) — all 10 projects (`core`, `react`,
  `player-react`, `apps/playground`, all 6 examples) clean.

### Re-review verdict

**Approved.** The sole blocking issue (B1) is confirmed fixed by direct
code inspection and hand-tracing, with new test coverage (`TL-013`
non-object case) added exactly as recommended and passing. All four
non-blocking findings (N1-N4) are also fully resolved: the doc line no
longer misattributes throwing behavior, the six ambiguous matrix rows now
state the real `ok:false`/`TypeError` split, the two single-item normalize
helpers document their batch-collision caveat, and both `addTimelineTrack`/
`addTimelineEvent` now store trimmed ids consistently with the batch path.
No new regressions were introduced: `@vixeq/core` test/typecheck/build and
the full-workspace typecheck are all green, with the test count increasing
by exactly one (the new B1 regression test) and no other change in count or
failures.
