# P5 Sampling, ChannelSource, and Envelopes — Claude Review

- Reviewer: Claude
- Author: Codex
- Status: approved
- Task: P5
- Contract: [`../behavior/playback-v2.md`](../behavior/playback-v2.md)
- Matrix: [`../behavior/playback-v2-matrix.md`](../behavior/playback-v2-matrix.md)

Review findings belong in this file. Do not edit implementation, normative
specification, migration, or matrix files directly.

## Implementation scope

- `Envelope` gains `reset()`; `createEnvelope`/`createDecayEnvelope` both
  implement it. `createDecayEnvelope.trigger()` now also updates the sample
  baseline (`lastSampleTime`) so a fresh trigger doesn't inherit a stale decay
  window.
- `useAnimatedChannels`: interpolation mode calls `engine.sampleChannels(easing)`
  (no rAF timestamp); envelope mode triggers from `StepEvent.scheduledPositionMs`
  and samples from `engine.getPosition().positionMs`; resets all envelopes on
  `"seek"`/`"stop"` playback events and per-channel on `"project"` events with
  `changedChannelIds`.
- `reducedMotion?: boolean` replaced with `motionPreference?: "system" |
  "reduce" | "no-preference"`; `latestEvent` fallback removed.
- `usePrefersReducedMotion()`'s initial state now eagerly reads `matchMedia`
  in the `useState` initializer instead of always starting `false`.
- `ChannelSource`'s generic `"playback"`/`"project"` overloads (fixed in the
  P4 pass) are unchanged and correctly still generic.

## Files reviewed

- `packages/core/src/envelope.ts`, `packages/core/src/envelope.test.ts`
- `packages/core/src/types.ts`, `packages/core/src/index.ts`
- `packages/react/src/useAnimatedChannels.ts`,
  `packages/react/src/useAnimatedChannels.test.tsx`
- `packages/react/src/usePrefersReducedMotion.ts`
- `docs/api/core.md`, `docs/api/react.md`
- `packages/core/README.md`, `packages/react/README.md`
- `docs/migrations/0.7-playback-v2.md`
- `docs/behavior/playback-v2-matrix.md`

## Review checklist

- [x] `Envelope.trigger(positionMs)`/`sample(positionMs)`/`reset()` contract;
      `createEnvelope`/`createDecayEnvelope` reset correctly; decay envelope's
      trigger updates the sample baseline so backward/seeked sampling doesn't
      leak old decay state.
- [x] Interpolation mode samples without rAF time; envelope mode triggers
      from `scheduledPositionMs` and samples from `getPosition().positionMs`;
      pause/buffering freeze inherited correctly from Engine position
      freezing; seek/stop reset before destination retrigger; project
      changes reset only `changedChannelIds` without retrigger.
- [x] Reduced-motion behavior matches the frozen contract. **B1 fixed and
      re-verified — see Re-review.**
- [x] `motionPreference: "system"` reads `matchMedia` only after mount, per
      §8. **B2 fixed and re-verified — see Re-review.**
- [x] API removals (`reducedMotion`, `latestEvent`) are clean; no leftover
      references in code or docs.
- [x] Matrix `covered` rows are fully justified by their tests. **F1 fixed
      with a dedicated test — see Re-review.**

## Verification

Re-ran independently:

- `pnpm --filter @vixeq/core typecheck` — passed.
- `pnpm --filter @vixeq/core test` — 13 files, **188 passed**
  (`envelope.test.ts` has 23 tests), matches Codex's claim.
- `pnpm --filter @vixeq/react exec vitest run src/useAnimatedChannels.test.tsx
  src/usePrefersReducedMotion.test.tsx` — 2 files, **7 passed**, matches.
- `pnpm --filter @vixeq/react typecheck` — fails, but every error is in
  `useSequencerEngine.ts` (old `TransportEvent`/`setBpm`/`start`/`isPlaying`/
  `reset` references) — confirmed pre-existing P6 debt, no new failures
  traceable to `useAnimatedChannels.ts` or `usePrefersReducedMotion.ts`.
