# Claude Review Request: P8 Packed Beta Smoke Fixtures

Status: approved

## Context

P8 adds the packed-package beta smoke harness and the 0.7 beta publish checklist.
It intentionally does not publish a beta or bump package versions.

Approved scope from `docs/plans/v1-collaboration-spec.md`:

- Build and pack `@vixeq/core`, `@vixeq/react`, and `@vixeq/player-react`.
- Install tarballs into a temporary consumer workspace.
- Verify core ESM, core CJS, public types, React SSR, Player React CSS export,
  and official example builds against tarballs.
- Document the beta publish checklist.

## Files To Review

- `.gitignore`
- `package.json`
- `fixtures/pack-smoke/consumer/`
- `scripts/pack-smoke.mjs`
- `docs/release/0.7-beta-checklist.md`
- `docs/plans/v1-collaboration-spec.md`

## Review Focus

Please review for blocking and non-blocking issues:

- Does `pnpm smoke:pack` actually exercise packed tarballs instead of workspace
  source aliases?
- Are the temp copied examples normalized correctly so `@vixeq/*` resolves via
  tarball `file:` specs?
- Is the smoke coverage aligned with P8 and the 0.7 release-gate spec?
- Are generated artifacts excluded from git without hiding source files that
  should be tracked?
- Is the release checklist accurate about what P8 does and what is deferred?

## Out Of Scope

- Actual `npm publish`.
- Package version bump to `0.7.0-beta.1`.
- `publint` / Are The Types Wrong automation.
- npm/yarn/bun compatibility matrix.
- Browser E2E against examples.

## Verification Commands

```sh
pnpm smoke:pack # passed
pnpm -r --no-bail typecheck # passed
pnpm -r --no-bail test -- run # passed
pnpm -r --no-bail build # passed
```

Note: the first sandboxed runs of `pnpm smoke:pack` and
`pnpm -r --no-bail typecheck` failed with `fetch failed`; both passed when
rerun with the already approved pnpm command prefixes.

---

## Claude review

### Review checklist

- [x] `pnpm smoke:pack` exercises real packed tarballs, not workspace source
      aliases.
- [x] Copied examples/apps are normalized so `@vixeq/*` resolves via tarball
      `file:` specs, not `workspace:*`.
- [x] Smoke coverage matches P8's approved scope and the checklist's stated
      claims (core ESM, core CJS, public types, React SSR, Player React CSS
      export, example builds).
- [x] Generated artifacts are excluded from git without over-broadly
      ignoring tracked source.
- [x] `docs/release/0.7-beta-checklist.md` accurately describes what P8 does
      and what is explicitly deferred.
- [x] `docs/plans/v1-collaboration-spec.md` task-table update for P8/P7F is
      consistent with the already-approved P7F state.

### Verification

Re-ran everything independently rather than trusting the review's claims:

- Read `scripts/pack-smoke.mjs` in full and traced the actual dependency
  wiring: `packPublicPackages()` builds and `pnpm pack`s
  `@vixeq/core`/`@vixeq/react`/`@vixeq/player-react` into
  `.tmp/pack-smoke/tarballs/*.tgz`; `prepareTempWorkspace()` writes a fresh
  `vixeq-pack-smoke-consumer` `package.json` whose `@vixeq/*` deps are
  `file:` specs pointing at those tarballs (not `workspace:*`), and
  `rewriteVixeqDependencies()` + `stripWorkspaceAliases()` do the same for
  every copied example/app (strips `tsconfig`'s `baseUrl`/`paths` and
  rewrites `vite.config.ts` to a bare config, so no workspace alias or
  TS path mapping can silently mask a broken public export).
- Ran `pnpm smoke:pack` end-to-end myself — passed, including the consumer's
  `smoke:core-esm`, `smoke:core-cjs`, `smoke:react-ssr`, `smoke:types`,
  `smoke:vite` steps and all 7 example/app tarball builds
  (`playground`, `react-player`, `vanilla-core`, `arrangement-demo`,
  `cycling-workout`, `website-pulse`, `website-svg`).
