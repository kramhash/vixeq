# T8 Stable Release Review

- Status: approved
- Task: T8 — Promote 0.8.0 stable release docs and package versions
- Author: Codex
- Reviewer: Claude
- Normative contract: [`../plans/v1-collaboration-spec.md`](../plans/v1-collaboration-spec.md) §2 (release sequence: 0.8.0 uses "the same beta-to-stable process as 0.7"), §13 (agent collaboration protocol, item 6: "publish is not marked complete until npm registry smoke passes" and item 10: stop and record a decision on spec conflicts rather than silently choosing new behavior)

## Scope

Prepares the 0.8 release line for stable publication:

- bumps root and public package versions from `0.8.0-beta.1` to `0.8.0`
- updates Core and React READMEs to use Arrangement v2 `timing` and
  `durationBeats`
- updates Core API docs for Arrangement v2 migration and TimelineEngine
  non-`ChannelSource` behavior
- records 0.8 stable release notes and stable promotion steps
- leaves 0.9 release-readiness work (API Extractor, CI gates, coverage,
  compatibility matrices, browser E2E) deferred to R0-R5

## Changed Files

- `CHANGELOG.md`
- `docs/api/core.md`
- `docs/migrations/0.8-timeline-arrangement-v2.md`
- `docs/plans/v1-collaboration-spec.md`
- `docs/release/0.8-beta-checklist.md`
- `docs/reviews/t8-stable-release-claude.md`
- `package.json`
- `packages/core/README.md`
- `packages/core/package.json`
- `packages/player-react/package.json`
- `packages/react/README.md`
- `packages/react/package.json`

## Review Focus

- Confirm public docs no longer show the removed `createArrangement({ bpm })`
  v1-style API.
- Confirm Arrangement docs consistently mention `timing: TimingMap` and
  explicit `durationBeats`.
- Confirm `migrateArrangementProject()` and `migrateTimelineProject()` are
  represented as explicit migration APIs, not implicit normalization.
- Confirm version bumps are lockstep across root, `@vixeq/core`, `@vixeq/react`,
  and `@vixeq/player-react`.
- Confirm R0-R5 release-readiness items remain deferred and are not silently
  folded into T8.
- Confirm publish is not marked complete until npm `0.8.0` registry smoke passes.

## Commands Run

- `pnpm install --lockfile-only`
- `pnpm -r --no-bail typecheck`
- `pnpm -r --no-bail test -- run`
- `pnpm -r --no-bail build`
- `pnpm smoke:pack`

## Known Limitations

- `0.8.0` has not been published yet in this change. After publish, run clean
  registry smoke against `@vixeq/core@0.8.0`, `@vixeq/react@0.8.0`, and
  `@vixeq/player-react@0.8.0`.
- API Extractor reports, CI API diff, coverage gates, compatibility matrices,
  and browser E2E remain deferred to 0.9 tasks R0-R5.

---

## Review checklist

- [x] **Removed v1 `createArrangement({ bpm })` API is not shown in public
      docs.** Grepped `packages/core/README.md`, `packages/react/README.md`,
      and `docs/api/core.md` for every `bpm` occurrence. The only
      `createArrangement`-adjacent code samples now read
      `createArrangement({ timing: createTimingMap({ bpm: 120 }), durationBeats: 32, ... })`
      (`packages/core/README.md:164-169`, `packages/react/README.md:82-88`).
      The two remaining bare `bpm: 120` occurrences
      (`packages/core/README.md:18`, in the `createProject({ bpm: 120,
      stepCount: 16, trackCount: 4 })` Sequencer example) are the unrelated,
      still-current `SequenceProject` v1-shaped `bpm` field — Sequencer
      projects were never migrated to `TimingMap` and are out of T8's/0.8's
      scope — not a leftover Arrangement v1 example.
