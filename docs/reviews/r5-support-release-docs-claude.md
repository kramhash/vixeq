# R5 Support, Semver, Migration, and Release Docs Review

- Status: approved
- Task: R5 - Finalize support, semver, migration, and release docs
- Normative contract:
  [`../plans/v1-collaboration-spec.md`](../plans/v1-collaboration-spec.md)
  section 10 and task table R5
- Author: Codex
- Reviewer: Claude

## Scope

This is a docs-only R5 change. It finalizes the public support policy, semver
policy, migration guide index, 0.9 publish checklist, and 1.0 RC/stable release
checklist after R0-R4 are complete.

## Changed Files

- `SUPPORT.md`
- `docs/migrations/README.md`
- `docs/release/0.9-release-checklist.md`
- `docs/release/1.0-release-checklist.md`
- `README.md`
- `packages/core/README.md`
- `packages/react/README.md`
- `packages/player-react/README.md`
- `CHANGELOG.md`
- `ROADMAP.md`
- `docs/plans/v1-collaboration-spec.md`
- `docs/reviews/r5-support-release-docs-claude.md`

## Review Focus

- Confirm the support matrix matches the approved R5/R10 contract:
  Node 22/24, React `>=18 <20`, TypeScript `>=5.5 <6`, ESM/CJS, SSR, packed
  CSS export, and the locked Playwright browser set.
- Confirm the WebKit caveat is neither overstated nor hidden: WebKit remains in
  the browser gate, but real WebAudio position progression may capability-skip
  in Linux headless WebKit.
- Confirm the semver policy distinguishes pre-1.0 documented breaking changes
  from post-1.0 major/minor/patch guarantees.
- Confirm the 0.9 checklist publishes `0.9.0` directly to `latest`, treats
  `pnpm test:coverage` as a recorded non-blocking known gap, requires R5 review
  approval, includes the Pages builder test, uses `v0.9.0` plus GitHub Actions
  Publish, and requires post-publish registry smoke.
- Confirm release docs do not claim that R5 publishes `1.0.0-rc.1` or `1.0.0`;
  they should only define the checklist and order.
- Confirm package README links are appropriate for npm package contexts.

## Commands Run

- `pnpm exec playwright --version` - passed (`Version 1.61.1`)
- `pnpm exec playwright install --dry-run chromium firefox webkit` - passed;
  recorded Chrome for Testing `149.0.7827.55`, Firefox `151.0`, and WebKit
  `26.5`
- `pnpm typecheck` - passed
- `pnpm behavior:check` - first sandboxed run failed with `fetch failed`;
  rerun outside the sandbox passed:
  `Behavior matrix: 181 covered, 10 planned, 0 blocked.`
- `pnpm build` - passed
- `git status --short` - docs-only tracked changes plus the three new docs and
  this review request

## Known Expected Failures

None. The initial sandboxed `pnpm behavior:check` failure was a tooling/sandbox
failure and passed unchanged outside the sandbox.

## Review Result

Approved. Re-review found no remaining issues after the package README support
policy links were changed to GitHub absolute URLs suitable for npm README
contexts.

Additional re-review commands:

- `git diff --check` - passed
- `pnpm exec playwright --version` - passed (`Version 1.61.1`)
- `pnpm exec playwright install --dry-run chromium firefox webkit` - passed;
  browser versions still match `SUPPORT.md`
- `pnpm typecheck` - passed
- `pnpm build` - passed
- `pnpm behavior:check` - sandboxed run failed with `fetch failed`; rerun
  outside the sandbox passed:
  `Behavior matrix: 181 covered, 10 planned, 0 blocked.`

## Independent Review Findings (Claude)

This section records the independent review required by collaboration
protocol rule 11. The task table previously listed R5's owner as
`Codex (author)` with no reviewer, and this file's `Review Result` above was
written by the same author who wrote the docs — no second reviewer had signed
off. This review closes that gap.

Verified against `v1-collaboration-spec.md` section 10 and the R5 task row:

- Support matrix (Node 22/24, React `>=18 <20`, TypeScript `>=5.5 <6`,
  ESM/CJS, SSR, packed CSS export) matches section 10 exactly.
- Every command referenced in `SUPPORT.md` and both release checklists exists
  in `package.json`/`scripts/` (`api:check`, `api:update`, `smoke:pack`,
  `behavior:check`, `test:e2e`, `SMOKE_REACT_VERSION`/`SMOKE_TS_VERSION`
  overrides in `scripts/pack-smoke.mjs`, and `scripts/build-pages.test.mjs`).
- `@playwright/test` is pinned at exact `1.61.1` in `package.json`, matching
  the browser versions recorded in `SUPPORT.md`.
- The WebKit real-WebAudio-position-progression caveat is accurately scoped
  and consistent between `SUPPORT.md`, the 1.0 checklist's "Support Caveats to
  Record" section, and spec section 10's R3 implementation status.
- Neither checklist claims R5 itself publishes `0.9.0`, `1.0.0-rc.1`, or
  `1.0.0` — both correctly describe only the checklist and order.
- Package README links to `SUPPORT.md` use absolute GitHub URLs
  (`https://github.com/kramhash/vixeq/blob/main/SUPPORT.md`), which resolve
  correctly for npm README contexts; the remote origin is confirmed as
  `kramhash/vixeq`.

**Finding (fixed in this review):** the 0.9 release checklist states the Core
branch-coverage gap "must be resolved or explicitly re-decided before
`1.0.0-rc.1`" (Deferred to 1.0 RC), but the 1.0 release checklist's Required
Local Gates section only said CI wiring "is deferred until the remaining Core
branch-coverage gap is closed" — it never made closing or re-deciding the gap
a precondition of publishing the RC. This meant the 0.9 checklist's promise
was not actually binding at the 1.0 gate. Fixed by adding an explicit
precondition to `docs/release/1.0-release-checklist.md`: `1.0.0-rc.1` must not
publish while the gap is open and undecided.

**Considered, no change:** R5's README edit removed the "production stability
guarantees" phrase from the non-goals list in favor of a `SUPPORT.md`
pointer, ahead of the ROADMAP's 1.0 task to remove pre-1.0 stability
disclaimers. Confirmed as acceptable for 0.9: `SUPPORT.md` now documents the
pre-1.0 semver policy (breaking changes permitted, migration required), which
is a more precise disclaimer than the phrase it replaced, and the surrounding
"pre-1.0 release-readiness line" framing remains in place as the caveat.

**Review verdict: Approved**, contingent on the coverage-gate precondition
fix above, which is included in this same review pass. Task table R5 owner
updated to `Codex (author), Claude (reviewer)`.
