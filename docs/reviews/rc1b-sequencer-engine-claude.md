# RC1B SequencerEngine critical coverage

- Status: approved (self-reviewed)
- Author: Claude
- Reviewer: Claude
- Scope: Close the 100% branch-coverage gap in `SequencerEngine` before RC1E
  wires `pnpm test:coverage` into CI.

## Changed files

- `packages/core/src/SequencerEngine.ts`
- `packages/core/src/SequencerEngine.test.ts`
- `docs/plans/v1-collaboration-spec.md`
- `docs/reviews/rc1b-sequencer-engine-claude.md`

## Removed branches (unreachable through public APIs)

Recorded per the RC1A review note so that each deletion keeps its call-site
argument next to it.

- `assertValidProject` error formatting: `validateProject` returns
  `ok: false` only when `errors.length > 0`, so the `?.`/`?? "$"`/`?? ""`
  fallbacks and the trailing `.trim()` could never apply.
- `scheduleNextTick()` state guard: every caller already requires
  `playing && !buffering && !transportDisposed` — `rescheduleIfPlaying()`
  checks it explicitly and `tick()` returns early otherwise. The constructor
  now calls `rescheduleIfPlaying()` instead of duplicating the condition.
- `scheduleNextTick()` `transportDisposed ? 1 : rate`: unreachable for the
  same reason.
- `track.steps[index] ?? 0` in step events and channel sampling: the
  constructor and `setProject()` both reject projects whose
  `track.steps.length !== stepCount`, and both indexes are normalized into
  `[0, stepCount)`. In-place mutation of a loaded project is not a supported
  input (Projects are replaced atomically through `setProject()`).

## Covered branches (new tests, public API only)

- `pause()` / `stop()` / `seekPositionMs()` rejecting after transport disposal.
- Disposing an Engine-owned browser-clock transport.
- `setProject()` with the already-loaded project (no event).
- `setProject()` after transport disposal (cached transport position).
- A no-op command that runs after its marker index shifted does not leave a
  stale marker, so later external events keep `cause: "transport"`.
- A transport event delivered in the same dispatch that disposed the Engine.
- Media-transport buffering: position and ticks freeze, then catch up.
- Transport `error` and generic (`durationchange`) events.
- `tick()` returning early after a third-party transport reports a
  non-playing state through an `error` event (`ManualTransport` test helper;
  `PlaybackTransport` is public, so this guard stays).
- Disabled tracks in step events and channel samples.
- Listener-error reporting through `console.error` and with no reporting
  surface at all; listener unsubscription.

## Commands run

- `pnpm --filter @vixeq/core exec vitest run --coverage` →
  `src/SequencerEngine.ts` 100% statements/branches/functions/lines; the run
  still exits 1 only on `ArrangementEngine.ts` (86.43%) and
  `TimelineEngine.ts` (87.44%), owned by RC1C/RC1D.
- `pnpm --filter @vixeq/core typecheck`, `pnpm --filter @vixeq/core build`
- `pnpm api:check` (no report changes), `pnpm behavior:check`
  (191 covered, 0 planned, 0 blocked)
- `pnpm test` (core 351, react 36, player-react 8, playground 11,
  cycling-workout 5)

## Verdict

No public API or documented behavior changed. RC1B is `done`.
