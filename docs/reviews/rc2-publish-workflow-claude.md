# RC2 Harden the tag-triggered publish workflow — brief and review

- Status: done (approved in review round 2)
- Author: Claude
- Reviewer: Claude critic
- Scope: spec §2 ("Before `1.0.0-rc.1` is published") and the RC2 task-table
  row: every repository gate runs before publishing, prereleases publish
  under `next`, a GitHub Release is created, and the 1.0 checklist publish
  steps are rewritten around the workflow. Blocks RC3 (`1.0.0-rc.1`).
- Depends on RC1E, RC1G, RC1H, RC1I (all done).

## Decisions (project owner, 2026-10-11)

- D1: The GitHub Release notes are the `## <version>` section of
  `CHANGELOG.md` (as for the past manual Releases). A missing or empty section
  fails the run before any gate.
- D2: `workflow_dispatch` is kept as a dry run only: preflight (without the
  tag checks), every gate, and `pnpm publish --dry-run`; no OIDC token
  exchange, no publish, no Release. It lets the workflow wiring be rehearsed
  before the `v1.0.0-rc.1` tag. Previously a dispatch on `main` published for
  real (0.8.0 was published that way).

Author decisions:

- D3: Gates come from `ci.yml` itself, called as a reusable workflow
  (`workflow_call` added), so publish and CI cannot drift. This covers the
  Node 22/24/26 build matrix, coverage, API reports, behavior matrix, the
  three packed-package fixtures, browser E2E, and the docs build. The publish
  job no longer runs typecheck and test itself; it keeps install and build
  because it publishes its own `dist/`.
- D4: The release logic that can be tested without publishing lives in
  `scripts/release-meta.mjs` (lockstep versions, semver, tag match,
  `next`/`latest`, CHANGELOG extraction) with `node --test` coverage, run in
  CI next to the Pages builder test.
- D5: A tag push also requires the tagged commit to be on `main`.
- D6: Re-runs are safe: a filtered `pnpm publish` skips a version already on
  the registry, and the Release step skips an existing Release. A stable
  release does not move `next` (it stays on the final RC, like `beta` stayed
  on `0.8.0-beta.1`).
- D7: The OIDC token-exchange block, the pnpm setup
  (`11.11.0`, `package_json_file: does-not-exist.json`), and the Node setup
  without `registry-url` are unchanged apart from `--tag "$DIST_TAG"`.

## Observations

- The v0.9.0 Publish run (29234101805) installs pnpm 11.11.0 but then runs
  install and publish with pnpm **10.12.1** (`Done in 4.8s using pnpm
  v10.12.1`; publish goes through the npm CLI). The root `packageManager`
  field switches the version. Locally the same happens, so local dry runs
  match CI. Not changed here (D7).
- `pnpm --filter <pkg> publish` runs in recursive mode and prints "There are
  no new packages that should be published" for a version that is already on
  the registry (checked locally on `0.9.0`), which is what D6 relies on. It
  also means a dry run on an already published version packs nothing, so the
  checklist runs the rehearsal after the version bump.
- `pnpm publish --dry-run` needs no npm login (only a warning), checked
  locally with an unpublished `1.0.0-rc.99` in a throwaway worktree.

## Review stop criteria (decided before round 1)

At most 3 `critic` rounds; the last round checks only for regressions
introduced by the previous fix. Findings that can only be confirmed by a real
publish (registry or GitHub behavior that cannot be reproduced locally) are
recorded as risks for the RC3 rehearsal instead of blocking.

## Changed files

- `.github/workflows/publish.yml`: `preflight` → `gates` (reusable `ci.yml`)
  → `publish` jobs; dry-run mode for dispatch; `--tag "$DIST_TAG"`; dist-tag
  verification with retries; GitHub Release creation; job-scoped permissions
  (`contents: write` and `id-token: write` only on `publish`); a
  non-cancelling concurrency group per ref.
- `.github/workflows/ci.yml`: `workflow_call` trigger; runs
  `scripts/release-meta.test.mjs`.