- After the run, inspected `.tmp/pack-smoke/consumer/package.json` and
  followed the `node_modules/@vixeq/*` symlinks in the installed temp
  workspace: they resolve into
  `node_modules/.pnpm/@vixeq+core@file+tarballs+vixeq-core-0.6.0.tgz/...`
  (and the equivalent for `react`/`player-react`) — i.e. pnpm genuinely
  installed from the packed tarballs, not a workspace symlink. This
  directly confirms the review's central claim rather than trusting the
  script's intent.
- Cross-checked every public symbol the fixtures import
  (`SequencerEngine`, `createProject`, `setStepValue`, `validateProject`,
  `sampleChannelsAt`, `lookaheadMs`, `useSequencerEngine`,
  `SequencerEngineHookState`, `SequencePlayer`, `SequencePlayerProps`,
  `StandaloneSequencePlayer`, `StandaloneSequencePlayerProps`) against the
  actual package sources — all exist with matching shapes. Confirmed
  `react-ssr.mjs`'s assertion (`html.includes("vixeq-player")`) matches the
  real root class name at `SequencePlayer.tsx:220`, and
  `player-react/package.json`'s `exports["./styles.css"]` matches the
  `import "@vixeq/player-react/styles.css"` in `vite-entry.tsx`.
- Reran `pnpm -r --no-bail typecheck` (10/10 projects clean),
  `pnpm -r --no-bail test -- run` (all suites green, e.g. core 189/189,
  react 25/25, player-react 6/6), and `pnpm -r --no-bail build` (all 10
  projects built) — matches the review's claims.
- `git status --porcelain` after all of the above: no `.tgz`, no `.tmp/`,
  no copied-example residue tracked or untracked-but-visible outside the
  intended new files — confirms the `.gitignore` addition
  (`.tmp/` and `*.tgz`, the only two new lines) is sufficient and doesn't
  hide anything that should be tracked.
- Diffed `.gitignore`, `package.json`, and the
  `v1-collaboration-spec.md` task-table rows against `HEAD`: `.gitignore`
  adds exactly the two lines needed for this script's own output;
  `package.json` adds exactly the one `smoke:pack` script; the spec's task
  table correctly reflects P4–P7F as already `done` (matching their own
  approved review files) and moves P8 to `in_progress` with the right
  `P1–P7F` dependency — no unrelated or premature status changes.
- Read `docs/release/0.7-beta-checklist.md` end-to-end against the actual
  script behavior: every bullet under "Required Local Gates" and the smoke
  coverage list matches what `pack-smoke.mjs` actually does (including that
  it does *not* bump versions or publish — confirmed the script contains no
  `npm publish`/version-write step). The "Deferred Release Gates" section
  correctly scopes `publint`/Are The Types Wrong, package-manager matrix,
  version matrices, and browser E2E to later work items (R0-R2), matching
  this review's own "Out Of Scope" list and the task table's R0-R2 rows.

### Findings

None blocking. No non-blocking findings either — this is a clean,
narrowly-scoped, and independently-reproducible smoke harness.

### What's solid

- The tarball-vs-workspace distinction is the one thing this whole task
  exists to guarantee, and it's verified at three independent levels: the
  dependency spec in the generated `package.json` (`file:` not
  `workspace:*`), the resolved `node_modules` symlink target (points into
  a `.pnpm` tarball-hash directory, not the repo's `packages/*`), and the
  explicit removal of TS path aliases and the Vite workspace plugin config
  that could otherwise mask a broken public export by silently falling
  back to source.
- `stripWorkspaceAliases` rewriting `vite.config.ts` per-project based on
  whether the project actually uses `@vitejs/plugin-react` (rather than a
  single hardcoded template) is a small but correct detail — it avoids
  either dropping JSX support for React examples or needlessly adding the
  plugin to `vanilla-core`.
- The beta checklist is honest about scope: it explicitly calls out what
  P8 defers (publint/ATTW, package-manager matrix, version matrices,
  browser E2E) instead of silently under-covering and calling it done.

### Final verdict

**Approved.** P8 does exactly what its approved scope asked for, the pack
smoke script provably installs from real tarballs rather than workspace
source, all four verification commands pass independently, and the release
checklist accurately describes current behavior and deferred work.
`docs/plans/v1-collaboration-spec.md` can mark P8 `done`.
