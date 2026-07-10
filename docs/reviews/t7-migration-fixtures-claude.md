# T7 Migration Fixtures Review

- Status: approved
- Task: T7 — Add v1-to-v2 migration fixtures and beta smoke tests
- Author: Codex
- Reviewer: Claude
- Normative contract: [`../plans/v1-collaboration-spec.md`](../plans/v1-collaboration-spec.md) §9 (Migration rules, T2/T4-implemented), §2 (0.8 vs 0.9 release-sequence split), §13 (Agent collaboration protocol)

## Scope

Adds reusable 0.8 v1-to-v2 migration fixtures and wires them into both core unit
tests and the packed beta smoke consumer:

- adds `fixtures/migration/v1-to-v2.json`
- verifies Timeline success, warning, and failure fixture paths in core tests
- verifies Arrangement success and failure fixture paths in core tests
- adds packed-consumer runtime smoke for `migrateTimelineProject()` and
  `migrateArrangementProject()`
- extends packed-consumer type smoke to cover public migration API types
- documents the 0.8 beta smoke checklist and fixture coverage

## Changed Files

- `docs/migrations/0.8-timeline-arrangement-v2.md`
- `docs/plans/v1-collaboration-spec.md`
- `docs/release/0.8-beta-checklist.md`
- `docs/reviews/t7-migration-fixtures-claude.md`
- `fixtures/migration/v1-to-v2.json`
- `fixtures/pack-smoke/consumer/src/core-migration.mjs`
- `fixtures/pack-smoke/consumer/src/types-smoke.tsx`
- `packages/core/src/arrangement/migration.test.ts`
- `packages/core/src/timeline/migration.test.ts`
- `scripts/pack-smoke.mjs`

## Review Focus

- Confirm `fixtures/migration/v1-to-v2.json` covers the intended minimum cases:
  Timeline success, Timeline removed-field warnings, Timeline invalid offset,
  Arrangement success, and Arrangement missing duration.
- Confirm core tests read the fixture directly and assert strict v2 validation of
  migrated output.
- Confirm `scripts/pack-smoke.mjs` copies the same fixture into the temporary
  consumer instead of publishing it in package tarballs.
- Confirm `fixtures/pack-smoke/consumer/src/core-migration.mjs` tests packed
  `@vixeq/core` runtime migration behavior through public APIs only.
- Confirm `types-smoke.tsx` exercises public migration types from the packed
  declarations.
- Confirm CI workflow changes remain deferred to R0-R2.

## Commands Run

- `pnpm --filter @vixeq/core test`
- `pnpm --filter @vixeq/core typecheck`
- `pnpm smoke:pack`
- `pnpm -r --no-bail typecheck`
- `pnpm -r --no-bail test -- run`
- `pnpm -r --no-bail build`

## Known Limitations

- No CI workflow was added; this is intentionally deferred to R0-R2.
- The migration fixture is a release/test fixture only. It is not included in
  public package tarballs.

---

## Review checklist