- Did not independently rebuild `packages/core` with `tsup` this pass (no
  public type/export surface changed beyond what P4 already added); typecheck
  + test coverage was sufficient to confirm the claims.

## Staged-migration note

Accepted. `useSequencerEngine`/`useArrangement` remain on pre-Playback-v2
APIs (P6 scope) and are out of scope here. Nothing in this review depends on
them.

## Re-review (after Codex's fixes)

Read the full current `useAnimatedChannels.ts`, `usePrefersReducedMotion.ts`,
and `useAnimatedChannels.test.tsx` rather than trusting the change summary,
then re-ran independently:

- `pnpm --filter @vixeq/core typecheck` — passed.
- `pnpm --filter @vixeq/core test` — 13 files, **188 passed** (unchanged;
  this pass touched no Core files).
- `pnpm --filter @vixeq/react exec vitest run src/useAnimatedChannels.test.tsx
  src/usePrefersReducedMotion.test.tsx` — 2 files, **9 passed**
  (`useAnimatedChannels.test.tsx` grew from 6 to 8 tests).
- `pnpm --filter @vixeq/react typecheck` — still fails, but re-checked line
  by line: every remaining error is in `useSequencerEngine.ts`
  (`TransportEvent`/`setBpm`/`start`/`isPlaying`/`reset`); grepped the output
  for `useAnimatedChannels`/`usePrefersReducedMotion` — zero matches. No new
  P5-caused failures.

**B1 — resolved.** `useAnimatedChannels.ts` now splits the previously-single
discrete-event effect into two:
- The `"step"` subscription (`:92-110`) stays gated on `!reducedMotion` —
  ordinary ticks are still correctly ignored under reduced motion.
- The `"playback"`/`"project"` subscription (`:112-140`) is now **unconditional**
  on `engine` alone (not gated on `reducedMotion`), so it stays active even
  while reduced. Inside, `"seek"`/`"stop"` and `"project"` each still reset
  the affected envelope(s) as before, and now additionally call
  `sampleCurrent()` exactly when `reducedMotion` is true — i.e., normal mode
  is unaffected (rAF already re-samples every frame) and reduced mode gets
  exactly the one fresh sample the spec requires per explicit change.

Traced the new test (`"samples once, ignores steps, and re-samples explicit
changes when motionPreference is reduce"`, `useAnimatedChannels.test.tsx:223-
264`) by hand against this code and it matches: initial mount samples once
(`a:sample:750`); `engine.listeners.step.size === 0` (steps still ignored);
`playback`/`project` listener counts are `1` each (proving the subscription
is genuinely active under reduced motion, not just coincidentally passing);
emitting a `"step"` while reduced never calls `envelope.trigger`; emitting
`"seek"` produces `a:reset` then `a:sample:1000`; emitting a `"project"` with
`changedChannelIds: ["a"]` produces another `a:reset` then `a:sample:1000`.
This is exactly the spec's "do not react to ordinary step ticks" +
"sample once for explicit seek, stop, or Project change" split, now
correctly implemented and — importantly — the test would fail if either
subscription were dropped again (unlike the old test, which asserted the
opposite and would have caught a *re-introduction* of the subscription, not
protect against removing it — this version protects the right invariant in
both directions).

**B2 — resolved.** `usePrefersReducedMotion.ts` reverted exactly to
`useState(false)` with the `useEffect` reading `matchMedia` and calling
`setReduced` after mount — byte-for-byte the pre-P5 pattern, confirmed
matching both the doc comment above it and `playback-v2.md` §8's "reads
`matchMedia` after mount." No hydration-mismatch regression remains.

**F1 — resolved.** New dedicated test `"PB-EV-001 freezes envelope sampling
while engine position is frozen and resumes from the next position"`
(`useAnimatedChannels.test.tsx:163-183`) explicitly holds `engine.positionMs`
constant at `625` across two separate rAF frames, asserts
`envelope.sample` is called with the identical position both times (the
freeze), then advances position to `700` and asserts the next sample reflects
that (the resume) — `["a:trigger:500", "a:sample:625", "a:sample:625",
"a:sample:700"]`. This is exactly the freeze-then-resume scenario `PB-EV-001`
describes, previously only indirectly implied by an unrelated test.

