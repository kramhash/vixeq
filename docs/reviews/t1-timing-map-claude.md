# T1 TimingMap v2 Implementation — Review

- Reviewer: Claude (review agent)
- Author: Claude
- Status: approved
- Normative contract: [`../behavior/timeline-arrangement-v2.md`](../behavior/timeline-arrangement-v2.md) §1
- Matrix: [`../behavior/timeline-arrangement-v2-matrix.md`](../behavior/timeline-arrangement-v2-matrix.md) (`TM-*`)

## Scope

Implement TimingMap v2 per the frozen T0 contract: rename `offsetMs` to
`startPositionMs`, add a strict `validateTimingMap()` that throws
`TypeError`/`RangeError`, and remove the implicit `normalizeTimingMap()` call
from inside `beatToMs`/`msToBeat` so those become pure functions of the
`TimingMap` they are given. No `TimelineProject`/`ArrangementProject` v2
schema work (T2/T4) and no wiring of the validator into Project/Engine
construction (T2/T4) — those are separate task-table items.

## Changed files

- `packages/core/src/timeline/types.ts` — field/option rename
- `packages/core/src/timeline/timing.ts` — rename, new `validateTimingMap`, purified conversions
- `packages/core/src/timeline/index.ts` — export `validateTimingMap`
- `packages/core/src/timeline/timing.test.ts` (new) — `TM-001`..`TM-016`
- `packages/core/src/timeline/timeline.test.ts` — remove the migrated "timeline timing" block
- `docs/api/core.md` — one-line mention of `validateTimingMap`/`startPositionMs`
- `docs/behavior/timeline-arrangement-v2-matrix.md` — `TM-*` rows `planned` -> `covered`
- `docs/plans/v1-collaboration-spec.md` — task table T1 status/owner

## Review focus

- `validateTimingMap()` matches T0 §1's frozen behavior exactly: throws
  (never repairs), correct `TypeError` vs `RangeError` split, matches the
  existing throw-message convention (`SequencerEngine.ts`/`arrangement/project.ts`).
- `beatToMs`/`msToBeat` no longer call `normalizeTimingMap()` internally and
  produce identical results to before for already-normalized input.
- `createTimingMap`/`normalizeTimingMap` still repair (never throw) and now
  produce `startPositionMs`.
- The `offsetMs` -> `startPositionMs` rename is complete and consistent across
  `types.ts`, `timing.ts`, and every test literal — no stray `offsetMs`
  reference remains anywhere in the repo.
- Every `TM-*` matrix row has a corresponding test, named with its ID, and is
  flipped to `covered` only where a real test exists.
- No T2+/T4+ scope (TimelineProject/ArrangementProject schema, validator
  wiring into construction) leaked into this change.

## Commands run

- `pnpm --filter @vixeq/core test` — 14 files, 203 tests passed (includes 16 new `TM-*` tests in `timing.test.ts`).
- `pnpm --filter @vixeq/core typecheck` — clean.
- `pnpm --filter @vixeq/core build` — ESM/CJS/DTS all succeeded.
- `pnpm typecheck` (full workspace) — all 10 projects (core, react, player-react, apps/playground, all examples) typecheck clean; confirms the `offsetMs` -> `startPositionMs` rename has no consumers outside `packages/core/src/timeline/`.
- `grep -rn 'offsetMs'` across the repo — only match remaining is inside `docs/migrations/0.8-timeline-arrangement-v2.md`'s intentional before/after example text (not live code).

## Known expected failures

None expected.

## Review checklist

- [x] `validateTimingMap()` matches T0 §1's frozen behavior exactly: throws
      (never repairs), correct `TypeError` vs `RangeError` split, matches the
      existing throw-message convention. Verified every branch by reading
      `timing.ts` line-by-line against contract §1: `tempos` non-array ->
      `TypeError`; empty `tempos` -> `RangeError`; non-object tempo entry ->
      `TypeError`; `beat`/`bpm` wrong-typed -> `TypeError`; non-finite
      `beat`/`bpm`/`startPositionMs` -> `RangeError` (not silently accepted
      by the type check, see Verification method); first-tempo-not-0,
      non-increasing/duplicate beats, out-of-range `bpm`, negative
      `startPositionMs` -> `RangeError`. Message style (`"X must be a
      finite, non-negative number."`, `"X must be an object."`) matches
      `SequencerEngine.ts`/`SequencerEngine.ts:103`.
- [x] `beatToMs`/`msToBeat` no longer call `normalizeTimingMap()` internally
      and produce identical results to before for already-normalized input.
      Confirmed by diff (both `normalizeTimingMap()` call sites removed) and
      by hand-tracing `beatToMs`/`msToBeat` against `TM-012`/`TM-013`/`TM-014`.
      No internal caller outside `timing.ts`/`timing.test.ts` exists yet
      (`grep beatToMs\|msToBeat` — no `SequencerEngine`/`ArrangementEngine`
      consumer), so removing the implicit repair has no behavior-change
      blast radius in this change.