- `scripts/release-meta.mjs`, `scripts/release-meta.test.mjs`: new.
- `docs/release/1.0-release-checklist.md`: new "Publish Workflow" section;
  RC and stable steps rewritten around tag pushes and the dry-run rehearsal.
- `CHANGELOG.md`: Unreleased "Changed" entry.
- `docs/plans/v1-collaboration-spec.md`: RC2 row claimed, files listed.

## Commands run

- `node --test scripts/build-pages.test.mjs scripts/release-meta.test.mjs`
- `node scripts/release-meta.mjs` with dispatch and mismatched-tag
  environments.
- `actionlint 1.7.12` with `shellcheck 0.11.0` on both workflows.
- Local `pnpm --filter @vixeq/core publish --dry-run --tag next` on `0.9.0`
  and on `1.0.0-rc.99` (throwaway worktree, removed).

## Results

- 12/12 script tests pass. The CLI writes the outputs and notes on dispatch
  and fails with `::error::Tag v1.0.0 does not match the package version
  0.9.0` on a mismatched tag.
- actionlint and shellcheck report nothing (one unused loop variable fixed).
- Not verifiable locally: the reusable-workflow call and permissions on
  GitHub, the OIDC publish with `--tag next`, and `gh release create`. The
  dispatch dry run (checklist RC step 5) covers the first before RC3; the
  rest run for the first time with `v1.0.0-rc.1`, which is the point of
  publishing the RC through this workflow.

## Review

### Round 1 (Claude critic, 2026-10-11): approve, three low findings

No high or medium findings. Refuted: a concurrency collision through the
called `ci.yml`, a permissions gap, a dispatch that publishes or a tag push
that skips gates, a missing `origin/main` (also for annotated tags), `--tag`
not reaching npm, a double publish on re-run, `set -e` in the verification
loop, an empty bash array under `set -u` (bash 5 on ubuntu), a stable release
taking `latest` wrongly, CHANGELOG heading confusion (`rc.1` vs `rc.10`).

- L1: the CLI entry guard compared `import.meta.url` with `file://argv[1]`,
  so through a symlinked or space-containing path the script exited 0 without
  outputs, and the publish steps were gated on `dry-run != 'true'`, so empty
  outputs fell through to the OIDC exchange (then `--tag ""` failed). Not
  reachable on `ubuntu-latest`. **Fixed:** publishing steps run only on
  `dry-run == 'false'`; the preflight step fails unless `dry-run=true|false`
  was written; the guard compares real paths. A CLI test started through a
  symlink with a space fails on the old guard and passes now.
- L2: the checklist's recovery path did not say to cancel a run still in
  progress before re-tagging; a queued run behind it would publish the old
  commit and attach old notes to the new tag. **Fixed:** the bullet now says
  to `gh run cancel` and wait first.
- L3: test gaps. **Fixed:** CRLF and trailing-space headings, unset
  `GITHUB_EVENT_NAME` (dry run), `+build` rejected, and the CLI path
  (`GITHUB_OUTPUT` lines, notes trailing newline, `::error::` and exit 1).

After the fixes: 10/10 script tests pass; actionlint with shellcheck is clean.

### Round 2 (Claude critic, 2026-10-11, regressions only): approve

No regressions from the L1–L3 fixes. A tag push writes exactly
`dry-run=false` and the `grep` fails the step otherwise; a dispatch (also on
a tag ref, or with no event name) yields `dry-run=true`; the second
`release-meta.mjs` run in the Release step still writes the notes; the new
CLI tests scrub the runner's own `GITHUB_*` variables, so they behave the same
on `pull_request`, `push`, and when `ci.yml` is called from a tag push.

Note for RC3: the CLI tests read the real `package.json` and `CHANGELOG.md`,
so CI on `main` fails unless `CHANGELOG.md` has a non-empty section for the
current version. The version-bump commit must rename `## Unreleased` to
`## 1.0.0-rc.1 - <date>` (checklist RC step 2), which this enforces early.
