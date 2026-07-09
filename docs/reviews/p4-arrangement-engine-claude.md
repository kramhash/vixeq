# P4 ArrangementEngine Playback v2 — Claude Review

- Reviewer: Claude
- Author: Codex
- Status: approved
- Task: P4
- Contract: [`../behavior/playback-v2.md`](../behavior/playback-v2.md)
- Matrix: [`../behavior/playback-v2-matrix.md`](../behavior/playback-v2-matrix.md)

Review findings belong in this file. Do not edit implementation, normative
specification, migration, or matrix files directly.

## Implementation scope

- Refactored `ArrangementEngine` from raw `clock`/`originMs` APIs to
  `PlaybackTransport` ownership/borrowing, keeping the v1 Arrangement schema.
- Added async `play()`, `pause()`, `stop()`, `seekBeat()` controls.
- Added synchronous `setLoop(boolean)` for local Project loop, independent of
  transport loop.
- Added Engine `"playback"` events (`ArrangementPlaybackEvent`) with
  command/transport/local-end causes and `ArrangementPlaybackSnapshot`
  (adds `section` to the generic snapshot).
- Local end (non-looping arrangement reaching its own duration) is tracked
  entirely as Engine-local state and never stops a shared transport.
- `setArrangement()` preserves fractional beat via an internal anchor,
  without seeking the transport; shortening either clamps-to-end-and-ends
  (non-looping) or modulos-and-continues (looping).
- Updated Arrangement behavior matrix rows and Core README/API docs.

## Files reviewed

- `packages/core/src/arrangement/ArrangementEngine.ts`
- `packages/core/src/arrangement/types.ts`
- `packages/core/src/arrangement/ArrangementEngine.test.ts`
- `packages/core/src/arrangement/index.ts`
- `packages/core/src/index.ts`
- `packages/core/src/types.ts` (for `ChannelSource` cross-check)
- `docs/api/core.md`, `packages/core/README.md`
- `docs/behavior/playback-v2-matrix.md`

## Review checklist

- [x] `transport` option instead of `clock`/`originMs`; async play/pause/
      stop/seekBeat; `"playback"` events, not `"transport"`; borrowed
      transport not disposed; default transport owned/disposed; listener
      exceptions isolated; disposed-Engine APIs throw.
- [x] Local end is Engine-local state, doesn't stop a shared transport;
      local loop independent of transport loop; `setLoop()` validates,
      no-ops on same value, emits one `loopchange` on change.
- [x] `setArrangement()` doesn't seek the transport, uses an internal anchor
      for BPM changes, is atomic on invalid input, and shortens correctly
      (clamp+end when non-looping, modulo+continue when looping).
- [x] Event payloads are correct in every case. **Blocker B1 fixed and
      independently re-verified — see Re-review.**
- [x] Matrix `covered` rows are fully justified by their tests. **F1 fixed
      — see Re-review.**

## Verification

Re-ran independently:

- `pnpm --filter @vixeq/core typecheck` — passed.
- `pnpm --filter @vixeq/core test` — 13 files, **183 passed**
  (`ArrangementEngine.test.ts` has 12 tests), matches Codex's claim.
- Rebuilt with `tsup src/index.ts src/dom.ts --format esm,cjs --dts
  --sourcemap` from `packages/core` — passed.
- Wrote two standalone scratch reproductions (created, run, and deleted —
  not part of this diff) to check behavior the static read left uncertain:
  one confirmed Blocker B1 below; one confirmed (via an isolated `tsc
  --noEmit` assignability check) that `ArrangementEngine` currently
  satisfies `ChannelSource` only via TypeScript's bivariant method-parameter
  checking — see Finding F2.

## Staged-migration note

Accepted. P4 intentionally touches only `@vixeq/core`'s Arrangement files.
`useArrangement` (React), Player React, and examples still call the old
`clock`/`start()`/`isPlaying()`/`seek()` API and fail workspace-wide
typecheck today — confirmed via `pnpm -r --no-bail typecheck`, but this is
pre-existing, expected P6/P7 debt (the same pattern already accepted for
`examples/vanilla-core` after P3), not something P4 introduced. Full
workspace typecheck/build is correctly not a P4 gate.