- [x] `fixtures/migration/v1-to-v2.json` contains exactly the five declared
      cases (`timeline.valid`, `timeline.removedFields`, `timeline.invalidOffset`,
      `arrangement.valid`, `arrangement.missingDuration`) and each one is
      hand-traced against the real `migrateTimelineProject`/
      `migrateArrangementProject` implementations (`packages/core/src/timeline/migration.ts`,
      `packages/core/src/arrangement/migration.ts`), not just against the prose
      contract:
      - `timeline.valid`: `timing.offsetMs: 250` (valid, non-negative) →
        `startPositionMs: 250`; `trackId: "global"` on `cue-global` → `null`;
        no removed fields anywhere → `warnings: []`. `options.durationBeats: 8`
        with both events inside `[0, 8)`. Matches `MIG-001`/`MIG-003`'s
        already-unit-tested behavior exactly.
      - `timeline.removedFields`: `automation` track's `type: "sequence"` →
        one `TIMELINE_TRACK_TYPE_DROPPED` warning; `gain-rise` event's
        `durationBeats: 2`/`value: 0.75` (no `onRemovedField` supplied by the
        test) → one `TIMELINE_EVENT_REMOVED_FIELD_DROPPED` warning. The
        fixture's `warningCodes` array names exactly these two codes, no more,
        no fewer — hand-traced the full function body to confirm no other
        branch could fire (the track has no other removed field, the event's
        `trackId: "automation"` is not `"global"`, `offsetMs: 0` is valid).
      - `timeline.invalidOffset`: `timing.offsetMs: -1` fails the
        `Number.isFinite(...) && offsetMs >= 0` guard →
        `TIMELINE_INVALID_OFFSET_MS`, and nothing else in this fixture (a
        valid `durationBeats: 4` option, an event with no removed fields)
        produces a second error — the fixture's single-element `errorCodes`
        array is exactly correct, not just a superset check happening to pass.
      - `arrangement.valid`: `bpm: 132` is inside `SEQUENCER_LIMITS`
        `[minBpm, maxBpm]`; `intro` pattern structurally passes
        `validateProject` (`stepCount: 4` matches its 4-entry `steps` array);
        section `intro-a` fits `[0, 4)` inside `options.durationBeats: 8`
        (`8 >= largestSectionEnd(4)`). Produces `timing: { tempos: [{beat:0,
        bpm:132}], startPositionMs: 0 }`, matching
        `createTimingMap({ bpm: source.bpm })`'s known behavior.
      - `arrangement.missingDuration`: identical valid v1 shape, but the
        fixture deliberately omits an `options` key entirely so the test can
        call `migrateArrangementProject(project)` with no second argument →
        `isFinitePositive(undefined)` is `false` → `ARRANGEMENT_DURATION_REQUIRED`,
        the fixture's sole declared error code.
      All five cases are real, minimal, and non-redundant; none silently
      relies on undocumented default behavior.
- [x] Both `packages/core/src/timeline/migration.test.ts` and
      `packages/core/src/arrangement/migration.test.ts` load the *same*
      committed file, not a copy or a hand-typed duplicate. Confirmed by
      reading the `readFileSync(new URL("../../../../fixtures/migration/v1-to-v2.json",
      import.meta.url), "utf8")` call in both files and independently
      recomputing the path arithmetic: from
      `packages/core/src/timeline/migration.test.ts`, `../../../../` climbs
      `timeline/ → src/ → core/ → packages/ → <repo root>`, landing exactly on
      `fixtures/migration/v1-to-v2.json` (identical depth from
      `packages/core/src/arrangement/migration.test.ts`, since `arrangement/`
      is a sibling of `timeline/`). Both files additionally keep their own
      pre-existing hand-built fixtures (`v1Project()` / `validV1()`) for the
      already-ID-tagged `MIG-00N` unit tests, and layer the new
      `describe("v1-to-v2 migration fixtures", ...)` blocks on top — the new
      tests don't replace or shadow the existing matrix-ID coverage.
- [x] For every fixture case that produces a migrated project
      (`timeline.valid`, `timeline.removedFields`, `arrangement.valid`), the
      corresponding test calls `validateTimelineProject(result.project).ok`
      or `validateArrangement(result.project).ok` and asserts `true` — i.e.
      migration output is round-tripped through the real strict v2 validator,
      not just spot-checked field-by-field. For the two `ok:false` cases
      (`timeline.invalidOffset`, `arrangement.missingDuration`) there is no
      migrated project to validate, which is correctly reflected by the tests
      asserting only on `errors`, not calling either validator.
