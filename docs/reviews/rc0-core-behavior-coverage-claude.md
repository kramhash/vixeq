# RC0 Core behavior and coverage follow-up review

- Status: approved
- Author: Codex
- Reviewer: Claude
- Scope: Close the remaining planned behavior-matrix rows that can be verified
  against existing Core behavior, and record the still-open Core coverage gate
  gap before `1.0.0-rc.1`.

## Changed files

- `docs/plans/v1-collaboration-spec.md`
- `docs/behavior/playback-v2-matrix.md`
- `docs/behavior/timeline-arrangement-v2-matrix.md`
- `packages/core/src/SequencerEngine.test.ts`
- `packages/core/src/arrangement/ArrangementEngine.test.ts`
- `packages/core/src/arrangement/migration.test.ts`
- `packages/core/src/arrangement/project.test.ts`
- `packages/core/src/audioClock.test.ts`
- `packages/core/src/envelope.test.ts`
- `packages/core/src/playbackTransport.test.ts`
- `packages/core/src/project.test.ts`
- `packages/core/src/timeline/TimelineEngine.test.ts`
- `packages/core/src/timeline/migration.test.ts`
- `packages/core/src/timeline/project.test.ts`
- `packages/core/src/timeline/timing.test.ts`
- `packages/core/src/smoothing.test.ts`
- `packages/core/src/validation.test.ts`
- `docs/reviews/rc0-core-behavior-coverage-claude.md`

## Review focus

- Confirm the new test IDs genuinely cover the behavior-matrix rows changed
  from `planned` to `covered`.
- Confirm `PB-CH-008` is acceptable as a shared ChannelSource/Arrangement
  coverage row rather than Sequencer-specific behavior.
- Confirm the new `RC0` task-table row is the right place to track the remaining
  Core coverage gate work.
- Confirm no implementation behavior was silently changed.
- Confirm the public-behavior coverage slice tests exercise user-visible
  transport/Engine states rather than testing private implementation details.
- Confirm the validation and normalization coverage slice is still testing
  public helpers and documented input contracts, not overfitting to internals.
- Confirm the migration/timing/utility coverage slice exercises public
  boundary behavior and does not introduce production-only coverage hacks.

## Commands run

- `pnpm --filter @vixeq/core exec vitest run src/SequencerEngine.test.ts src/arrangement/ArrangementEngine.test.ts`
- `pnpm --filter @vixeq/core exec vitest run src/SequencerEngine.test.ts src/arrangement/ArrangementEngine.test.ts src/timeline/TimelineEngine.test.ts src/audioClock.test.ts`
- `pnpm --filter @vixeq/core exec vitest run src/timeline/project.test.ts src/arrangement/project.test.ts src/project.test.ts src/validation.test.ts`
- `pnpm --filter @vixeq/core exec vitest run src/playbackTransport.test.ts src/timeline/timing.test.ts src/timeline/migration.test.ts src/arrangement/migration.test.ts`
- `pnpm --filter @vixeq/core exec vitest run src/timeline/timing.test.ts src/smoothing.test.ts src/envelope.test.ts src/playbackTransport.test.ts src/timeline/migration.test.ts src/arrangement/migration.test.ts`
- `pnpm --filter @vixeq/core exec vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`
- `pnpm behavior:check`
- `pnpm test:coverage`
- `pnpm test`
- `pnpm typecheck`

## Results

- Focused Core tests passed: 98 tests.
- Focused validation/normalization tests passed: 74 tests.
- Focused migration/timing/utility tests passed: 105 tests.
- Behavior matrix now reports `191 covered, 0 planned, 0 blocked`.
- Public-behavior, validation, and migration/timing/utility slices increased
  Core branch coverage from `79.32%` to above the global `90%` threshold
  (`90.10%` in `pnpm test:coverage`; `90.11%` in the JSON summary).
- Core unit tests passed: 335 tests.
- Full workspace unit tests passed: 395 tests.
- Workspace typecheck passed.

## Known expected failures

- `pnpm test:coverage` still fails on the remaining critical-file thresholds,
  not on the global Core branch threshold. The still-failing branch thresholds
  are `src/playbackTransport.ts` (`98.43%`), `src/SequencerEngine.ts`
  (`86.14%`), `src/arrangement/ArrangementEngine.ts` (`86.43%`),
  `src/timeline/TimelineEngine.ts` (`87.44%`), and
  `src/arrangement/migration.ts` (`98.24%`). This change closes
  behavior-matrix planned rows and clears the global Core 90% branch gate; it
  does not complete the configured 100%-branch critical-file gate.

## Independent review findings (Claude)

**Verification performed** (all reproduced independently, not taken on
faith):

- `pnpm behavior:check` → `191 covered, 0 planned, 0 blocked`, matches.
- `pnpm typecheck` → all 13 workspace projects pass.
- `pnpm test` → 395 tests pass across the workspace
  (`packages/core` 335, `packages/react` 36, `packages/player-react` 8,
  `apps/playground` 11, `examples/cycling-workout` 5), matches.