## Blockers (original — both resolved, see Re-review above)

**B1 — Reduced motion never re-samples on explicit seek, stop, or Project
change, contradicting `playback-v2.md` §6.** The normative contract is
explicit and lists this as a *distinct* requirement from the initial freeze:

> Under reduced motion:
> - stop rAF and sample once;
> - do not react to ordinary step ticks;
> - **sample once for explicit seek, stop, or Project change;**
> - resume rAF from current position when reduction is disabled.

`useAnimatedChannels.ts:92-93` gates the *entire* discrete-event subscription
effect on `reducedMotion`:
```ts
useEffect(() => {
  if (!engine || !envelopes || reducedMotion) return;
  const offStep = engine.on("step", ...);
  const offPlayback = engine.on("playback", ...);   // seek/stop reset
  const offProject = engine.on("project", ...);      // changedChannelIds reset
  ...
}, [engine, envelopes, reducedMotion]);
```
When `reducedMotion` is `true`, none of `step`/`playback`/`project` are
subscribed at all — not just `step` (the "ordinary tick" case the spec says
to ignore), but also `playback` (seek/stop) and `project` (Project changes),
which the spec explicitly says *should* each trigger one fresh sample. The
existing test locks this in rather than catching it:
```ts
// useAnimatedChannels.test.tsx:201-214
renderHook(() => useAnimatedChannels(engine, { motionPreference: "reduce", onFrame }));
...
expect(engine.listeners.step.size).toBe(0);
expect(engine.listeners.playback.size).toBe(0);
expect(engine.listeners.project.size).toBe(0);
```
Concretely: a reduced-motion user who seeks to a different part of the
timeline, stops playback, or has the Project hot-swapped will see the
visualization frozen at whatever it showed when the component mounted (or
last time `motionPreference`/`engine`/`envelopes`/`easing` changed) — it
never updates to reflect the new position or value, even once. This is a
real, user-visible accessibility regression, not a theoretical edge case:
reduced-motion is specifically *for* users who still need correct static
state, just without continuous animation.

Note: the task's own review-focus text for this session describes the
*current* (no-subscription) behavior as the intended target ("does not
subscribe to step/playback/project discrete updates"). That description
conflicts with the checked-in normative contract I quoted above, which I
verified by re-reading `docs/behavior/playback-v2.md` §6 directly rather
than relying on the summary. Per `AGENTS.md`'s protocol ("stop and record a
required decision when implementation conflicts with the approved
specification"), this needs an explicit decision — either implement the
spec's seek/stop/project re-sample (e.g., keep the `playback`/`project`
subscriptions active even under `reducedMotion`, filtered to `seek`/`stop`
and any `changedChannelIds`, each triggering exactly one `sampleCurrent()`
call, while still ignoring ordinary `step` ticks), or amend §6 of the
approved spec to match the simpler no-subscription behavior. I don't have
enough context to know which the team prefers, so I'm not picking one — but
shipping the current mismatch silently isn't an option per the
collaboration rules.

**B2 — `usePrefersReducedMotion()` now reads `matchMedia` synchronously
during the initial render, not after mount, contradicting both `playback-
v2.md` §8 ("`motionPreference: 'system'` reads `matchMedia` after mount")
and the function's own unchanged doc comment.** `usePrefersReducedMotion.ts`:
```ts
/** Returns false during SSR, then follows the browser preference after mount. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(QUERY).matches;
  });
  useEffect(() => { /* unchanged: subscribes and calls setReduced again */ }, []);
  ...
}
```
The `useState` lazy initializer runs synchronously during React's render
phase — before commit, before effects, before "mount" in any sense the spec
or the doc comment above it means. For a component hydrating from
server-rendered HTML (server has no `window`, so SSR output is always
computed with `reduced === false`), the client's first render now
*synchronously* computes the real OS preference instead of matching the
server's `false` — reintroducing exactly the hydration-mismatch class of bug
this hook's original `useState(false)` + `useEffect` pattern existed to
avoid. It's also simply inconsistent with its own doc comment even outside
SSR: for a plain client-only render, the hook no longer "returns false...
then follows... after mount" — it returns the real value immediately.
Fix: revert to `useState(false)` and let the existing `useEffect`'s `update()`
call (which already runs synchronously via `useLayoutEffect`-timing... no,
via `useEffect`, i.e., after paint) establish the real value post-mount, or
if the eager read is intentional for perceived-performance reasons, that's a
spec change (§8) that needs to be recorded, not a silent one.