- [x] `scripts/pack-smoke.mjs` copies the exact same fixture file
      (`path.join(rootDir, "fixtures", "migration", "v1-to-v2.json")`,
      `migrationFixturePath`, line 11) into the temporary consumer via
      `await cp(migrationFixturePath, path.join(consumerDir, "src",
      "migration-v1-to-v2.json"))` (line 201) — a plain filesystem copy into
      the *consumer's* `src/`, not into any package's own source tree that
      gets bundled into a tarball. Confirmed `packages/core/package.json`'s
      `"files"` array is `["dist", "README.md", "LICENSE"]` — `fixtures/` is
      neither inside `packages/core/` nor listed, so the fixture cannot leak
      into the published tarball through this or any other path. The new
      `"smoke:core-migration": "node src/core-migration.mjs"` script is wired
      into the combined `smoke` script (`smoke:core-esm && smoke:core-cjs &&
      smoke:core-migration && smoke:react-ssr && smoke:types && smoke:vite`),
      so it runs unconditionally as part of `pnpm smoke:pack`, not as an
      opt-in extra step.
- [x] `fixtures/pack-smoke/consumer/src/core-migration.mjs` imports only
      `migrateArrangementProject`, `migrateTimelineProject`,
      `validateArrangement`, `validateTimelineProject` from `"@vixeq/core"` —
      grepped the file for any relative/deep import (`grep -n "from \"\.\.\|from \"\./"`
      finds none beyond the fixture JSON read) — and exercises all five
      fixture cases end to end (success + `trackId` rewrite check, warning
      codes present, invalid-offset error codes present, arrangement success +
      `bpm`→`timing.tempos[0].bpm` check, missing-duration error code
      present), throwing on any assertion failure so a regression fails the
      whole `pnpm smoke:pack` run loudly rather than being silently ignored.
      Independently confirmed (see Verification method) that this script's
      `@vixeq/core` import resolves through the *packed tarball*, not the
      monorepo workspace source.
- [x] `fixtures/pack-smoke/consumer/src/types-smoke.tsx` imports
      `TimelineMigrationOptions`, `ArrangementMigrationOptions`,
      `TimelineProjectV1`, `ArrangementProjectV1` as types, plus
      `migrateTimelineProject`/`migrateArrangementProject`/
      `validateTimelineProject`/`validateArrangement` as values, all from
      `"@vixeq/core"`, and uses each of the four types to construct a
      literal that is passed into the corresponding migration function,
      whose `MigrationResult`-shaped return is then narrowed by `if
      (...migration.ok)` before being passed to the matching strict
      validator — this is a genuine type-level exercise of `MigrationResult`/
      `MigrationIssue`'s discriminated-union narrowing (`.ok` gates access to
      `.project` vs. `.errors`), not just an unused import. This file is
      compiled by the consumer's `"smoke:types": "tsc --noEmit"` script
      against the packed `.d.ts` declarations (see Verification method for
      the live, independently-rerun confirmation that this passes).
- [x] Confirmed live, not just by reading `pnpm pack`'s tarball-contents
      listing, that the temporary consumer's `@vixeq/core` resolves through
      the packed tarball at runtime: `.tmp/pack-smoke/consumer/package.json`'s
      `dependencies["@vixeq/core"]` is `"file:../tarballs/vixeq-core-0.7.0-beta.1.tgz"`,
      and `node_modules/@vixeq/core` is a symlink into
      `node_modules/.pnpm/@vixeq+core@file+tarballs+vixeq-core-0.7.0-beta.1.tgz/node_modules/@vixeq/core`
      — pnpm's per-dependency virtual store keyed by the tarball path, not a
      workspace `link:` alias to `packages/core`. Every import in
      `core-migration.mjs`/`types-smoke.tsx` genuinely runs against the built,
      packed public API surface.
- [x] `docs/release/0.8-beta-checklist.md` (new) accurately describes what
      T7 actually added: its "Required Local Gates" section lists exactly the
      four commands independently re-run below; its bullet "`@vixeq/core`
      v1-to-v2 Timeline and Arrangement migration APIs from the tarball,
      using `fixtures/migration/v1-to-v2.json`" matches the real
      `smoke:core-migration` step; and its "Deferred Release Gates" section
      correctly attributes API-diff CI to R0, coverage/behavior-matrix gates
      to R1, and compatibility matrices to R2 — matching the task table
      exactly (see next item). The "T0-T7 are `done`" precondition is
      forward-looking (T7 itself is `in_progress` pending this review), which
      is the expected, non-circular reading: the checklist describes what
      must be true *before publishing*, not a precondition of this review.
