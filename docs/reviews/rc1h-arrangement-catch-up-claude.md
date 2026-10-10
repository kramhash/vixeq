# RC1H Arrangement catch-up across loop wrap, gaps, and local end — handoff brief and review

- Status: pending (handoff brief; implementation not started)
- Author: — (claim the RC1H task-table row before starting)
- Reviewer: —
- Origin: out-of-scope observation O1 recorded during RC1G
  (`docs/reviews/rc1g-reentrancy-guards-claude.md`), measured on the RC1G
  working tree (`dffec0d` + RC1G), 2026-10-10. The decisions below were made
  by the project owner on 2026-10-10.
- Scope: make `ArrangementEngine`'s delayed-tick dispatch honor
  `missedStepPolicy` across a local loop wrap, section gaps, and local end, with
  section and step events in time order. Blocks `1.0.0-rc.1` (RC2 depends on
  RC1H).
- Depends on RC1G: both items edit `ArrangementEngine.ts`, and RC1H's dispatch
  loop must keep RC1G's `dispatchGeneration` checks. Start only after RC1G is
  `done` (reviewed and committed).

## Ground rules for the implementer

- Read `AGENTS.md` and `docs/plans/v1-collaboration-spec.md` first. Claim the
  RC1H row (`in_progress`, owner) before editing code.
- The decisions D1–D3 below are made. D4–D10 are derived from them and from
  the current code; if implementation shows one of them is wrong or forces a
  behavior the docs and this brief do not state, stop and ask (spec rule 10).
- No public type change: `pnpm api:check` must report no diff. (A negative
  `scheduledPositionMs` is a value change, not a type change; it is documented
  and listed in `CHANGELOG.md`.)
- Tests go through public APIs only (spec §10). Reuse the `FakeClock` /
  `ManualTransport` helpers in `ArrangementEngine.test.ts`.
- `ArrangementEngine.ts` stays at 100% branch coverage; no new exclusions or
  threshold changes. Remove any branch that the rewrite makes unreachable
  (check under listener re-entrancy first — RC1B lesson).
- Every existing Arrangement test must keep passing unchanged unless this
  brief names it. If another existing test needs a different expectation,
  stop and record why.

## Measured behavior (RC1G working tree)

bpm 60 (1 beat = 1000 ms), one pattern with 4 steps at 1 step/beat,
`missedStepPolicy: "emit"`, clock transport, one delayed tick per jump.

| Case | Arrangement today | Sequencer / Timeline today |
| --- | --- | --- |
| Loop wrap landing on the last emitted step key (1.2 → 5.2 beats) | **nothing at all** (also under `"skip"`) | every crossed step / cue in order |
| Loop wrap landing on another step (1.2 → 6.5) | only step 2 of the new iteration; steps 2–3 of iteration 0 and 0–1 of iteration 1 lost | same as above; Timeline adds `iteration` |
| Non-loop, delayed tick crosses local end (1.2 → 4.2) | steps 2–3 lost, then `ended` | Timeline dispatches the remaining cues, then `ended` |
| Trailing gap (`durationBeats` 6, section `[0,4)`; 1.2 → 4.2 → 6.2) | steps 2–3 lost | — |
| Tick lands in an inter-section gap, then in the next section (0.5 → 3 → 5) | step 1 of section `a` is delivered 4000 ms late **after** `section` `b` | — |
| Delayed tick inside one section (control) | correct | — |

Causes: `getDueStepResolutions()` works on loop-normalized positions, so a wrap
makes `to < from` and yields nothing; `emitDueSteps()` returns early when the
landing position resolves no step (gap or end), and the local-end call
`emitDueSteps(duration)` always resolves `null`; the step-key dedupe
(`section:absoluteSectionStep`) has no iteration, so landing on the same key
after a wrap is treated as "already emitted"; `tick()` emits the landing
section before the catch-up steps.

Realistic trigger: background tabs throttle timers to ≥1 s, so a 2-beat loop
at 120 bpm can lose a whole iteration silently when the tab returns.

## Documented rules this deviates from