## Findings (original — F1 resolved, see Re-review above)

**F1 — `PB-EV-001` ("Envelope pause/resume") is marked `covered` without a
dedicated freeze-then-resume test.** The closest test
(`"triggers envelopes with scheduled positions and samples with logical
engine position"`) advances `engine.positionMs` across three different rAF
frames (`0 -> 625 -> 625 -> 700`, i.e., one repeated value) but doesn't
explicitly frame it as "paused, verify identical output across multiple
frames, then resume and verify decay continues correctly from where it left
off" the way the row's description implies. The underlying mechanism (relying
on the Engine's own already-tested position freeze) is sound and I traced it
by hand to confirm it's correct, but the *test* doesn't make that scenario
explicit. Low priority — consider a small dedicated test or adjusting the
row's evidence trail.

## What's solid

- `Envelope.reset()` on both implementations is correct: `createEnvelope`
  clears `triggerTime`/`triggerPeak`; `createDecayEnvelope` clears `current`/
  `lastSampleTime`. Both verified against the new tests.
- `createDecayEnvelope.trigger()` now setting `lastSampleTime = _timeMs` is a
  real, correct fix — traced by hand: without it, a fresh trigger immediately
  followed by a `sample()` at a position later than the *previous* stale
  `lastSampleTime` would apply spurious immediate decay to the just-excited
  value before returning it. The new "does not leak old decay state after
  reset and backward sampling" test exercises exactly this.
- Interpolation-mode sampling, envelope trigger/sample position sourcing,
  seek/stop reset ordering (verified this depends on `SequencerEngine`/
  `ArrangementEngine` emitting their `"playback"` event before the
  destination `"step"` event on seek — true in both Engines as reviewed in
  P3/P4, though this cross-cutting ordering guarantee isn't written down
  anywhere as an explicit contract; worth a one-line note in `playback-v2.md`
  §5/§6 if it isn't already load-bearing elsewhere), and Project-change
  per-channel reset are all correctly implemented and tested.
- `latestEvent` and `reducedMotion` removal is clean — no leftover references
  in code, types, or docs.
- `ChannelSource`'s generic `"playback"`/`"project"` handler types (fixed in
  P4) remain correctly generic; not regressed by this pass.

## Open questions (resolved)

- B1's underlying question — implement the spec's re-sample, or amend the
  spec — is now moot: Codex implemented the spec's behavior (keep
  `playback`/`project` subscribed under reduced motion, sample once per
  explicit change) rather than weakening the normative doc. No spec edit was
  needed.
- B2's question (deliberate vs. accidental) is also moot: the eager read was
  reverted, so the hook matches its original documented contract again.

## Final verdict

Approved. Both blockers and the one finding from the previous review are
resolved and independently re-verified against the actual code, not just the
change summary: B1's fix was traced by hand and confirmed to implement the
frozen contract's split behavior exactly (ignore ordinary ticks, react to
seek/stop/project with one fresh sample), with a test that would fail in
*either* direction of regression (dropping the subscription or losing the
tick-ignoring behavior). B2 is a byte-for-byte revert to the pre-P5,
spec-compliant pattern. F1 now has a dedicated, explicit freeze-then-resume
test. `pnpm --filter @vixeq/core typecheck`/`test` (188 passing) and the
targeted React test run (9 passing) all match Codex's report, and the
still-failing `pnpm --filter @vixeq/react typecheck` is confirmed to contain
zero references to either file this pass touched — purely pre-existing P6
debt in `useSequencerEngine.ts`. **P5 may be marked `done`** in the task
table.
