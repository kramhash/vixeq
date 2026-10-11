# RC1I Timeline `missedCuePolicy: "skip"` across a loop wrap — handoff brief and review

- Status: pending (handoff brief; implementation not started)
- Author: — (claim the RC1I task-table row before starting)
- Reviewer: —
- Origin: found while designing RC1H
  (`docs/reviews/rc1h-arrangement-catch-up-claude.md`), 2026-10-11. The
  project owner decided to fix it before RC2 as its own item.
- Scope: make `TimelineEngine` `"skip"` dispatch only the most advanced due
  cue of a whole delayed tick, as documented, instead of one cue per crossed
  loop iteration. Blocks `1.0.0-rc.1` (RC2 depends on RC1I).
- Depends on RC1H (done, reviewed, and committed). RC1H does not edit
  `TimelineEngine.ts`; the dependency only keeps the RC dispatch work in order.

## Measured behavior (RC1H working tree, 2026-10-11)

bpm 60 (1 beat = 1000 ms), `durationBeats` 4, events `e1` at beat 1 and `e3`
at beat 3, local loop on, clock transport. Ticks at 1500 ms and then 9500 ms
(two loop wraps in one delayed tick).

| Policy | Cues dispatched (`id#iteration@scheduledPositionMs+lateByMs`) |
| --- | --- |
| `"emit"` | `e1#0@1000+500`, `e3#0@3000+6500`, `e1#1@5000+4500`, `e3#1@7000+2500`, `e1#2@9000+500` (correct) |
| `"skip"` | `e1#0@1000+500`, `e3#0@3000+6500`, `e3#1@7000+2500`, `e1#2@9000+500` |

Under `"skip"` the second tick dispatches three cues, one per iteration it
crosses. Cause: `emitDueCuesForIteration()` applies `"skip"` inside the
per-iteration loop of `emitDueCues()` (`toDispatch = [dueEvents[dueEvents.length - 1]]`
per iteration).

## Documented rule this deviates from

- `docs/behavior/timeline-arrangement-v2.md` §3: `"skip"`: "only the most
  advanced due event dispatches; earlier missed cues in the same tick are
  discarded unconditionally".
- `TL-EN-005`: "only the most-advanced due event dispatches". Its tests do not
  cross a wrap.
- RC1H made Arrangement `"skip"` resolve the landing position only across a
  wrap; Timeline is now the only Engine that emits more than one item.

## Fix direction

- Collect the due cues of every crossed iteration first, then apply `"skip"`
  to the whole batch: dispatch only the last one (highest iteration, then
  highest beat), with its own `iteration`, `scheduledPositionMs`, and
  `lateByMs`. `"emit"` is unchanged.
- Keep RC1G's re-entrancy guarantees: the `dispatchGeneration` checks after
  each listener, `runDispatch()` / `finishLocalEndPause()`, and the cursor
  that advances only when the batch completes.
- If the batch has no due cue, dispatch nothing (as today).

## Tests to add

1. `"skip"` with a delayed tick across two wraps dispatches exactly
   `e1#2@9000+500` in the measurement above (fails today).
2. `"skip"` across one wrap that lands before the first event of the new
   iteration dispatches the last cue of the previous iteration only.
3. `"emit"` across the same wraps is unchanged (regression).
4. `TL-EN-005`: extend the matrix row or add a row so that `pnpm
   behavior:check` covers the wrap case.

## Docs to update

- `docs/behavior/timeline-arrangement-v2.md`: state that `"skip"` applies to
  the whole tick, across loop iterations.
- `CHANGELOG.md` Unreleased "Fixed".

## Definition of done

1. The tests fail on the RC1H tree and pass with the fix.
2. `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:coverage`
   (`TimelineEngine.ts` stays at 100% branches), `pnpm api:check` (no diff),
   and `pnpm behavior:check` pass.
3. Fill in "Changed files / Commands run / Results", set `Status:
   review_requested`, and get a `critic` review. Decide the stop criteria
   before the second round (rounds, and which findings close as known
   limitations).
4. Mark RC1I `done` in the task table only after review approval.

## Changed files

_To be filled in by the implementer._

## Commands run

_To be filled in by the implementer._

## Results

_To be filled in by the implementer._