- [x] `createTimingMap`/`normalizeTimingMap` still repair (never throw) and
      now produce `startPositionMs`. Confirmed: both functions only clamp/
      default/synthesize, never throw, and the returned object shape uses
      `startPositionMs` throughout.
- [x] The `offsetMs` -> `startPositionMs` rename is complete and consistent
      across `types.ts`, `timing.ts`, and every test literal. `grep -rn
      offsetMs` (re-run independently) confirms no live-code reference
      remains; all repo-wide matches are in prose docs (contract, migration
      guide, spec, ROADMAP checklist, review docs) — see N1 for one
      overstated wording in this review file's own "Commands run" section.
- [x] Every `TM-*` matrix row has a corresponding test, named with its ID,
      and is flipped to `covered` only where a real test exists. All 16
      `TM-001`..`TM-016` rows have a same-ID test in `timing.test.ts` whose
      assertions match the row's "Expected result" column (spot-checked
      `TM-005`, `TM-011`, `TM-014` in depth; see Verification method).
- [x] No T2+/T4+ scope leaked into this change. `git diff --stat` shows only
      `packages/core/src/timeline/{types,timing,index,timeline.test}.ts` (+
      new `timing.test.ts`) and docs/task-table bookkeeping; no
      `arrangement/`, `project.ts`, `SequencerEngine.ts`, or Engine/Project
      construction-path file is touched, and `validateTimingMap` has no
      caller yet anywhere in `packages/core/src` outside its own module and
      tests.

## Verification method

Read `docs/plans/v1-collaboration-spec.md` §5 and §13, the frozen contract
`docs/behavior/timeline-arrangement-v2.md` §1, and the `TM-*` rows of
`docs/behavior/timeline-arrangement-v2-matrix.md`. Read every changed file in
full (`types.ts`, `timing.ts`, `index.ts`, `timing.test.ts`,
`timeline.test.ts`) and diffed each against the pre-T1 commit (`264f6a6`)
with `git diff`/`git status` to see exactly what T1 changed versus what T0
left behind.

Traced `validateTimingMap()` branch-by-branch for the type-vs-range split
that the task explicitly flagged as a risk (NaN/Infinity sneaking past the
`typeof` check): for `tempo.beat`, `tempo.bpm`, and `startPositionMs`, the
`typeof x !== "number"` check runs first and is satisfied by `NaN` and
`Infinity` (both have `typeof === "number"` in JS), so control correctly
falls through to the `Number.isFinite(...)` guard immediately below, which
throws `RangeError` — confirmed this is not a silent pass-through, and
confirmed `timing.test.ts` exercises this exact interaction (`TM-009`'s
`nonFinite` bpm case, `TM-010`'s `Number.POSITIVE_INFINITY` startPositionMs
case).

Hand-traced `normalizeTempos()`'s repair path against `TM-005`'s input
(`[{8,100},{0,120},{4,90},{4,60}]`): the new code sorts only by `beat` (the
old code's `.sort((a, b) => a.beat - b.beat || a.bpm - b.bpm)` secondary key
was removed), relying on `Array.prototype.sort` stability — guaranteed by
the ECMA-262 spec since ES2019 and honored by V8/Node, so this is not an
engine-dependent assumption. Stable-sorting `[{8,100},{0,120},{4,90},{4,60}]`
by `beat` alone yields `[{0,120},{4,90},{4,60},{8,100}]` (the two `beat: 4`
entries keep their original relative order, `90` before `60`, since neither
compares less-than the other). The dedupe loop then keeps the first-seen
entry per beat and drops the rest, producing
`[{0,120},{4,90},{8,100}]` — matching the test's assertion that beat `4`'s
surviving `bpm` is `90`. The claim "keeps the first element in stable-sorted
order" is correct.

Hand-traced `beatToMs`/`msToBeat` segment accumulation against `TM-012`/
`TM-013` (single-tempo and two-segment cases, including the boundary
`beat === nextTempo.beat` case) and got the same numbers the tests assert
(1250, 2000, 3000), confirming the loop logic is unchanged from before
(only the `normalizeTimingMap()` wrapper was removed).

Compared `timing.test.ts`'s 16 tests individually against their matrix row's
"Expected result" text; none is a name-only stub — each asserts the
specific numeric/throw/type behavior the row describes. `TM-011`
(TypeError) covers three of the documented wrong-typed-field cases
(`tempos` not an array, `beat` not a number, `startPositionMs` not a
number) but not every possible wrong-typed field (e.g. `bpm` wrong-typed,
a non-object `timing` itself, a non-object array element) — see N2.