- Spec §3.4 / §3.6: natural delays apply `missedStepPolicy`.
- `PB-EN-008`: "delayed callback with emit — every crossed step emitted in
  order with lateByMs" (tested on Sequencer only today).
- `timeline-arrangement-v2.md`: `missedCuePolicy` mirrors Arrangement's
  `missedStepPolicy`.
- `playback-v2.md` §5: "Section events follow the same seek, delayed-callback,
  and Project-change position rules as Step events." Today Arrangement
  section events always carry `lateByMs: 0` and only the landing section.

## Decisions (owner, 2026-10-10)

- **D1 — fix before RC2.** Full fix (option A of the O1 analysis), as RC1H.
- **D2 — previous-iteration timing is relative to the landing iteration.**
  A step's `scheduledPositionMs` is its position measured from the start of
  the loop iteration the tick landed in. Steps of the landing iteration keep
  today's values (`0 <= x < duration`); steps of earlier iterations are
  negative (e.g. step 3 of the previous iteration of a 4000 ms loop is
  `-1000`). `lateByMs = transportPositionMs - scheduledPositionMs` is then
  correct, and Envelopes (`trigger(scheduled)`, `sample(getPosition())`) see
  the right elapsed time. Rejected: keeping the in-iteration value (wrong
  `lateByMs`, Envelope sees a future trigger) and a monotonic raw value like
  Timeline's (breaks Envelopes from iteration 1 on, because Arrangement
  samples at the normalized position).
- **D3 — time order.** Within one dispatch batch, section transitions and
  steps are emitted in timeline order: the remaining steps of section `a`,
  then `section` `b` (or `null` on entering a gap), then the steps of `b`.

## Derived rules (raise if wrong)

- **D4** — `transportPositionMs` stays the landing position as today
  (loop-normalized, or clamped to duration at local end), for steps and
  sections.
- **D5** — section events use the D2 frame for `positionMs` (the boundary
  time; negative for a boundary in an earlier iteration) and set
  `lateByMs = transportPositionMs - positionMs`. `beat` is the boundary's beat
  within its own iteration (`section.startBeat`, or the previous section's
  `endBeat` for a gap), so it is never negative.
- **D6** — `"skip"`: only the most advanced due step is emitted, as today, and
  only the landing section if it changed. Step identity includes the
  iteration, so a wrap that lands on the same `section:step` key does emit it.
