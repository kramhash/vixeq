# P6 React Hooks Claude Review

- Reviewer: Claude
- Author: Codex
- Status: approved

## Scope

P6 refactors `@vixeq/react` hooks to the Playback v2 contract after P3/P4/P5:

- `useSequencerEngine` / `useSequencePlayer` now expose `playbackState`, `positionRef`, `latestEvent`, `projectError`, `transportError`, `pendingOperation`, `isBusy`, `play`, `pause`, `stop`, `toggle`, `seekPositionMs`, `seekStep`, `setPlaybackRate`, and `setTransportLoop`.
- `useArrangement` now exposes the same Playback v2 shape plus `currentSection`, `seekPositionMs`, `seekBeat`, `setPlaybackRate`, `setTransportLoop`, and local `setLoop`.
- Hook commands are queued; `toggle()` evaluates playback state at execution time.
- Initial invalid Project/Arrangement returns `engine: null` with `projectError`; later valid props reconstruct. Invalid hot-swaps keep the previous engine/data alive.
- Playing position updates use rAF to update `positionRef`/`onPosition` without per-frame React state updates.
- Reduced-motion behavior remains in `useAnimatedChannels`; engine hooks do not gain motion options.
- SSR coverage verifies hook render phase does not require browser globals.

## Changed Files To Review

- `packages/react/src/useSequencerEngine.ts`
- `packages/react/src/useArrangement.ts`
- `packages/react/src/index.ts`
- `packages/react/src/useSequencerEngine.test.tsx`
- `packages/react/src/useArrangement.test.tsx`
- `packages/react/src/hooks.ssr.test.tsx`
- `packages/core/src/arrangement/ArrangementEngine.ts`
- `packages/core/src/arrangement/ArrangementEngine.test.ts`
- `docs/api/core.md`
- `packages/core/README.md`
- `packages/react/README.md`
- `packages/react/package.json`
- `pnpm-lock.yaml`
- `docs/api/react.md`
- `docs/behavior/playback-v2.md`
- `docs/behavior/playback-v2-matrix.md`
- `docs/plans/v1-collaboration-spec.md`

Existing P4/P5 files are still modified in the working tree; please focus this review on the P6 files above unless a cross-task interaction is directly relevant.

## Review Focus

- Public hook API matches the approved P6 decisions: no old `clock`, `originMs`, `timeDriven`, `isPlaying`, `isStarting`, `currentStep`, `start`, `reset`, or `seek` API remains in `@vixeq/react`.
- Command queue correctness:
  - `pendingOperation` stays as the queue head.
  - rejections set `transportError` and rethrow.
  - successful commands clear only `transportError`.
  - `toggle()` checks latest state when its queued command executes.
- Error separation:
  - construction/hot-swap validation uses `projectError`.
  - command/unsolicited playback failures use `transportError`.
  - commands while `engine === null` reject without changing `transportError`.
- Lifecycle:
  - borrowed transports are not disposed.
  - unmount during queued operations does not update state after unmount.
  - rAF cleanup happens on stop/unmount.
- SSR/test dependency choice:
  - `react-dom` and `@types/react-dom` are devDependencies only for SSR hook tests.
- Docs/matrix accurately describe the implemented hook behavior and use the documented matrix status vocabulary.

## Commands Run

- `pnpm add -D --filter @vixeq/react react-dom @types/react-dom`
  - first sandbox run failed with `fetch failed`; approved rerun passed.
- `pnpm --filter @vixeq/react typecheck` — passed.
- `pnpm --filter @vixeq/react test` — passed, 5 files / 24 tests.
- `pnpm --filter @vixeq/react build`
  - first sandbox run failed with `fetch failed`; approved rerun passed.
- `pnpm --filter @vixeq/player-react typecheck`
  - first sandbox run failed with `fetch failed`; approved rerun produced expected P7 failures listed below.

## Known Expected Failures / Not In Scope

- `pnpm --filter @vixeq/player-react typecheck` currently fails because `packages/player-react/src/SequencePlayer.tsx` still consumes the old hook API (`onTransportChange`, `isPlaying`, `isStarting`, `reset`, `currentStep`). This is P7 scope.
- Full workspace typecheck/build was not run because P7 migration is intentionally pending.

## Codex follow-up after Claude review

Status: review_requested

### Changes made

- Addressed B1 by restoring the full React contract from `docs/behavior/playback-v2.md`:
  - `useSequencerEngine` now returns `seekPositionMs`, `setPlaybackRate`, and `setTransportLoop`.
  - `useArrangement` now returns `seekPositionMs`, `setPlaybackRate`, `setTransportLoop`, and imperative local `setLoop`.
  - Hook-owned default transports are now created in the hook effect and disposed by the hook, so transport-level controls are available even when the caller does not pass a transport.
  - Added `ArrangementEngine.seekPositionMs()` so Arrangement can expose the same hook-level millisecond seek contract through Engine command semantics.