Confirmed `timeline.test.ts` no longer imports or exercises
`beatToMs`/`createTimingMap`/`msToBeat` (the migrated "timeline timing"
block was deleted, not just edited) and its remaining two `describe` blocks
use `{ bpm: 120 }` timing options, never touching `offsetMs`/
`startPositionMs` directly.

Ran the full command set the task asked for:

- `pnpm --filter @vixeq/core test` — 14 files, 203 tests passed, matching the
  review doc's claim exactly.
- `pnpm --filter @vixeq/core typecheck` — clean.
- `pnpm --filter @vixeq/core build` — ESM/CJS/DTS all succeeded.
- `pnpm typecheck` (full workspace) — all 10 projects clean.
- `grep -rn offsetMs` across the repo (re-run independently of the author) —
  matches only in `ROADMAP.md` (an unchecked 0.8.0 checklist bullet
  describing the rename as a to-do item, not live code), the frozen
  contract and spec prose describing the rename rule itself, the T0/T1
  review docs, and the migration guide's intentional before/after example —
  no match inside any `.ts` source or test file.

## Non-blocking findings

### N1 — Review doc's own "Commands run" grep summary is slightly overstated

This file's "Commands run" section states the only remaining `offsetMs`
match is inside `docs/migrations/0.8-timeline-arrangement-v2.md`'s
before/after example. An independent `grep -rn offsetMs` also finds it in
`ROADMAP.md:197` (an unchecked 0.8.0 checklist bullet), plus expected
self-references in `docs/plans/v1-collaboration-spec.md` §5, this task's own
review file, and the T0 review file. None of these are stray/live-code
references — they are all prose describing the rename rule or a not-yet-
completed roadmap item — so this does not affect the rename's correctness.
Purely a wording nit in the review file's self-report; consider rephrasing
to "no reference in live code; remaining prose matches are intentional"
rather than naming a single file.

### N2 — `TM-011` does not exercise every wrong-typed-field case named in the contract

Contract §1 says `validateTimingMap()` throws `TypeError` "for wrong-typed
fields" in general; the implementation correctly type-checks `tempos`
(array), each tempo entry (object), `beat` (number), `bpm` (number), and
`startPositionMs` (number). `TM-011` only exercises three of these
(`tempos` not an array, `beat` not a number, `startPositionMs` not a
number). It does not test a wrong-typed `bpm`, a non-object `timing` itself
(e.g. `null`/array/primitive), or a non-object tempo array element (e.g.
`tempos: [42]`) — all of which the code already handles correctly (verified
by inspection above), so this is a test-coverage gap rather than an
implementation bug. Consider adding these cases to `TM-011` for full
branch coverage, but it does not block sign-off since the matrix row's
literal requirement ("wrong-typed field -> throws TypeError") is satisfied
by the existing assertions and the implementation itself is correct.

## Final verdict

**Approved.** The `offsetMs` -> `startPositionMs` rename is complete and
consistent across `types.ts`, `timing.ts`, `index.ts`, and every test
literal, with no stray reference in live code anywhere in the repo.
`validateTimingMap()` implements T0 §1's frozen contract exactly: it never
repairs, and its `TypeError`/`RangeError` split is correct in every branch,
including the specific risk this review was asked to check closely — `NaN`
and `Infinity` pass the `typeof === "number"` check but are correctly
caught by the subsequent `Number.isFinite()` guard and raise `RangeError`,
not silently accepted. `beatToMs`/`msToBeat` are now pure functions of the
given `TimingMap` (the internal `normalizeTimingMap()` calls were removed
from both), produce identical numeric results to the pre-change behavior
for already-normalized input (hand-traced against `TM-012`/`TM-013`), and
have no internal caller anywhere in the package yet, so purifying them has
no behavior-change blast radius. `normalizeTempos()`'s "stable sort keeps
the first duplicate" claim is correct and matches actual
`Array.prototype.sort` stability semantics (guaranteed since ES2019). All
16 `TM-001`..`TM-016` tests genuinely exercise their row's documented
behavior rather than being name-only stubs. `timeline.test.ts`'s remaining
tests were correctly left untouched aside from removing the migrated timing
block, and do not reference `offsetMs`. No `TimelineProject`/
`ArrangementProject` v2 schema work or validator-wiring-into-construction
(T2/T4 scope) leaked into this change — confirmed by diff scope and by
`validateTimingMap` having no caller yet. `pnpm --filter @vixeq/core test`
(14 files / 203 tests), `typecheck`, and `build` all pass, matching the
review doc's reported results exactly on independent re-run, as does the
full-workspace `pnpm typecheck` across all 10 projects.

Two non-blocking nits are recorded for optional follow-up (N1: a
self-report wording overstatement in this file, N2: `TM-011` could add a
few more wrong-typed-field cases for full branch coverage) — neither
affects correctness of the shipped implementation. T1 may be marked `done`
in the task table.