- [x] CI-workflow deferral to R0-R2 matches the spec's own release-sequence
      split, not just the task table's dependency arrows: §2's `0.8.0` bullet
      list includes "explicit v1-to-v2 migration APIs" (T2/T4, exercised by
      T7) with no CI-workflow bullet anywhere in the `0.8.0` section, while
      §2's `0.9.0` bullet list explicitly owns "API-difference CI,"
      "coverage and behavior-matrix gates," and "Node, React, TypeScript, and
      browser compatibility matrices" — i.e. R0/R1/R2's exact scope. `git
      diff --stat` and a direct `find .github/workflows -type f` (only the
      pre-existing, untouched `pages.yml`, last modified in an unrelated
      ancient commit) confirm no workflow file was added or modified by this
      change.
- [x] No scope creep beyond the declared Changed Files list. `git status
      --short` at the start of this review showed exactly: five tracked
      modifications (`docs/migrations/0.8-timeline-arrangement-v2.md`,
      `docs/plans/v1-collaboration-spec.md`, `fixtures/pack-smoke/consumer/src/types-smoke.tsx`,
      `packages/core/src/arrangement/migration.test.ts`,
      `packages/core/src/timeline/migration.test.ts`, `scripts/pack-smoke.mjs`)
      and four new untracked paths (`docs/release/0.8-beta-checklist.md`,
      `docs/reviews/t7-migration-fixtures-claude.md`, `fixtures/migration/`,
      `fixtures/pack-smoke/consumer/src/core-migration.mjs`) — an exact match
      for the review request's own "Changed Files" list (`docs/plans/v1-collaboration-spec.md`
      is the one file on the git-status list not itemized in the task's
      re-stated file list, but it *is* itemized in this review request's own
      "Changed Files" section; see the next item for what that diff actually
      contains). No file under `packages/core/src/**` other than the two
      `migration.test.ts` files, no `packages/react/`, no `packages/player-react/`,
      no `examples/` file, and no `.github/` file is touched.
- [x] The `docs/plans/v1-collaboration-spec.md` diff is exactly one line: the
      T7 task-table row's `Status`/`Owner` columns move from `pending`/`—` to
      `in_progress`/`Codex (author), Claude (review requested)` — pure
      collaboration-protocol bookkeeping (§13.2's "claim one work item...
      before implementation"), identical in kind to the same bookkeeping edit
      already established and approved in T2/T4/T6. It does not touch any
      other row, and per this task's own final instruction the task table is
      left as-is by this review (not further edited here) beyond what the
      author already recorded.
- [x] Independently re-ran every command the review request and the task's
      instructions asked for — see Verification method and Commands
      independently re-run below. All green, matching (or exceeding, where
      the workspace has grown since the request was written) the counts
      implied by a clean run.

## Verification method

Read `docs/plans/v1-collaboration-spec.md` §2 (release sequence), §9
(migration rules), and §13 (collaboration protocol) in full, then re-read
`docs/reviews/t2-timeline-project-claude.md`, `t4-arrangement-v2-claude.md`,
and `t6-website-pulse-claude.md` to match this review's checklist granularity
and verification rigor to the established precedent (in particular T6's
"confirm no undeclared change is bundled into the working tree" discipline).
Read `packages/core/src/timeline/migration.ts` and
`packages/core/src/arrangement/migration.ts` end to end (the T2/T4-approved,
unmodified-by-T7 implementations) before reading the fixture, then hand-traced
every one of the five fixture cases against the actual function bodies line by
line (documented in the checklist above) rather than trusting the review
request's own case descriptions. Read both `migration.test.ts` files, both new
pack-smoke consumer files, `scripts/pack-smoke.mjs`'s diff, and both doc
changes end to end.

**On "does the packed consumer really use the tarball, not workspace
source?"**: ran `pnpm smoke:pack` to completion first, then independently
inspected the resulting temporary workspace rather than trusting the script's
own success exit code alone: read `.tmp/pack-smoke/consumer/package.json`
(`"@vixeq/core": "file:../tarballs/vixeq-core-0.7.0-beta.1.tgz"`) and resolved
the `node_modules/@vixeq/core` symlink (`readlink`), which points into
pnpm's `.pnpm` virtual store keyed by the literal tarball file path — the same
mechanism pnpm uses for any external file-based dependency, structurally
incapable of quietly falling back to a workspace `link:` alias. Also
confirmed `packages/core/package.json`'s `"files"` field
(`["dist", "README.md", "LICENSE"]`) to rule out the fixture accidentally
riding along inside the published tarball via some other path.

**On the R0-R2 deferral:** compared spec §2's `0.8.0`/`0.9.0` bullet lists
side by side (quoted in the checklist above) rather than relying only on the
task table's dependency column, and separately ran `find .github/workflows
-type f` plus `git log --oneline -3 -- .github/workflows/` to confirm the
one existing workflow file (`pages.yml`) predates this task by many commits
and is untouched by it.

Independently re-ran every requested command:

- `pnpm --filter @vixeq/core test` — **19 files, 275 tests passed**, 0
  failures (6 more tests than T4's 269-test baseline: the accumulated T5/T6
  and this task's own fixture-driven tests).
- `pnpm --filter @vixeq/core typecheck` — clean, no output.
- `pnpm smoke:pack` — completed successfully end to end, including the new
  `smoke:core-migration` step (`node src/core-migration.mjs`, exit code 0,
  no thrown assertion) running between `smoke:core-cjs` and `smoke:react-ssr`
  in the combined `smoke` script, and `smoke:types` (`tsc --noEmit`, compiling
  `types-smoke.tsx` against the packed declarations) also passing, followed
  by `smoke:vite` and every `examples/*`/`apps/playground` packed-tarball
  build. Full log tail ends with "Pack smoke completed successfully."
- `pnpm -r --no-bail typecheck` (full workspace, 10 projects) — all report
  `Done`, no errors.
- `pnpm -r --no-bail test -- run` (full workspace) — every package passes or
  reports `--passWithNoTests` for packages with no test files (`packages/core`
  275, `packages/react` 33, `packages/player-react` 6, `apps/playground` 11,
  `examples/cycling-workout` 5; the remaining example packages have no test
  files, matching their existing, undisturbed state).
- `pnpm -r --no-bail build` (full workspace) — `packages/core`/`react`/
  `player-react` (`tsup` ESM/CJS/DTS) and every `examples/*`/`apps/playground`
  (`tsc --noEmit && vite build`) succeed with no errors.
- `git status --short` (re-run at the end of this review, after all the above
  commands) — unchanged from the start-of-review snapshot: no stray
  `.tgz`/`.tmp` artifact or test byproduct leaked into the tracked working
  tree (`.tmp/` is gitignored and the script `rm -rf`s it at the start of each
  run).

## Findings

No blocking findings.

### N1 (non-blocking) — the fixture-driven "Timeline/Arrangement success" tests don't assert `warnings` is empty

**Files:** `packages/core/src/timeline/migration.test.ts` (the "migrates the
reusable Timeline success fixture into strict v2 output" test);
`packages/core/src/arrangement/migration.test.ts` (the "migrates the reusable
Arrangement success fixture into strict v2 output" test).

Both tests use `toMatchObject({...})` to assert specific fields of the
migrated project and then call the strict validator, but neither asserts
`result.warnings` (Timeline) is empty, and the Arrangement migration function
always returns `warnings: []` unconditionally (`migration.ts:216`) with no
test pinning that contract either. This means a future change that
accidentally attaches a spurious warning to an input that should be
warning-free (for example, a regression in the `hasRemovedFields` detection
that fires on the Timeline success fixture's clean data) would not be caught
by these two specific fixture tests — though it likely would be caught by
`MIG-003`'s existing, unit-level "no warning" assertion for the `"global"`
rewrite case specifically, just not by the fixture-level test that exists to
mirror the packed-consumer smoke's exact same success-path assertions.

**Failure scenario:** a hypothetical future edit to `migrateEvent`'s
`hasRemovedFields` check that widens too far (e.g. treating an unrelated
field as "removed") would still pass both fixture "success" tests as long as
the specific fields under `toMatchObject` remain correct, silently shipping
an unwanted extra warning.

**Fix (not applied by this review, non-blocking):** add
`expect(result.warnings).toHaveLength(0)` (Timeline) and
`expect(result.project.warnings ?? result.warnings).toHaveLength(0)` — or
simply `expect(result.warnings).toEqual([])` (Arrangement) — to each of the
two "success fixture" tests.

## Final verdict

**Approved.** Every one of the five requested verification points holds up
under independent, line-by-line tracing against the actual T2/T4-approved
migration implementations, not just against the review request's own
descriptions:

1. `fixtures/migration/v1-to-v2.json`'s five cases are minimal, non-redundant,
   and each one's expected `warnings`/`errors` were hand-derived from
   `migrateTimelineProject`/`migrateArrangementProject`'s real branches, not
   copied from the fixture's own claims.
2. Both `migration.test.ts` files load this exact committed file via
   `readFileSync` (path arithmetic independently recomputed) and round-trip
   every successful migration result through `validateTimelineProject`/
   `validateArrangement`, asserting `ok: true` on the real strict v2
   validator — not a hand-rolled shape check.
3. `pnpm smoke:pack` genuinely copies the same fixture file into the
   temporary consumer and exercises `@vixeq/core`'s public migration API
   through a dependency that resolves, confirmed via `node_modules` symlink
   inspection, to the packed tarball's pnpm virtual store — not workspace
   source — and the run completed successfully end to end when independently
   re-executed.
4. `types-smoke.tsx` exercises all four public migration types
   (`TimelineMigrationOptions`, `ArrangementMigrationOptions`,
   `TimelineProjectV1`, `ArrangementProjectV1`) plus the `MigrationResult`
   discriminated-union narrowing pattern, compiled against the packed `.d.ts`
   output by the consumer's own `smoke:types` script, independently
   confirmed green.
5. The CI-workflow deferral to R0-R2 matches spec §2's explicit `0.8.0`
   (implementation) vs. `0.9.0` (release-readiness gates) split, not just the
   task table's dependency arrows, and `.github/workflows/` is confirmed
   untouched.

No scope creep: the working tree's diff is exactly the declared Changed Files
list, including the single-line `v1-collaboration-spec.md` task-table
bookkeeping edit (identical in kind to T2/T4/T6's own approved precedent). All
six requested commands were independently re-run from a clean state and are
green: `pnpm --filter @vixeq/core test` (19 files, 275 tests),
`pnpm --filter @vixeq/core typecheck`, `pnpm smoke:pack` (including the new
`smoke:core-migration`/updated `smoke:types` steps), `pnpm -r --no-bail
typecheck` (10 projects), `pnpm -r --no-bail test -- run`, and `pnpm -r
--no-bail build`.

The single finding (N1: the two fixture-driven "success" tests don't pin
`warnings` to empty) is minor, non-blocking, and does not need to be resolved
before marking T7 `done` — it may be addressed at the author's discretion in
this or a later pass.

## N1 resolution

Fixed in the same pass (Claude): added `expect(result.warnings).toEqual([])`
to both the Timeline and Arrangement "success fixture" tests
(`packages/core/src/timeline/migration.test.ts`,
`packages/core/src/arrangement/migration.test.ts`). Re-ran
`pnpm --filter @vixeq/core test`: 19 files, 275 tests pass (same count as
before — assertions added to existing tests, no new test cases), no
regressions.
