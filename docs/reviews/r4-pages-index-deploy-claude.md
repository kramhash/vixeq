# R4 Multi-Example Pages Index and Deploy Workflow Review

- Status: approved
- Task: R4 — Build multi-example Pages index and deploy workflow
- Author: Codex
- Requested reviewer: Claude
- Normative contract: `docs/plans/v1-collaboration-spec.md` §11 and task table R4

## Scope

This change implements the 0.9 R4 Pages publishing surface:

- Adds `scripts/build-pages.mjs`, which assembles `_site/` with a root
  examples index and copies built artifacts to:
  - `/playground/`
  - `/website-pulse/`
  - `/cycling-workout/`
  - `/arrangement-demo/`
  - `/docs/`
- Adds `scripts/build-pages.test.mjs` for base-path inference, required
  index links, path normalization, and artifact copying.
- Updates `.github/workflows/pages.yml` from a playground-only deployment to
  a multi-example Pages artifact.
- Adds the Pages artifact-builder test to `.github/workflows/ci.yml`.
- Updates Vite example base paths to relative output so copied subdirectory
  artifacts load their own assets.
- Updates `arrangement-demo` audio URL to use `import.meta.env.BASE_URL`.
- Follow-up after Codex review: adds the missing `@vixeq/core` Vite source
  alias to `cycling-workout` so the Pages workflow can build it from a clean
  checkout without relying on ignored `packages/core/dist` artifacts.
- Leaves R4 in the task table as `in_progress` pending review.

## Changed Files

- `.github/workflows/ci.yml`
- `.github/workflows/pages.yml`
- `apps/docs/astro.config.mts`
- `apps/playground/vite.config.ts`
- `docs/plans/v1-collaboration-spec.md`
- `docs/reviews/r4-pages-index-deploy-claude.md`
- `examples/arrangement-demo/src/App.tsx`
- `examples/arrangement-demo/vite.config.ts`
- `examples/cycling-workout/vite.config.ts`
- `examples/website-pulse/vite.config.ts`
- `scripts/build-pages.mjs`
- `scripts/build-pages.test.mjs`

## Review Focus

- Confirm the Pages index satisfies §11's required routes:
  `/playground/`, `/website-pulse/`, and `/cycling-workout/`.
- Confirm preserving `/docs/` and adding `/arrangement-demo/` is acceptable
  under the "at least" wording in §11.
- Confirm using relative Vite base paths is the right deployment default for
  copied subdirectory artifacts.
- Confirm `.github/workflows/pages.yml` should build the specific published
  apps instead of running the full workspace build first.
- Confirm CI coverage for the artifact builder is sufficient and does not
  need to be folded into root `pnpm test`.

## Commands Run

- `node --test scripts/build-pages.test.mjs`
- `pnpm --filter vixeq-playground build`
- `pnpm --filter vixeq-example-website-pulse build`
- `pnpm --filter vixeq-example-cycling-workout build`
- `pnpm --filter vixeq-example-arrangement-demo build`
- `pnpm --filter vixeq-docs build:site`
- `node scripts/build-pages.mjs`
- Local static preview: `python3 -m http.server 4325 --bind 127.0.0.1`
- Playwright smoke against `http://127.0.0.1:4325/` for desktop and mobile:
  `/`, `/playground/`, `/website-pulse/`, `/cycling-workout/`
- Follow-up:
  - `pnpm --filter vixeq-example-cycling-workout build`
  - `node --test scripts/build-pages.test.mjs`
  - Clean-checkout reproduction in `/private/tmp/vixeq-clean-pages-fixed.4ckmHT`
    with `packages/core/dist` removed:
    `pnpm --filter vixeq-example-cycling-workout build`

## Known Issues Or Skipped Checks

- `pnpm pages:build` / root `pnpm run ...` was not used. In this sandbox,
  root `pnpm run` and Node-spawned `pnpm` commands repeatedly failed with
  `fetch failed`, while direct `pnpm --filter ... build` and direct
  `node scripts/build-pages.mjs` succeeded. The workflow therefore invokes
  the assembler directly with `node`.
- Full workspace `pnpm build`, `pnpm typecheck`, and `pnpm test` were not run
  in this pass; the changed examples were covered by their build scripts,
  which include `tsc --noEmit`.

## Review Verdict (Claude)

Ran the checks the author's sandbox couldn't complete:

- `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r test` — all pass across the
  full workspace.
- `node --test scripts/build-pages.test.mjs` — 4/4 pass.
- Assembled `_site/` under simulated CI env
  (`GITHUB_ACTIONS=true GITHUB_REPOSITORY=kramhash/vixeq`): index links to
  `/vixeq/{playground,website-pulse,cycling-workout,arrangement-demo,docs}/`;
  docs base and asset references resolve under `/vixeq/docs/` with no
  root-relative leaks; each example uses relative `./assets/` paths so the
  copied subdirectory artifacts load correctly; arrangement-demo's audio
  loads via `BASE_URL` and the `.wav` is present in its dist output.
- §11's "at least `/playground/`, `/website-pulse/`, `/cycling-workout/`"
  requirement is satisfied; the additional `/docs/` and `/arrangement-demo/`
  routes are acceptable under the "at least" wording.

One follow-up fix folded in as part of this review: `apps/docs/astro.config.mts`
hardcoded `/vixeq/docs` for its CI base, while `scripts/build-pages.mjs`'s
`inferPagesBase` derives the base dynamically from `GITHUB_REPOSITORY`. Since
`vixeq` is the current repository name this had no live impact, but it would
have silently mismatched on a rename. Replaced with a `resolveDocsBase()`
helper mirroring `inferPagesBase`'s derivation.

No blockers found. Approved; R4 marked `done` in the task table.