- [x] **Arrangement docs consistently show `timing: TimingMap` +
      `durationBeats`.** Confirmed in the same grep pass: both READMEs' prose
      and code samples, and `docs/api/core.md`'s `createArrangement` bullet
      ("creates an `ArrangementProject` with `timing: TimingMap`, explicit
      `durationBeats`, ..."), consistently use the v2 shape. No stale
      "the arrangement's own `bpm` is the single source of truth" prose
      survives (that exact sentence, present before this diff, is replaced).
- [x] **`migrateArrangementProject()`/`migrateTimelineProject()` are
      described as explicit migration APIs, not implicit normalization.**
      `docs/api/core.md:19` and `:32` both use "converts v1 ... data" /
      "converts v1 data" phrasing, distinct from the adjacent
      "`normalizeArrangement(input)` — ... normalize import data" and
      "`createTimelineProject`/`normalizeTimelineProject` repair input"
      sentences that describe the actual implicit-repair functions. The
      READMEs use matching language ("`migrateArrangementProject(input,
      options)` converts v1 arrangement data by mapping the old top-level
      `bpm` into a v2 `TimingMap`; `options.durationBeats` is required").
      This is consistent with the T2/T4-established "strict APIs reject,
      `normalize*` repairs, `migrate*` is an explicit opt-in conversion"
      three-way split, and does not blur migrate into normalize.
- [x] **Version bumps are lockstep across root, `@vixeq/core`,
      `@vixeq/react`, and `@vixeq/player-react`, and no other package is
      touched.** Read all four `package.json` diffs directly: `package.json`
      (root), `packages/core/package.json`, `packages/react/package.json`,
      and `packages/player-react/package.json` each change only
      `"version": "0.8.0-beta.1"` → `"version": "0.8.0"`, nothing else.
      `git diff --stat` confirms no `apps/*/package.json` or
      `examples/*/package.json` is in the diff — spec §2's "all public
      packages remain on lockstep versions" is scoped to the three published
      packages plus the root marker version, matching the task's own
      "primary files" column (`package metadata`), and example/app packages
      correctly keep their own independent versions (e.g.
      `examples/cycling-workout@0.6.0`, seen unchanged in the `smoke:pack`
      build log).
- [x] **R0-R5 are not silently folded into T8.** `git diff --stat` shows no
      `.github/` file and no `api-extractor.json` (or any API-Extractor
      config) anywhere in the working tree diff. `docs/plans/v1-collaboration-spec.md`'s
      diff is exactly one line: T8's own row moves to `in_progress`; R0-R5
      rows are untouched and still read `pending`/`—`. `.github/workflows/`
      contains only the pre-existing `publish.yml` and `pages.yml`, both
      unmodified by this diff (confirmed via `git diff --stat -- .github/`,
      empty output) — `publish.yml` already existed before T8 and has its own
      independent, currently-unresolved OIDC-trusted-publishing debugging
      history (`git log --oneline -- .github/workflows/publish.yml`, most
      recent five commits on `main` are all `fix(ci)`/`debug(ci)` on the npm
      OIDC exchange), which is corroborating evidence (see B1) that automated
      publish is not yet working end-to-end, independent of anything T8
      itself changed.
- [x] **Publish is not marked `done` at the task-table level until npm
      `0.8.0` registry smoke passes.** `docs/plans/v1-collaboration-spec.md`'s
      T8 row Status is `in_progress` (not `done`), and this review's own
      "Known Limitations" section states `0.8.0` has not been published yet.
      This part of the rule is followed correctly at the task-table layer.
      **However**, see B1: `CHANGELOG.md`'s own prose — edited by this same
      diff — asserts the opposite of what the task table and Known
      Limitations say, which is the core problem below.
- [x] **No undeclared changes in the working tree (T6/T7 discipline).**
      `git status --short` lists exactly the 11 tracked modifications in the
      review request's "Changed Files" list, plus the one untracked
      `docs/reviews/t8-stable-release-claude.md` review file itself (the same
      pattern T7 used) — no stray file, no `.tgz`/`.tmp` artifact. Re-ran
      `git status --short` again after all local-gate commands below; output
      unchanged.
- [x] **`docs/release/0.8-beta-checklist.md` correctly describes stable
      promotion, not just a renamed beta checklist.** The diff renames the
      old undifferentiated "## Publish Steps" to "## Beta Publish Steps" and
      adds a new "## Stable Promotion Steps" section (6 steps: confirm
      dist-tags, confirm docs match v2 surfaces, bump versions lockstep,
      re-run local gates, publish `--tag latest`, then reinstall
      `@vixeq/core@0.8.0`/`@vixeq/react@0.8.0`/`@vixeq/player-react@0.8.0`
      from the registry and repeat smoke coverage). This is an accurate,
      sequenced stable-promotion procedure and correctly orders "bump
      version" (step 3) strictly before "publish" (step 5) and "registry
      smoke" (step 6) — which makes B1 below an internal self-contradiction:
      this same file's own step ordering shows publish/registry-smoke as
      *not yet performed* by a diff that only executes step 3, while
      `CHANGELOG.md` (edited in the same diff) asserts steps 5-6 already
      succeeded.
- [x] **Independently re-ran every requested command from a clean state.**
      See Verification method below; all four gates plus a repeat
      `git status --short` are green with no drift.

## Findings

### B1 (blocking) — `CHANGELOG.md`'s "0.8.0 / Published" section asserts npm promotion that has not happened, contradicting this same change's task-table status, Known Limitations, and `0.8-beta-checklist.md` step ordering

**File:** `CHANGELOG.md`, new `## 0.8.0` section, `### Published` subsection
(added lines, see `git diff CHANGELOG.md`):

> Promotes `@vixeq/core`, `@vixeq/react`, and `@vixeq/player-react` to
> `0.8.0` under the `latest` dist-tag.
> Keeps the `beta` dist-tag on `0.8.0-beta.1`.
> Stable smoke coverage matches the beta gate: ESM/CJS imports, public types,
> React SSR, Vite CSS resolution, official example builds, and v1-to-v2
> migration fixtures.

**Fact-check, addressing the review request's four numbered questions
directly:**

1. **Tense/register of the CHANGELOG text itself:** this is present-tense,
   declarative, completed-action prose — "Promotes," "Keeps," "matches," not
   "will promote" or "is expected to promote." It reads as a record of a
   fact that has already occurred (the same grammatical register as the
   `0.8.0-beta.1` and `0.7.0-beta.1` sections' own `### Published`
   subsections, both of which *were* written after real publish). There is
   no hedge language ("pending," "to be confirmed," "after publish") in this
   subsection, unlike, for example, the beta checklist's own "Stable
   Promotion Steps," which is written as a numbered to-do list of future
   actions.
2. **0.7 precedent, via real git history
   (`git log --oneline -- CHANGELOG.md`):** `CHANGELOG.md` has **no** `##
   0.7.0` stable section at all — the repository jumped from
   `0.7.0-beta.1` straight to `0.8.0-beta.1` and 0.7 was never promoted to
   stable. For the section that does exist, `## 0.7.0-beta.1`, the `###
   Published` subsection was added by a *separate, later* commit
   (`62ea092`, "docs: record 0.7.0-beta.1 npm publish in CHANGELOG") whose
   own commit message says "Publish and clean-consumer smoke verification
   **succeeded**; record the published npm URLs..." — i.e. the CHANGELOG
   text was written strictly after the fact was confirmed true, in a commit
   dedicated to that recording. The earlier `c8841e4` ("release:
   v0.7.0-beta.1") commit that did the version bump deliberately did **not**
   include a `### Published` subsection. `## 0.6.0` (`git show` on its
   section) has no `### Published` subsection at all, consistent with
   `0.6.0` never appearing in the real npm registry either — this
   repository's own convention, demonstrated twice, is: no `### Published`
   claim until the publish is real. (One partial deviation exists: the
   `0.8.0-beta.1` "release" commit, `a41feb4`, *did* bundle a `### Published`
   subsection into the same commit as the version bump, and its own message
   admits "Publishing itself is a separate, manual step" — but that claim
   did go on to become true, since `0.8.0-beta.1` is confirmed live on npm
   today. That deviation is itself worth the author's attention, but it is
   not this review's blocking issue since it did not end up asserting a
   falsehood.)
3. **Objective ground truth vs. the two competing documents:** re-ran
   `npm view @vixeq/core versions --json` and `npm view @vixeq/core
   dist-tags --json` live in this session:
   `versions` = `["0.2.0","0.3.0","0.4.0","0.5.0","0.7.0-beta.1","0.8.0-beta.1"]`
   (no `0.8.0`, no `0.7.0`, no `0.6.0`) and `dist-tags` =
   `{"latest":"0.5.0","beta":"0.8.0-beta.1"}`. This matches this review
   request's own "Known Limitations" section ("`0.8.0` has not been
   published yet in this change") and this same diff's
   `docs/release/0.8-beta-checklist.md`, whose "Stable Promotion Steps" list
   publish (step 5) and registry reinstall/smoke (step 6) as steps after the
   version bump (step 3) — and this diff only performs step 3. The
   `CHANGELOG.md` prose is the one document, of the four, that disagrees
   with objective reality.
4. **Blocking or not:** this is a blocking finding, not a wording nitpick.
   `CHANGELOG.md` is consumer-facing release documentation — the exact
   artifact a user or downstream integrator reads to decide whether
   `npm install @vixeq/core@latest` now gets Timing/Timeline/Arrangement v2.
   As committed, it asserts that promotion already happened when
   `dist-tags.latest` is still `0.5.0` and `0.8.0` does not exist on the
   registry at all. This is a stronger claim than merely "written a little
   early": three other artifacts in this exact changeset (the task table's
   `in_progress` status, this review request's own "Known Limitations," and
   `0.8-beta-checklist.md`'s own step ordering) all correctly say publish
   has not happened, so the CHANGELOG text is not just unverified — it is
   inconsistent with its own sibling documents inside the same diff. It also
   sits downstream of an independently-confirmed, currently-unresolved CI
   OIDC-trusted-publishing debugging effort (`.github/workflows/publish.yml`,
   most recent five commits on `main`), which is further evidence publish
   has not actually succeeded. Per §13 item 10 of the spec, an author who
   finds a document conflict during implementation should "stop that work
   item and record the decision required," not silently assert the
   post-publish state ahead of the event. This must be fixed (reworded to a
   pending/future-tense form, or the "Published" content removed/deferred
   until publish actually succeeds and is verified, per the same two-commit
   pattern already used for `0.7.0-beta.1`) before T8 can be marked `done`.

**Failure scenario:** a downstream developer reads `CHANGELOG.md`'s `##
0.8.0` section, sees "Promotes `@vixeq/core` ... to `0.8.0` under the
`latest` dist-tag," and runs `npm install @vixeq/core` expecting v2
Timing/Timeline/Arrangement — but receives `0.5.0` (the actual `latest`),
missing `TimingMap`, `TimelineEngine`, `useTimeline()`, and the v1-to-v2
migration APIs entirely, with no error to indicate the mismatch.

**Resolution (by the user's decision, applied by Claude):** removed the
`### Published` subsection entirely and reworded the `## 0.8.0` intro
paragraph to state explicitly that it has not been published yet, pointing
to `docs/release/0.8-beta-checklist.md`'s Stable Promotion Steps and noting
a `### Published` section will be added only after real publish and
registry smoke succeed — mirroring the exact two-commit pattern already
established for `0.7.0-beta.1` (`c8841e4` then `62ea092`). No actual npm
publish was performed in this session (the user's separate decision was to
defer it). `docs/release/0.8-beta-checklist.md`, the task table, and this
review's own "Known Limitations" already correctly stated the not-yet-
published state and needed no change.

## Verification method

Read `docs/plans/v1-collaboration-spec.md` §2 and §13 in full, and re-read
`docs/reviews/t7-migration-fixtures-claude.md` to match this review's
checklist granularity to the established T6/T7 precedent (in particular the
"confirm no undeclared change is bundled into the working tree" discipline).
Read every file in the declared Changed Files list via `git diff` per-file
(not just `git diff --stat`), and grepped all three public-facing docs
(`packages/core/README.md`, `packages/react/README.md`, `docs/api/core.md`)
for `bpm` to check for stale v1 Arrangement examples by hand rather than
trusting the review request's own characterization.

**On the CHANGELOG contradiction (the review request's "most important"
item):** ran `npm ping`, `npm view @vixeq/core versions --json`, and `npm
view @vixeq/core dist-tags --json` live in this session (network reachable,
registry responsive) and got `latest: 0.5.0`, no `0.8.0` in `versions`,
confirming the review request's own stated npm state independently rather
than trusting it secondhand. Cross-referenced this against
`git log --oneline -- CHANGELOG.md` and read the full diff of each
CHANGELOG-touching commit (`c8841e4`, `62ea092`, `a41feb4`) with `git show
<sha> -- CHANGELOG.md` to establish the real 0.6/0.7/0.8-beta precedent for
when a `### Published` subsection is added, rather than assuming symmetry
with the current `## 0.8.0` diff. Additionally checked
`.github/workflows/publish.yml`'s history (`git log --oneline -- .github/workflows/publish.yml`)
as independent corroborating evidence of whether automated publish is
currently working, and confirmed via `git diff --stat -- .github/` that this
file (pre-existing, unrelated to T8) is untouched by the current diff.

**On scope creep and R0-R5 deferral:** ran `git status --short` at the start
of this review and compared it 1:1 against the review request's own "Changed
Files" list (exact match, including the untracked review file itself,
matching T7's own pattern); ran `find .github -type f` and `git diff --stat
-- .github/ api-extractor.json` (both empty/absent) to confirm no R0-scoped
CI or API-Extractor infrastructure was added; read the full
`docs/plans/v1-collaboration-spec.md` diff (`git diff docs/plans/v1-collaboration-spec.md`)
and confirmed it is exactly the single T8 row status/owner edit, with R0-R5
rows untouched and still `pending`.

**On lockstep versioning:** read all four `package.json` diffs directly
(not summarized) to confirm each changes only the `"version"` field to
`0.8.0`, and confirmed via `git diff --stat` that no `apps/*/package.json`
or `examples/*/package.json` appears in the diff.

Independently re-ran every requested command, from a clean state, in this
session:

- `pnpm -r --no-bail typecheck` (10 workspace projects) — all report `Done`,
  no errors.
- `pnpm -r --no-bail test -- run` (full workspace) — `packages/core` 19
  files/275 tests, `packages/react` 6 files/33 tests, `packages/player-react`
  1 file/6 tests, `apps/playground` 3 files/11 tests,
  `examples/cycling-workout` 1 file/5 tests, all passing; every other example
  package reports `--passWithNoTests` with no test files, matching T7's
  own last-verified baseline exactly (same counts, no regressions, no new
  failures).
- `pnpm -r --no-bail build` (full workspace) — `packages/core`/`react`/
  `player-react` (`tsup`) and every `examples/*`/`apps/playground` (`tsc
  --noEmit && vite build`) succeed with no errors.
- `pnpm smoke:pack` — completed successfully end to end: builds and packs
  `@vixeq/core`, `@vixeq/react`, and `@vixeq/player-react` as `0.8.0`
  tarballs (the version already bumped by this diff), installs them into a
  temporary consumer, and passes ESM/CJS imports, the v1-to-v2 migration
  fixture smoke, public types, React SSR, `styles.css` resolution, and every
  `examples/*`/`apps/playground` packed-tarball build. Log tail: "Pack smoke
  completed successfully."
- `git status --short` (re-run after all four commands above) — unchanged
  from the start-of-review snapshot: exactly the 11 declared tracked
  modifications, no stray artifact.

## Final verdict

**Changes requested.** Five of the six review-focus points, and the
additional lockstep-version and no-scope-creep checks, hold up cleanly under
independent verification:

1. No public doc shows the removed v1 `createArrangement({ bpm })` shape;
   the only remaining bare `bpm` example is the unrelated, still-current
   Sequencer `createProject({ bpm })` API.
2. Arrangement docs consistently show `timing: TimingMap` + explicit
   `durationBeats` across both READMEs and the API doc.
3. `migrateArrangementProject()`/`migrateTimelineProject()` are described
   with "converts v1 ... data" language, distinct from the neighboring
   `normalize*`/`create*` "repair input" language — the explicit-migration
   vs. implicit-normalization distinction established in T2/T4 is preserved.
4. Version bumps are exactly lockstep (`0.8.0`) across root, `@vixeq/core`,
   `@vixeq/react`, and `@vixeq/player-react`, with no example/app package
   touched.
5. R0-R5 remain `pending` and untouched; no `.github/` file, no API
   Extractor config, and no CI workflow was added or modified by this diff.

All four requested local gates were independently re-run from a clean state
and are green (`pnpm -r --no-bail typecheck`, `pnpm -r --no-bail test --
run`, `pnpm -r --no-bail build`, `pnpm smoke:pack`), and `git status --short`
matches the declared Changed Files list exactly, both before and after
running them (T6/T7 discipline preserved).

However, **B1 is blocking**: `CHANGELOG.md`'s new `## 0.8.0` / `### Published`
section asserts, in unhedged present-tense prose, that `@vixeq/core`,
`@vixeq/react`, and `@vixeq/player-react` have already been promoted to
`0.8.0` under npm's `latest` dist-tag and that stable registry smoke has
passed. Live re-verification of the npm registry in this session
(`dist-tags.latest = "0.5.0"`, no `0.8.0` in `versions`) confirms this is not
true, and — critically — three other parts of this exact same changeset
(the task table's `in_progress` T8 status, this review request's own "Known
Limitations" section, and `docs/release/0.8-beta-checklist.md`'s own
publish-after-version-bump step ordering) all correctly say the opposite.
This is not a stylistic nitpick about future vs. present tense in isolation;
it is an internal self-contradiction within the diff being reviewed, in a
document (`CHANGELOG.md`) whose entire purpose is to be an accurate,
consumer-facing record of what has actually shipped. T8 should not be marked
`done` until this section is corrected to reflect that stable publish has
not yet occurred — following the same two-commit pattern already
established for `0.7.0-beta.1` (version-bump commit with no `### Published`
claim, then a separate follow-up commit adding the `### Published` section
only after real publish and registry smoke succeed) — or until the actual
publish and registry smoke this section describes genuinely happen first.

## Re-review (fixes verification)

Re-reviewed after the resolution recorded in B1 above. Scope: confirm the
`CHANGELOG.md` fix, confirm no npm publish was actually executed, cross-check
sibling docs for consistency, re-run the four local gates, and re-check
`git status --short` for drift.

### 1. `CHANGELOG.md` fix

Read the current `## 0.8.0` section directly (`CHANGELOG.md:5-25`) and diffed
it against HEAD (`git diff CHANGELOG.md`):

- The `### Published` subsection flagged in B1 is gone — the section now goes
  straight from the intro paragraph to `### Added` / `### Breaking`.
- The intro paragraph now reads: "Stable release of Timing/Timeline/Arrangement
  v2, promoting the 0.8 beta line. **Not yet published** — see
  `docs/release/0.8-beta-checklist.md`'s Stable Promotion Steps. A `###
  Published` section will be added once `@vixeq/core`, `@vixeq/react`, and
  `@vixeq/player-react` are actually promoted to `0.8.0` under the `latest`
  dist-tag and registry smoke passes, matching how `0.7.0-beta.1`'s publish
  was recorded only after the fact." This is explicit, hedged, future-tense
  language — the opposite of the unhedged "Promotes ... under the `latest`
  dist-tag" prose B1 flagged.
- Re-read the real two-commit precedent this resolution claims to mirror:
  `git show c8841e4 -- CHANGELOG.md` (the `0.7.0-beta.1` version-bump/release
  commit) contains **no** `### Published` subsection — only `### Added` /
  `### Changed` / `### Breaking`. `git show 62ea092 -- CHANGELOG.md` (a
  separate, later commit titled "docs: record 0.7.0-beta.1 npm publish in
  CHANGELOG") adds the `### Published` subsection by itself, after the fact.
  The current uncommitted `## 0.8.0` section matches the shape of `c8841e4`
  exactly (version-bump commit, no `### Published` yet) — the fix genuinely
  follows the established two-commit pattern rather than merely asserting
  that it does.

**B1 is resolved.**

### 2. No npm publish was executed in this session

Re-ran the exact live registry check from the original review:

```
npm view @vixeq/core dist-tags --json
{ "latest": "0.5.0", "beta": "0.8.0-beta.1" }

npm view @vixeq/core versions --json
["0.2.0","0.3.0","0.4.0","0.5.0","0.7.0-beta.1","0.8.0-beta.1"]
```

`latest` is still `0.5.0`; `0.8.0` does not exist in `versions`. Identical to
the original review's findings — confirms no publish happened as part of
applying this fix, consistent with the resolution note ("No actual npm
publish was performed in this session").

Note: `git log --oneline -5` on `main` shows five newer commits
(`3f2a013`..`3c4158f`, all `debug(ci)`/`fix(ci)`, working the GitHub→npm OIDC
trusted-publishing exchange for `.github/workflows/publish.yml`) landed since
the original review. These are outside T8's Changed Files list and are CI
plumbing, not a manual `npm publish` of `0.8.0` — they do not change the
dist-tags result above and are not part of this diff (confirmed via
`git status --short`, below).

### 3. Cross-document consistency

- `docs/plans/v1-collaboration-spec.md:644` — T8 row Status is still
  `in_progress` (unchanged, correctly not bumped to `done`).
- `docs/release/0.8-beta-checklist.md` "Stable Promotion Steps" — still lists
  publish (step 5) and registry smoke (step 6) strictly after the version
  bump (step 3); unchanged since the original review, still accurate.
- This review's own "Known Limitations" section (above) still states
  "`0.8.0` has not been published yet in this change" — unchanged, still
  accurate.
- `CHANGELOG.md`'s `## 0.8.0` intro paragraph (fixed by this resolution) now
  says the same thing in the same terms ("Not yet published").

All four documents now agree: 0.8.0 is version-bumped but not published.
No remaining internal contradiction.

### 4. Local gates re-run

Re-ran all four requested commands from the current working tree (CHANGELOG-only
change beyond the original diff; no source touched):

- `pnpm -r --no-bail typecheck` — 10/10 workspace projects report `Done`, no
  errors.
- `pnpm -r --no-bail test -- run` — `packages/core` 19 files/275 tests,
  `packages/react` 6 files/33 tests, `packages/player-react` 1 file/6 tests,
  `apps/playground` 3 files/11 tests, `examples/cycling-workout` 1 file/5
  tests, all passing; remaining example packages report `--passWithNoTests`
  with no test files. Identical counts to the original review, no
  regressions.
- `pnpm -r --no-bail build` — every package (`tsup`) and example/app
  (`tsc --noEmit && vite build`) succeeds; no `error`/`fail` in the combined
  output.

All green, as expected for a docs-only fix.

### 5. `git status --short` — no undeclared changes

```
 M CHANGELOG.md
 M docs/api/core.md
 M docs/migrations/0.8-timeline-arrangement-v2.md
 M docs/plans/v1-collaboration-spec.md
 M docs/release/0.8-beta-checklist.md
 M package.json
 M packages/core/README.md
 M packages/core/package.json
 M packages/player-react/package.json
 M packages/react/README.md
 M packages/react/package.json
?? docs/reviews/t8-stable-release-claude.md
```

Exactly the same 11 tracked modifications plus the same untracked review
file as the original review's baseline — no new or stray file, no
`.tgz`/`.tmp` artifact, and no accidental staging/commit of the fix. The
CHANGELOG.md fix itself is the only content change inside this set relative
to the original review (confirmed via `git diff CHANGELOG.md` above);
`docs/plans/v1-collaboration-spec.md` remains the single T8-row-only edit
noted in the original review and was not touched by this fix, per
instruction.

### Re-review verdict

**Approved.** B1 is resolved: `CHANGELOG.md`'s `## 0.8.0` section no longer
contains a `### Published` subsection and now explicitly states publication
has not happened yet, in the same two-commit pattern (version-bump commit
without `### Published`, to be followed by a separate future commit adding
it only after real publish and registry smoke succeed) already established
for `0.7.0-beta.1`. Live re-verification confirms no npm publish occurred
during this fix (`dist-tags.latest` is still `0.5.0`, no `0.8.0` in
`versions`). All four sibling documents — the task table (`in_progress`),
this review's "Known Limitations," `docs/release/0.8-beta-checklist.md`'s
step ordering, and now `CHANGELOG.md` itself — consistently state that 0.8.0
is version-bumped but not yet published, with no remaining internal
contradiction. All four requested local gates are green with no regressions,
and `git status --short` shows no undeclared changes beyond the original
Changed Files list. T8's task-table row should remain `in_progress` until an
actual npm publish and registry smoke succeed and are recorded in a
follow-up `### Published` commit — this review approves the *documentation
fix*, not a publish that still has not happened.