## Re-review (after Codex's fixes)

Re-read the changed files (`ArrangementEngine.ts`, `ArrangementEngine.test.ts`,
`types.ts`, `index.ts`) in full rather than trusting the change summary, then
independently re-verified:

- `pnpm --filter @vixeq/core typecheck` — passed.
- `pnpm --filter @vixeq/core test` — 13 files, **185 passed**
  (`ArrangementEngine.test.ts` now has 14 tests).
- Rebuilt with `tsup src/index.ts src/dom.ts --format esm,cjs --dts
  --sourcemap` — passed.
- Wrote two fresh standalone scratch reproductions (created, run, deleted —
  not part of this diff) targeting exactly B1's original failure mode:
  1. Default-shaped **unbounded** transport (the original repro: transport
     stays `"playing"` through local end) — now emits
     `{ type: "play", cause: "command", previousState: "ended" }` and step
     `{ stepIndex: 0, cause: "play" }`, position 0. Matches spec.
  2. A **bounded** transport that itself also reaches `"ended"` — same
     correct result, confirming the fix doesn't regress the path that
     already worked (where `transport.play()` is a real command).

**B1 — resolved.** The fix (`ArrangementEngine.ts:197-220` for `play()`,
`:421-450` and `:468-488` for `handleTransportEvent`) tracks which of two
modes a replay-from-`ended` is in — `"seek-as-play"` when
`transport.getPlaybackState() === "playing"` (only `seekMs(0)` is issued,
since `play()` would no-op), or `"suppress-seek"` when the transport isn't
currently playing (both `seekMs(0)` and `play()` are issued, and the
resulting intermediate `"seek"` event is suppressed via
`pendingEndedReplayPlay` so only the final `"play"` is externally visible,
correctly stamped with `previousState: "ended"`). Traced both branches by
hand against the code and confirmed with the reproductions above that both
converge on the same, spec-correct external event: one `play`/`cause:
"play"` playback event and one step with `cause: "play"`, never a `seek`.
Error paths (`.catch()` resetting `endedReplaySeekMode`/
`pendingEndedReplayPlay`) are handled so a failed resume doesn't corrupt a
later unrelated seek/play classification. The new regression test
(`"PB-TR-006 replays from local ended with play metadata while transport
keeps running"`) covers exactly the originally-broken scenario and asserts
the same fields I checked independently.

