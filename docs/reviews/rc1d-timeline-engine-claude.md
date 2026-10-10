# RC1D TimelineEngine critical coverage

- Status: approved (self-reviewed)
- Author: Claude
- Reviewer: Claude
- Scope: Close the 100% branch-coverage gap in `TimelineEngine`, the last
  critical Core file before RC1E wires `pnpm test:coverage` into CI.

## Changed files

- `packages/core/src/timeline/TimelineEngine.ts`
- `packages/core/src/timeline/TimelineEngine.test.ts`
- `CHANGELOG.md`
- `docs/plans/v1-collaboration-spec.md`
- `docs/reviews/rc1d-timeline-engine-claude.md`

## Defects found and fixed

1. **Hot-swap after transport disposal offset the position** (same defect as
   RC1C fix 2). After transport disposal, `getTransportPositionMs()` and
   `readTransportSnapshot()` returned the project-relative
   `cachedPositionMs`, so `setProject()` moved beat 1 to beat 1.5 in the
   regression test (verified failing with the old lines restored). The
   Engine now keeps the transport-relative position from the `dispose`
   event.
2. **Catch-up cue replay continued on replaced data.** `emitDueCues()`
   dispatches every missed cue of a tick, possibly across loop iterations.
   A `"cue"` listener that called `setProject()`, `setLoop()`, or `dispose()`
   mid-replay let the loop keep dispatching the old project's cues and then
   overwrite the dispatch cursor that `setProject()`/`setLoop()` had just
   set. Continuing with the new project's index would also have emitted
   newly loaded events retroactively, contrary to spec §7 / TL-EN-010.
   Dispatch now stops after the cue whose listener changed any of these, and
   the cursor set by the hot-swap stands.

## Removed branches (unreachable through public APIs)

- `assertValidTimelineProject` error formatting fallbacks.
- `emitDueCuesForIteration()` inverted-range early return: in the
  non-looping path, `lastDispatchedRawPositionMs` stays below the duration
  whenever the Engine is playing (any assignment at or past it transitions
  to `ended`), and in the looping path every iteration's local range is
  ordered by construction. With fix 2, the duration cannot change between
  iterations of one replay.

The constructor now calls `rescheduleIfPlaying()`. The `scheduleNextTick()`
and `tick()` guards stay (mid-tick transport disposal by a cue listener;
third-party transports reporting a non-playing state). The
`emitDueCues()` null-cursor fallback also stays: it is reached when a replay
from local end is rejected after its seek (for example a media element
blocked by autoplay policy) and the transport is later started externally.

## Covered branches (new tests, public API only)

Listener-error reporting (`onListenerError`, a throwing reporter,
`console.error`, no reporting surface), Engine-owned transport disposal,
`stop()` after transport disposal, `setLoop` validation/no-op/enable while
playing, looping hot-swap modulo, no-op and stale command markers, a
synchronously rejected seek, same-dispatch disposal, a transport `play` past
local end, `stop` events, non-advancing ticks, buffering, transport `error`
and generic events, the `tick()` guard, the rejected-replay resume path,
transport disposal while playing, mid-tick transport disposal, mid-replay
`setProject`/`setLoop`/`dispose`, hot-swap and `setLoop` after transport
disposal, unsubscription, and a replay rejected before its seek runs.

## Commands run

- `pnpm test:coverage` → exits 0 for all three packages. Core: all seven
  100%-tier files at 100% branches, global branches 95.66%; React 89.72%;
  player-react 89.85%.
- `pnpm --filter @vixeq/core typecheck`, `pnpm --filter @vixeq/core build`
- `pnpm api:check` (no report changes), `pnpm behavior:check`
  (191 covered, 0 planned, 0 blocked)
- `pnpm test` (core 398, react 36, player-react 8, playground 11,
  cycling-workout 5)

## Verdict

No public API changed. RC1D is `done`; RC1E can wire `pnpm test:coverage`
into CI.
