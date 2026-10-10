# RC1A critical coverage review

- Status: approved
- Author: Codex
- Reviewer: Claude
- Scope: Close the RC1A 100% branch-coverage gaps for
  `PlaybackTransport` and Arrangement migration before wiring the full
  coverage gate into CI.

## Changed files

- `docs/plans/v1-collaboration-spec.md`
- `packages/core/src/playbackTransport.ts`
- `packages/core/src/playbackTransport.test.ts`
- `packages/core/src/arrangement/migration.ts`
- `docs/reviews/rc1a-critical-coverage-claude.md`

## Review focus

- Confirm the new `PlaybackTransport` tests exercise public behavior through
  the transport API and listener notification surface.
- Confirm the removed `settlePlayingPosition()` guard was unreachable through
  public API calls because every caller already requires `state === "playing"`.
- Confirm the removed Arrangement migration `validateArrangement(project)`
  fallback was unreachable after successful v1 validation and deterministic
  v2 construction.
- Confirm no public behavior or API surface changed.
- Confirm RC1A's two targeted critical files now report 100% branch coverage.

## Commands run

- `pnpm --filter @vixeq/core exec vitest run src/playbackTransport.test.ts src/arrangement/migration.test.ts`
- `pnpm --filter @vixeq/core test:coverage`
- `pnpm --filter @vixeq/core test`
- `pnpm --filter @vixeq/core typecheck`
- `pnpm --filter @vixeq/core build`

## Results

- Focused RC1A tests passed: 41 tests.
- Core unit tests passed: 338 tests.
- Core typecheck passed.
- Core build passed.
- In `pnpm --filter @vixeq/core test:coverage`, RC1A targets now report:
  - `src/playbackTransport.ts`: 100% branches.
  - `src/arrangement/migration.ts`: 100% branches.

## Known expected failures

- `pnpm --filter @vixeq/core test:coverage` still exits 1 because the later
  RC1B-RC1D Engine thresholds remain open:
  - `src/SequencerEngine.ts`: 86.14% branches.
  - `src/arrangement/ArrangementEngine.ts`: 86.43% branches.
  - `src/timeline/TimelineEngine.ts`: 87.44% branches.

## Independent review findings (Claude)

**Verification performed** (all reproduced independently):

- `pnpm --filter @vixeq/core exec vitest run src/playbackTransport.test.ts src/arrangement/migration.test.ts`
  → 41 tests pass, matches.
- `pnpm --filter @vixeq/core test` → 338 tests pass, matches.
- `pnpm --filter @vixeq/core typecheck` and `pnpm --filter @vixeq/core build`
  → pass.
- `pnpm --filter @vixeq/core test:coverage` → `playbackTransport.ts`,
  `arrangement/migration.ts`, `timeline/migration.ts`, and `timeline/timing.ts`
  all report 100% branches; Core global branch coverage is 90.29%. The run
  exits 1 only on the three expected RC1B-RC1D Engine thresholds
  (`SequencerEngine.ts` 86.14%, `ArrangementEngine.ts` 86.43%,
  `TimelineEngine.ts` 87.44%), exactly as listed above.
- `pnpm api:check` → all reports up to date (`core.api.md` and
  `core-dom.api.md` unchanged). `pnpm behavior:check` → 191 covered,
  0 planned, 0 blocked.

**Removed `settlePlayingPosition()` guard**: accepted as unreachable. The
helper has five call sites in `createClockTransport` — `handleBoundary()`
(guarded by `disposed || state !== "playing"`), `pause()` (guarded by
`state !== "playing"`), and `stop()`, `setPlaybackRate()`, `setLoop()` (each
`if (state === "playing") settlePlayingPosition()`). `dispose()` uses
`readPlayingPosition()` instead. No public call path can reach the helper in a
non-playing state, and `pause()` keeps its post-settle re-check for the
`ended` transition, so behavior is unchanged.

**Removed Arrangement migration `validateArrangement(project)` fallback**:
accepted as unreachable. Compared `validateV1Arrangement` against
`validateArrangement` rule by rule: v1 BPM uses the same
`SEQUENCER_LIMITS` bounds that `validateTimingMap` enforces, and
`createTimingMap({ bpm })` builds a single beat-0 tempo with
`startPositionMs: 0`; pattern validation calls the same `validateProject`;
section id/patternId/startBeat/endBeat/overlap checks are equivalent; the
v2-only `endBeat <= durationBeats` rule is guaranteed by the
`ARRANGEMENT_DURATION_TOO_SHORT` check; `version: 2` and the absence of
`bpm` hold by construction. The removed `ARRANGEMENT_V2_INVALID` code is not
referenced anywhere else in the repository (docs, API reports, or tests).
The v1/v2 rule-drift risk the fallback guarded against remains covered at the
test level: `migration.test.ts` already asserts
`validateArrangement(result.project).ok` on successful migrations (lines 44
and 180).

**New tests**: the duration, `console.error` fallback, and
no-reporting-surface tests drive only `createClockTransport`,
`getDurationMs()`, `subscribe()`, and `play()`, with global stubs restored in
`finally`. No private internals are touched, consistent with the spec §10 RC1
rule.

**Spec §10 RC1 rule**: deleting dead production branches is neither a
threshold reduction nor a coverage exclusion, so no new approved decision is
required. Non-blocking note for RC1B-RC1D: if more unreachable branches are
removed instead of covered, keep recording the call-site argument in the
review file as done here.

**Verdict**: Approved. No changes requested. The `RC1A` task-table row is
updated to `done` with `Codex (author), Claude (reviewer)`.

- Status: approved
- Reviewer: Claude