- **D7** — no cap on catch-up length, matching Sequencer and Timeline.
- **D8** — pause keeps the cursor (today's Arrangement behavior): a step whose
  start fell between the last tick and the pause is delivered on resume as a
  late `tick` step. This is not a re-emission, so it does not conflict with
  "paused → play: do not re-emit the current step".
- **D9** — non-loop local end: due steps with `scheduledPositionMs <
  duration` (half-open) and any crossed section transitions are emitted
  before the terminal `section` (`null`) and `ended`. RC1G's rule stays:
  announce `ended` only while still `ended`. This also applies to the RC1G
  round 2 `pause` branch: a pause that lands at or past local end while
  playing must dispatch the remaining due steps before its `ended` (see
  RC1G review C1; the same loss is reproducible on Arrangement today).
- **D10** — a transport-level wrap (position moves backwards without a
  `seek`, e.g. a looping shared transport) keeps today's behavior: emit the
  step at the landing position with `cause: "tick"` and re-anchor the cursor.
  Add a test if none covers it for Arrangement (`PB-EN-029` is Sequencer only).

## Recommended design

1. Replace `lastEmittedScheduledPositionMs` with a cursor in the
   anchor-adjusted, **un-normalized** position domain (what
   `positionFromTransportPosition()` returns; call it raw). The cursor is
   exclusive and advances **per emitted item**, not at batch end, so a batch
   abandoned by RC1G's generation check resumes on the next tick without
   duplicates.
2. Per tick, with `from = cursor` and `to = raw landing position` (clamped to
   duration when not looping): enumerate loop iterations
   `floor(from / duration) .. floor(to / duration)` the way Timeline's
   `emitDueCues` does, and within each iteration collect step starts and
   section boundaries in `(from, to]`. Merge them into one list sorted by raw
   time, sections before steps at the same time.
3. Convert each item's raw time to the D2 frame by subtracting
   `floor(to / duration) * duration` (0 when not looping).
4. Emit in order, checking `dispatchGeneration` after every listener call.
5. Keep `lastEmittedStepKey` only where it is still needed
   (`setArrangement()`'s project-change comparison, constructor), and include
   the iteration wherever it dedupes tick dispatch.
6. Re-anchor the cursor where today's code resets
   `lastEmittedScheduledPositionMs`: play from stopped/ended, seek (to the
   destination raw position), stop, hot-swap (to the new anchored position;
   newly loaded steps at or before it are not emitted retroactively), and
   transport wrap (D10). `setLoop` does not change the raw domain, so it keeps
   the cursor.

Watch for: the existing gap handling where `resolveAtPosition()` is `null`
must stop being an early return; `section` events from `tick()` must move
into the merged list; the RC1G checks in `tick()` (after the section emission
and before `ended`) must still hold.

## Tests to add (`ArrangementEngine — RC1H catch-up`)

Each must fail on the RC1G tree and pass with the fix.

1. Loop wrap landing on the same step key: every crossed step in order, with
   D2 `scheduledPositionMs` (negative for the previous iteration) and correct
   `lateByMs`.
2. Loop wrap landing on another step, across two or more iterations.
3. Non-loop local end crossed by a delayed tick: remaining steps, then
   terminal `section` `null`, then `ended`.
4. Trailing gap, then end.
5. Inter-section gap: time-ordered `step a` → `section null` → `section b` →
   `step b`, with section `lateByMs` per D5.
6. `"skip"` across a wrap that lands on the same key: exactly one step.
7. Envelope integration: trigger an Envelope with a previous-iteration step's
   `scheduledPositionMs` and sample at `getPosition().positionMs`; the elapsed
   time equals the real lateness.
8. RC1G regression under the new loop: a step listener seeks, hot-swaps, or
   disables loop in the middle of a cross-iteration batch; nothing stale is
   emitted and nothing is emitted twice on the next tick.
9. D8 pause/resume across a step start, and D10 transport-level wrap.

Add matrix rows for Arrangement delayed dispatch (or extend `PB-EN-008` /
`PB-EN-009` to cite Arrangement tests) so `pnpm behavior:check` covers them.

## Docs to update

- `docs/behavior/playback-v2.md`: Arrangement delayed dispatch (D2, D3, D5,
  D9); note that `StepEvent.scheduledPositionMs` can be negative for an
  Arrangement step from an earlier loop iteration. Also fix the §5
  `ArrangementSectionEvent` type, which lists `scheduledPositionMs` while the
  code has `beat` / `positionMs` (doc-only correction).
- `docs/behavior/timeline-arrangement-v2.md`: the Arrangement catch-up rules.
- `CHANGELOG.md` Unreleased "Fixed": the lost-step cases above, and the
  negative `scheduledPositionMs` as a visible value change.
- Check, do not necessarily change: `packages/react/src/useAnimatedChannels.ts`
  (Envelope trigger, works with negative values) and
  `examples/website-svg/src/useSmoothedChannels.ts`
  (`(position - scheduled) / durationMs`, works with negative values).

## Definition of done

1. All tests in "Tests to add" fail on the RC1G tree and pass with the fix
   (verify by reverting the production change once).
2. `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:coverage` (100%
   branches on the critical files), `pnpm api:check` (no diff), and
   `pnpm behavior:check` pass.
3. Docs and `CHANGELOG.md` describe the new guarantees.
4. Fill in "Changed files / Commands run / Results", set `Status:
   review_requested`, and hand off for an adversarial `critic` review (the
   dispatch loop is the area that produced RC1B and RC1G).
5. Mark RC1H `done` in the task table only after review approval.

## Changed files

_To be filled in by the implementer._

## Commands run

_To be filled in by the implementer._

## Results

_To be filled in by the implementer._