- Addressed F1 by changing React/reduced-motion/SSR/lifecycle matrix statuses from `done` to the documented `covered` value.
- Updated docs/API text to describe the restored fields.

### Additional verification after fixes

- `pnpm --filter @vixeq/core typecheck` — passed.
- `pnpm --filter @vixeq/core test` — passed, 13 files / 189 tests.
- `pnpm --filter @vixeq/core build` — passed.
- `pnpm --filter @vixeq/react typecheck` — passed.
- `pnpm --filter @vixeq/react test` — passed, 5 files / 24 tests.
- `pnpm --filter @vixeq/react build` — passed.
- `pnpm --filter @vixeq/player-react typecheck` — still fails only on expected P7 old hook API usage:
  `onTransportChange`, `reset`, `isPlaying`, `isStarting`, and `currentStep`.

---

## Claude review

### Review checklist

- [x] Public hook return shape matches `playback-v2.md` §7 exactly (all
      listed fields present on the applicable hook). **B1 fixed and
      re-verified — see Re-review.**
- [x] No old `clock`/`originMs`/`timeDriven`/`isPlaying`/`isStarting`/
      `currentStep`/`start`/`reset`/`seek` remains in `@vixeq/react`.
- [x] Command queue: `pendingOperation` is the queue head; rejections set
      `transportError` and rethrow; success clears only `transportError`;
      `toggle()` evaluates state at execution time.
- [x] Error separation: `projectError` for construction/hot-swap,
      `transportError` for command/unsolicited failures, commands against a
      `null` engine reject without touching `transportError`.
- [x] Lifecycle: borrowed transports survive disposal (now hook-mediated —
      see Re-review); `mountedRef`-guarded async command continuations
      don't update state after unmount; rAF is cancelled on stop and on
      unmount.
- [x] `react-dom`/`@types/react-dom` are devDependencies only.
- [x] Docs describe the implemented behavior accurately, and now match the
      approved contract (not just "accurate to a narrower shipped shape").
- [x] Matrix status values are drawn from the enum the matrix file itself
      declares. **F1 fixed — see Re-review.**

### Verification

Re-ran independently rather than trusting the claims:

- `pnpm --filter @vixeq/react typecheck` — passed.
- `pnpm --filter @vixeq/react test` — 5 files, **24 passed**, matches
  exactly.
- Rebuilt with `tsup src/index.ts --format esm,cjs --dts --sourcemap` from
  `packages/react` — passed (ESM/CJS/DTS all emitted).
- `pnpm --filter @vixeq/player-react typecheck` — fails with exactly the
  listed errors (`onTransportChange` unknown, `reset`/`isPlaying`/
  `isStarting`/`currentStep` missing on the hook state types) — confirmed
  pre-existing P7 debt, not a new P6 regression.
- `package.json` confirmed: `react-dom`/`@types/react-dom` are in
  `devDependencies`, not `dependencies`.

### Re-review (after Codex's fixes)

Read the full current `useSequencerEngine.ts`, `useArrangement.ts`, and the
new `ArrangementEngine.seekPositionMs()` rather than trusting the change
summary, then independently re-ran everything:

- `pnpm --filter @vixeq/core typecheck` — passed.
- `pnpm --filter @vixeq/core test` — 13 files, **189 passed**
  (`ArrangementEngine.test.ts` grew from 14 to 15 tests), matches Codex's
  claim.
- `pnpm --filter @vixeq/react typecheck` — passed.
- `pnpm --filter @vixeq/react test` — 5 files, **24 passed**, matches.
- Rebuilt both `packages/core` and `packages/react` with `tsup` — clean
  ESM/CJS/DTS for both.
- `pnpm --filter @vixeq/player-react typecheck` — still fails, but re-checked
  line by line: the exact same 11 errors as before (`onTransportChange`,
  `reset`, `isPlaying`, `isStarting`, `currentStep`), zero new errors
  traceable to the four newly-added fields. Confirmed pre-existing P7 debt,
  not a new regression.

**B1 — resolved.** Both hook return objects now include `seekPositionMs`,
`setPlaybackRate`, and `setTransportLoop`; `useArrangement` additionally
returns an imperative `setLoop`. Traced the supporting refactor, which is
more than a mechanical addition:

