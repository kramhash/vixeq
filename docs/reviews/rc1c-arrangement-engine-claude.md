# RC1C ArrangementEngine critical coverage

- Status: approved (self-reviewed)
- Author: Claude
- Reviewer: Claude
- Scope: Close the 100% branch-coverage gap in `ArrangementEngine` before
  RC1E wires `pnpm test:coverage` into CI.

## Changed files

- `packages/core/src/arrangement/ArrangementEngine.ts`
- `packages/core/src/arrangement/ArrangementEngine.test.ts`
- `CHANGELOG.md`
- `docs/plans/v1-collaboration-spec.md`
- `docs/reviews/rc1c-arrangement-engine-claude.md`

## Defects found and fixed

Both are pre-existing and were found while checking whether uncovered
branches were reachable, applying the RC1B lesson that listener re-entrancy
counts as a public path.

1. **Catch-up replay after a listener hot-swap threw.** `emitDueSteps()`
   computes every missed step against the current arrangement, then emits
   them one by one. A `"step"` listener calling `setArrangement()` mid-loop
   made the remaining iterations look up `patterns[section.patternId]` in the
   new arrangement; if that pattern was gone, `pattern.stepsPerBeat` threw a
   `TypeError` out of the timer callback. The loop now stops once the
   arrangement is replaced or the Engine is disposed; `setArrangement()` has
   already emitted the `project-change` step for the new position.
2. **Hot-swap after transport disposal offset the position.** After the
   transport was disposed, `getTransportPositionMs()` and
   `readTransportSnapshot()` returned `cachedPositionMs`, which is
   project-relative once a hot-swap anchor exists. `setArrangement()` then
   anchored on that value and re-applied the snapshot, moving beat 1 to beat
   1.5 in the regression test. The Engine now records the transport-relative
   position from the `dispose` event and uses it for both.

## Removed branches (unreachable through public APIs)

- `assertValidArrangement` error formatting fallbacks: `validateArrangement`
  returns `ok: false` only with at least one issue.
- `track.steps[index] ?? 0` in step events: patterns are validated
  (`steps.length === stepCount`), both indexes are normalized into
  `[0, stepCount)` of the section's pattern, and after fix 1 every emitted
  resolution belongs to the current arrangement.

The constructor now calls `rescheduleIfPlaying()` instead of duplicating its
condition. The `scheduleNextTick()` and `tick()` guards stay: a step listener
can dispose a shared transport mid-tick, and a third-party `PlaybackTransport`
can report a non-playing state through any event; both paths have tests.

## Covered branches (new tests, public API only)

Listener-error fallbacks (`onListenerError` throwing, `console.error`, no
reporting surface), Engine-owned transport disposal, construction in a
section gap on an already-playing transport, command rejection after
transport disposal, `setLoop` validation and enabling loop at local end,
no-op `setArrangement`, no-op and stale command markers, a synchronously
rejected seek, same-dispatch disposal, a transport `play` past the local end,
buffering, transport `error` and generic events, the `tick()` guard,
transport disposal while playing, mid-tick transport disposal, mid-replay
hot-swap, the `skip` policy and same-step ticks, local-loop wrap catch-up,
hot-swap and `setLoop` after transport disposal, unsubscription, and a failed
replay from local end.

## Commands run

- `pnpm --filter @vixeq/core exec vitest run --coverage` →
  `src/arrangement/ArrangementEngine.ts` 100% statements/branches/functions/
  lines; the run still exits 1 only on `TimelineEngine.ts` (87.44%), owned
  by RC1D.
- `pnpm --filter @vixeq/core typecheck`, `pnpm --filter @vixeq/core build`
- `pnpm api:check` (no report changes), `pnpm behavior:check`
  (191 covered, 0 planned, 0 blocked)
- `pnpm test` (core 375, react 36, player-react 8, playground 11,
  cycling-workout 5)

## Verdict

No public API changed. The two fixes change behavior only on paths that
previously threw or reported a wrong position. RC1C is `done`.