One minor, non-blocking nit: that test's ID tag, `PB-TR-006`, names a
*transport-level* matrix row ("play from ended → resets to 0 before play")
that's already satisfied at the transport layer since P1. This new test is
really an *Engine*-level scenario (checking `EnginePlaybackEvent`/`StepEvent`
cause labeling, which `PB-TR-006` doesn't describe) with no dedicated matrix
row of its own. Doesn't affect correctness — just makes the ID harder to
trace later. Consider adding a dedicated `PB-EN-XXX` row for "replay from
local `ended` while the transport is still playing" the next time the matrix
is touched.

**F1 — resolved.** Confirmed by reading the updated tests directly:
- `PB-EN-006 PB-EN-010` now does `seekBeat(4)` then `seekBeat(1)` (forward
  then backward) and asserts both destination-only steps
  (`["play:0","seek:0","seek:1"]`), closing the backward-seek gap.
- `PB-EN-013 PB-EN-013A` now captures `previousPosition`/`previousState`
  before the invalid `setArrangement()` call and asserts
  `getArrangement()`/`getPlaybackState()`/`getPosition()` are all unchanged
  after the thrown `TypeError`, matching the atomicity claim the row makes.

**F2 — resolved.** `packages/core/src/types.ts` now defines
`ChannelProjectEvent` (the generic base, `changedChannelIds`/
`previousChannels`/`channels`/`positionMs`/`beat`, no `project`/
`previousProject`/`stepIndex`) and `ChannelSource` now reads:
```ts
on(eventName: "playback", handler: (event: EnginePlaybackEvent) => void): Unsubscribe;
on(eventName: "project", handler: (event: ChannelProjectEvent) => void): Unsubscribe;
```
— the generic base types, not the Sequencer-specific ones. A new compile-
surface test (`"exposes ArrangementEngine through the generic ChannelSource
surface"`) assigns `const source: ChannelSource = new ArrangementEngine(...)`
and only touches fields that exist on the generic base (`event.snapshot.
positionMs`, `event.changedChannelIds`), so a future regression narrowing
`ChannelSource` back to a concrete engine's shape would fail to compile, not
just fail silently. This is a real regression guard, not just a fix.

**F3 — acceptable as-is; no change needed.** `setArrangement()` replaces the
*entire* arrangement, including the `sections`/`patterns` data a given
section id resolves through. Two arrangements can share a section id
(`"s1"`) while that id now points at a different `patternId`, or the pattern
it points to has different steps/track data — a real, consumer-relevant
change that the step-key comparison (which only cares about the resolved
*step*) wouldn't necessarily surface, but which a "current section" listener
(e.g., driving a UI label or CSS class from the active section/pattern)
would want to know about. Force-emitting the section event on every
`setArrangement()` is the safer default given that ambiguity — the
asymmetry with the step-event comparison is intentional, not an oversight,
since steps and sections have different identity-vs-content stability
expectations here. No change requested.

## Blockers (original — resolved, see Re-review above)

**B1 — Resuming from local `ended` emits a `seek`-typed playback event and
a step with `cause: "seek"`, not `play`/`cause: "play"`, whenever the
underlying transport hasn't itself stopped — the common case.**
`ArrangementEngine.ts:199-207`:

```ts
if (this.playbackState === "ended") {
  return this.runTransportCommands(["seek", "play"], async () => {
    await this.transport.seekMs(0);
    await this.transport.play();
  });
}
```

This two-step workaround exists because Arrangement's `"ended"` is a purely
local concept (§2.4/§3.2 of `playback-v2.md`): the default owned transport
is unbounded and never reaches its own end, so when the Engine is locally
`"ended"` the transport is very often still `"playing"`. In that case
`transport.play()` is a genuine no-op (state unchanged, no event), so the
*only* transport event that actually fires is `"seek"` — which
`handleTransportEvent`'s generic `"seek"` branch (`ArrangementEngine.ts:450-
457`) then reports as `cause: "seek"`, instead of matching the `ended ->
play` contract ("resets to 0 first" / "reset and emit step 0" with `cause:
"play"`, §3.2 and §5).

Reproduced concretely (default-shaped unbounded transport, non-looping
arrangement; test written, run, and removed — not part of this diff):

```ts
await engine.play();               // stopped -> playing
clock.advance(pastDuration);       // -> engine "ended"; transport stays "playing"
await engine.play();               // resume
// observed: playback [{ type: "seek", cause: "command", previousState: "ended" }]
//           step      { stepIndex: 0, cause: "seek" }
// expected: playback [{ type: "play", ... }]; step cause: "play"
```

Position itself is correct (0) — only the `type`/`cause` metadata is wrong.
This is not an edge case: it is the class's own stated motivating scenario
for local-end semantics (doc comment: "arrangement end and loop behavior
are local Engine semantics"). No test in `ArrangementEngine.test.ts` calls
`play()` a second time after reaching `"ended"` — the closest test,
`PB-EN-016`, only checks that `"ended"` is reached and the transport
survives — which is why this shipped. Suggested direction: set a private
flag before issuing the `seekMs(0)`/`play()` pair and have the `"seek"`
handler branch re-classify the resulting event as `play`/`cause: "play"`
when that flag is set, rather than relying on whichever transport event
happens to actually fire. Add a regression test for exactly this scenario.

## Findings (original — F1/F2 resolved, F3 accepted as-is, see Re-review above)

**F1 — Two matrix rows are `covered` on partial evidence.**
- `PB-EN-010` ("explicit forward/backward seek → missedStepPolicy ignored")
  is marked `covered` by a test (`PB-EN-006 PB-EN-010 seekBeat maps beat...`)
  that only performs a *forward* seek; backward isn't exercised for
  Arrangement.
- `PB-EN-013` ("old Project/state/position/cursor remain atomic") — the
  Arrangement-side test (`PB-EN-013A`) only asserts `setArrangement()`
  throws for invalid input; it never asserts `getArrangement()`/position/
  state are unchanged afterward (the analogous `SequencerEngine` test does
  check this). The validate-before-mutate code shape supports atomicity;
  it's just unasserted for Arrangement.

**F2 — `ChannelSource`'s generic `"playback"` overload is still pinned to
the Sequencer-shaped event.** `packages/core/src/types.ts:191-199`:
```ts
export type ChannelSource = {
  ...
  on(eventName: "playback", handler: SequencerEventHandler<"playback">): Unsubscribe;
  ...
};
```
`SequencerEventHandler<"playback">` resolves to `(event: SequencerPlaybackEvent) => void`
(`snapshot.stepIndex`). `ArrangementEngine` hands out `ArrangementPlaybackEvent`
(`snapshot.section`, no `stepIndex`). An isolated `tsc --noEmit` check
confirmed `const cs: ChannelSource = new ArrangementEngine(...)` compiles
today — TypeScript's bivariant method-parameter checking papers over the
mismatch — but a consumer writing genuinely engine-agnostic `ChannelSource`
code that reads `event.snapshot.stepIndex` would silently get `undefined`
for an Arrangement engine. Not introduced by this diff (the binding predates
P4), but P4 is where it becomes concrete, since it's the first second,
differently-shaped snapshot to exist. Fix: `on(eventName: "playback",
handler: (event: EnginePlaybackEvent) => void)` — the generic base type.

**F3 — `setArrangement()` force-emits a section event even when the section
didn't change, asymmetric with its own step-event handling.**
`ArrangementEngine.ts:319-322`: the step event is conditional on the step
key actually differing across the swap, but
`emitSectionForPosition(..., "project-change", true)` always force-emits
regardless of whether `sectionId === this.lastSectionId`. Plausibly
intentional (the section *object* may carry new content even under the same
id after a full arrangement replacement), but worth confirming the intent
was deliberate rather than an oversight, since it reads inconsistently with
the step-event comparison one line above it.

## What's solid

- Transport ownership/borrowing, async controls, `"playback"` event naming,
  listener isolation, and disposed-Engine guards all correctly mirror the
  already-reviewed `SequencerEngine` pattern.
- `setLoop()`'s guard against an implicit ended→playing resume (skipping the
  snapshot reapply specifically for the `ended && loop=true` case) is a
  deliberately correct piece of design, not an oversight — without it,
  toggling loop on while locally ended would silently resume playback as a
  side effect.
- `setArrangement()`'s anchor mechanism correctly avoids seeking the
  transport, and — unlike the P3 `SequencerEngine` blocker I found and that
  was subsequently fixed — its `handleTransportEvent` already clears
  `projectAnchor` on `event.type === "play" && previousState === "ended"`
  in addition to `seek`/`stop` (`ArrangementEngine.ts:408-414`), so that
  stale-anchor bug does not recur here. Shortening behavior (clamp-to-end
  vs. modulo-and-continue) matches spec and is tested for both loop states.
- Event payload shapes (`StepEvent`, `ArrangementSectionEvent`,
  `ArrangementPlaybackSnapshot`) are otherwise correct, and no stale
  `ArrangementTransportEvent`/`.timestamp` surface remains in `arrangement/*`
  or its exports.

## Final verdict

Approved. All items from the previous review are resolved and independently
re-verified against the actual code (not just the change summary): B1's fix
was traced by hand through both its `"seek-as-play"` and `"suppress-seek"`
branches and confirmed with fresh scratch reproductions targeting the exact
original failure mode plus the adjacent bounded-transport path; F1's two
tests now assert what their matrix rows claim; F2's `ChannelSource` fix is
generic and now has a compile-time regression guard; F3 is an intentional,
reasonable design choice that doesn't need to change. `pnpm --filter
@vixeq/core typecheck`/`test` (185 passing)/`build` all pass, matching
Codex's report. **P4 may be marked `done`** in the task table. The one
residual item (B1's regression test carrying the `PB-TR-006` transport-level
ID instead of a dedicated Engine-level row) is a cosmetic traceability nit,
not a blocker — worth a follow-up matrix edit whenever convenient, not before
sign-off.