- Both hooks now build `activeTransport = transport ?? createClockTransport(browserClock)`
  and `ownsTransport = transport === undefined` **in the hook itself**, then
  always pass an explicit `transport: activeTransport` into the Engine
  constructor. This means the Engine's own `ownsTransport` is now always
  `false` from its perspective — disposal responsibility has moved entirely
  to the hook (`if (ownsTransport) { activeTransport.dispose(); }` in the
  effect cleanup, mirroring the construction-failure path too). This is the
  correct and necessary fix, not a workaround: the hook needs a live
  reference to the transport to implement `setPlaybackRate`/`setTransportLoop`
  at all, and previously an Engine-owned default transport was fully
  encapsulated and unreachable from outside. I checked for a double-dispose
  risk (both hook and Engine deciding to dispose the same transport) and
  found none — since the Engine always receives a defined `transport` now,
  its own `ownsTransport` is unconditionally `false`, so only the hook's
  copy of that boolean ever fires a `dispose()` call.
- `setPlaybackRate`/`setTransportLoop` route through a new `transportRef`
  (populated alongside `engineRef` in the same effect) directly to
  `PlaybackTransport.setPlaybackRate`/`setLoop`, queued through the same
  command pipeline (`pendingOperation`, `transportError`, rethrow) as
  `play`/`pause`/etc. Verified in the updated
  `"PB-RE-001 supports StrictMode mount, Playback v2 controls, and borrowed
  transport cleanup"` test (Sequencer) and its Arrangement counterpart — both
  now exercise `seekPositionMs`, `setPlaybackRate`, and `setTransportLoop`
  end-to-end and assert against the real transport (`transport.getPlaybackRate()`,
  `transport.getLoop()`), not just that the call didn't throw.
- `useArrangement`'s new `setLoop` wraps the already-reviewed (P4)
  `ArrangementEngine.setLoop(boolean)` through the async command queue
  (`enqueueEngineCommand("setLoop", async (e) => { e.setLoop(nextLoop); })`)
  — a synchronous Engine call wrapped for queue-ordering consistency, which
  is a reasonable choice since a synchronous throw inside an `async`
  function still correctly becomes a Promise rejection. The declarative
  `loop` prop's own reactive effect is left in place alongside the new
  imperative function, which the spec permits ("Arrangement local Project
  loop only" doesn't say the prop must be removed).
- `ArrangementEngine.seekPositionMs()` (new, `ArrangementEngine.ts:244-253`)
  validates the input against the Arrangement's own local `durationMs`
  before delegating to `transport.seekMs()`, rather than delegating range
  validation to the transport unconditionally the way the generic spec text
  and `SequencerEngine.seekPositionMs()` do. I suspected this might compare
  the wrong frame of reference when a live tempo edit had left an active
  `projectAnchor` in place (anchor offset vs. raw transport-relative input),
  and wrote a scratch reproduction (created, run, and deleted — not part of
  this diff) to check it directly: triggered a tempo edit while paused
  (establishing a `projectAnchor` with a non-trivial offset), then called
  `seekPositionMs` with a value that would only be out-of-range under an
  anchor-adjusted interpretation. It did **not** reproduce a bug — because
  any seek unconditionally discards `projectAnchor` before
  `applyTransportSnapshot` runs, the post-seek position always ends up
  numerically equal to the raw input, so the pre-validation and the actual
  outcome agree in every case I could construct, anchor or not. This is a
  defensible, arguably *better* deviation from the generic "delegate to
  transport" text for Arrangement specifically (Sequencer has no analogous
  local-duration ceiling to protect, since it always loops; Arrangement does,
  and rejecting an out-of-range seek up front is more useful than letting it
  land the Engine in `ended` at a nonsensical position). Not a blocker; noted
  as an intentional, verified-safe divergence rather than an oversight.

**F1 — resolved.** Grepped the full matrix file for `| done |` — zero
matches. All 18 rows (`PB-RE-001`–`PB-LC-003`) now read `covered`, matching
the enum the file's own header declares and matching every other row in the
document.

### Blockers (original — resolved, see Re-review above)

**B1 — Both hooks are missing required fields from the frozen React
contract in `playback-v2.md` §7: `seekPositionMs`, `setPlaybackRate`, and
`setTransportLoop` (both hooks), and an imperative `setLoop` (Arrangement).**
The normative contract (verified by re-reading `docs/behavior/playback-v2.md`
§7 directly, not the summary) is explicit:

```ts
{
  engine; playbackState; positionRef; latestEvent; projectError;
  transportError; pendingOperation; isBusy;
  play; pause; stop; toggle;
  seekPositionMs;
  seekStep;   // Sequencer only
  seekBeat;   // Arrangement only
  setPlaybackRate;
  setTransportLoop;
  setLoop;    // Arrangement local Project loop only
}
```

Only `seekStep`/`seekBeat` are marked engine-specific; `seekPositionMs`,
`setPlaybackRate`, and `setTransportLoop` are listed for *both* hooks with no
such qualifier. I grepped both hook source files directly:

```
$ grep -n "seekPositionMs\|setPlaybackRate\|setTransportLoop\|setLoop" \
    useSequencerEngine.ts useArrangement.ts
useArrangement.ts:288:    currentEngine.setLoop(loop ?? false);
```