- `pnpm --filter @vixeq/core exec vitest run --coverage` → global Core
  branch coverage `90.1%`, and the exact same five critical-file branch
  percentages as reported above. `src/timeline/timing.ts` and
  `src/timeline/migration.ts` are both at `100%` branches, confirming the
  spec-text edit that dropped them from the list of remaining gaps is
  accurate.
- Confirmed via `git diff --stat` that no `packages/*/src/**/*.ts` file
  outside `*.test.ts` changed — this is a test/docs-only change.

**PB-CH-008 as an Arrangement-side coverage row**: accepted. Read
`packages/core/src/SequencerEngine.ts` `setProject` — it always remaps the
cached position by proportional beat scaling
(`preservedBeat * getMsPerBeat(nextProject)`), which is continuous by
construction and never exceeds the new project's bounds. Grepping
production code for `"project-change"` shows it is only emitted from
`ArrangementEngine.ts` (the hot-swap forced-reposition path);
`SequencerEngine.ts` has no code path that emits it. So the "Project-shortening
reposition" scenario in `playback-v2.md` section 5 ("Forced position change
caused by Project shortening emits one destination step with
`cause: "project-change"`") is structurally an Arrangement-only behavior —
testing it anywhere other than `ArrangementEngine.test.ts` would be
impossible, not just stylistically preferable. Tagging the same assertion
with both `PB-CH-008` and `AR-011` also matches this repo's existing
convention of one test satisfying multiple matrix IDs that describe the same
observable behavior from different documents (e.g. the pre-existing
`PB-TR-026 PB-EN-019 PB-EN-026` and `PB-TR-027 PB-EN-027` test names in
`SequencerEngine.test.ts`). The shortened-arrangement test itself computes
correctly: beat 5 with the new 2-beat looping duration wraps to beat 1 via
modulo, landing on `intro` step 1, which is exactly what the test asserts.

**Matrix ID ↔ test correspondence**: spot-checked every row flipped from
`planned` to `covered` in both matrices (`PB-TR-026`, `PB-TR-027`,
`PB-EN-018A`, `PB-CH-002`, `PB-CH-005`–`PB-CH-009`, `AR-011`) against the
test bodies. All match their stated scenario and expected result, including
the two rows satisfied by renaming pre-existing tests
(`PB-TR-026`/`PB-TR-027`) rather than adding new ones — both pre-existing
tests already asserted exactly the described behavior (second Engine stays
active/playing after the first disposes; an Engine attached to an
already-playing transport emits no synthetic step for elapsed steps), so
tagging them was accurate, not a stretch.

**Public-boundary vs. implementation-detail coverage**: the new tests in
`SequencerEngine.test.ts`, `ArrangementEngine.test.ts`, and
`TimelineEngine.test.ts` exercise constructor validation, `on()`,
`sampleChannels`/`sampleChannelsAt`, `setProject`/`setArrangement`,
`setLoop`, transport-mapped events, listener-error isolation (including the
`globalThis.reportError` fallback path), and disposal — all through the
documented public Engine/`ChannelSource`/`PlaybackTransport` surface. The
validation/normalization tests (`validation.test.ts`,
`timeline/project.test.ts`, `arrangement/project.test.ts`,
`timeline/timing.test.ts`) and migration tests
(`arrangement/migration.test.ts`, `timeline/migration.test.ts`) exercise only
exported functions (`validateProject`, `normalizeProject`,
`normalizeTimelineTrack`, `normalizeTempoEvent`, `migrateArrangementProject`,
etc., all confirmed exported from their package `index.ts`) with
black-box malformed-input assertions on documented error codes/paths. None
of the new tests reach into private fields or unexported helpers. No
coverage-hack patterns (e.g. asserting on internal call counts with no
behavioral consequence) were found.

**Coverage-status framing in the spec**: the updated paragraph in the
coverage-gates section accurately reflects the measured state — global 90%
branch gate cleared, five critical-file 100% gates still open, and the
now-implicit claim that `timing.ts`/`timeline/migration.ts` no longer have
gaps is correct. No stale "six 100%-tier files" wording remains elsewhere in
the document.

**RC0 task-table row and handoff quality**: the row and review file follow
protocol rule 11 (`docs/plans/v1-collaboration-spec.md` §13) — a
`review_requested` review file with scope, changed files, review focus,
commands run, and known expected failures was created before handoff. The
review file's known-expected-failures list is precise enough (file + exact
branch %) for a follow-up agent to locate the gaps via
`pnpm --filter @vixeq/core exec vitest run --coverage` without re-deriving
anything. Minor, non-blocking nit: the `RC0` row's `Owner` cell reads
`Codex` rather than `Codex (author)`, breaking from every other row's
`Name (role)` convention while `in_progress`; harmless since the row isn't
`done` yet, but worth fixing when this row closes.

**Verdict**: Approved. No changes requested. Recommend updating the `RC0`
task-table row's `Status` to `done` and `Owner` to
`Codex (author), Claude (reviewer)` now that this review is complete.

- Status: approved
- Reviewer: Claude