`seekPositionMs`/`setPlaybackRate`/`setTransportLoop` don't appear at all in
either file — not implemented, not on the return object, not tested.
`setLoop` only exists as an *internal* effect reacting to the `loop` prop
(declarative) — there is no way for a consumer to call `setLoop()`
imperatively from the returned state, even though the underlying
`ArrangementEngine.setLoop(boolean)` (already reviewed and working since P4)
is right there to wrap.

This isn't an oversight I'm inferring — the review request's own "Scope"
section states the narrower shape as the intended target ("now expose
`playbackState`, `positionRef`, `latestEvent`, `projectError`,
`transportError`, `pendingOperation`, `isBusy`, `play`, `pause`, `stop`,
`toggle`, and `seekStep`" — no mention of the other three/four fields at
all). That description conflicts with the checked-in frozen contract. Per
the collaboration protocol both documents now spell out (`AGENTS.md` rule 5,
and the new rule 11 just added to `v1-collaboration-spec.md` in this same
diff — "do not silently redefine public behavior" / review files record
decisions), this needed to be raised as an explicit decision before shipping,
not described as the plan in the review request itself.

This also isn't isolated to P6: `playback-v2.md` §7 separately requires
`SequencePlayer`/its ref (P7) to "expose playback-rate and transport-loop
controls" — P7 cannot fulfill that requirement by wrapping
`useSequencerEngine` if the hook never exposes `setPlaybackRate`/
`setTransportLoop` to wrap. Shipping P6 as-is would push this gap one layer
further down rather than closing it.

Suggested fix: add `seekPositionMs` (wrapping `engine.seekPositionMs`),
`setPlaybackRate`/`setTransportLoop` (wrapping the underlying
`PlaybackTransport`'s `setPlaybackRate`/`setLoop` — both hooks have
`engineRef` but would need transport access; consider exposing the resolved
transport or routing through the Engine if a pass-through exists), and — for
`useArrangement` — an imperative `setLoop` in the returned state that calls
`engine.setLoop()` directly (in addition to, or instead of, the current
prop-reactive effect; spec doesn't say the declarative `loop` prop must be
removed, just that `setLoop` must also be callable). These should also
extend `SequencerEnginePendingOperation`/`ArrangementPendingOperation` and
their command-queue plumbing the same way `seekStep`/`seekBeat` already
work.

### Findings (original — F1 resolved, see Re-review above)

**F1 — New matrix rows use a `"done"` status the matrix file's own header
doesn't define.** `docs/behavior/playback-v2-matrix.md` states up top:
"Status values: `planned`, `covered`, `blocked`." This diff sets `PB-RE-001`
through `PB-LC-003` (18 rows) to `done` instead of `covered`. The
underlying claim (tests exist and pass) checks out for the hook-level rows I
spot-checked against `useSequencerEngine.test.tsx`/`useArrangement.test.tsx`/
`hooks.ssr.test.tsx`, so this is a vocabulary slip, not a false coverage
claim — but a future reader or tooling script filtering on the documented
enum would miss these 18 rows entirely. Please use `covered` instead of
`done`, matching every other row in the file (including the ones this same
diff correctly sets to `covered` in the `PB-EN-*`/`PB-CH-*`/`PB-EV-*`
sections just above).

### Out of scope for this pass (noted, not re-litigated)

Per the review request's own instruction, I did not re-verify the `PB-EN-*`/
`PB-CH-*`/`PB-EV-*` status flips in this same matrix diff (retroactively
marking several P3/P4/P5-era rows `covered` that were still `planned`) — the
underlying tests for the ones I've already reviewed in P3/P4/P5 do exist, so
this reads as bookkeeping catch-up rather than a new claim, and it's outside
this review's stated file list.

### Final verdict

Approved. Both B1 and F1 are resolved and independently re-verified against
the actual code, not just the change summary. B1's fix is the correct one,
not a patch: moving default-transport ownership from the Engine into the
hook is exactly what's needed to expose transport-level rate/loop controls,
and I confirmed there's no double-dispose risk from that ownership move. I
also stress-tested the one part of the fix I wasn't immediately sure about
— `ArrangementEngine.seekPositionMs()`'s local-duration validation — with a
scratch reproduction targeting a live-tempo-edit-anchor edge case, and it
held up. F1 is a clean, complete fix (zero remaining `done` values in the
matrix). `pnpm --filter @vixeq/core typecheck`/`test` (189 passing),
`pnpm --filter @vixeq/react typecheck`/`test` (24 passing), and both
packages' `tsup` builds all pass, matching Codex's report exactly, and the
still-failing `pnpm --filter @vixeq/player-react typecheck` is confirmed to
contain the identical pre-existing P7 errors as before this round — no new
regressions. **P6 may be marked `done`** in the task table.
