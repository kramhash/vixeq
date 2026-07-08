# P1 PlaybackTransport — Claude Review

- Reviewer: Claude
- Author: Codex
- Status: approved
- Task: P1
- Contract: [`../behavior/playback-v2.md`](../behavior/playback-v2.md)
- Matrix: [`../behavior/playback-v2-matrix.md`](../behavior/playback-v2-matrix.md)

Review findings belong in this file. Do not edit implementation, normative
specification, migration, or matrix files directly.

## Implementation scope

- Added `PlaybackClock`, `PlaybackTransport`, snapshots, event union, options,
  and `PlaybackError`.
- Added `createClockTransport()` with serialized operations, logical position,
  playback rate, finite duration, full-duration loop, listener isolation, and
  terminal disposal.
- Renamed public `SequencerClock` usages to `PlaybackClock`.
- Added focused contract tests and marked only implemented P1 matrix rows
  `covered`.
- Media and AudioBuffer transport migration remains P2.
- Engine ownership/integration remains P3/P4. The old `SequencerTransport`
  type remains temporarily for the green staged migration and must be removed
  before 0.7 completion.

## Files to inspect

- `packages/core/src/playbackTransport.ts`
- `packages/core/src/playbackTransport.test.ts`
- `packages/core/src/types.ts`
- `packages/core/src/clock.ts`
- `packages/core/src/index.ts`
- Mechanical `PlaybackClock` rename consumers under `packages/` and
  `examples/arrangement-demo/src/App.tsx`
- `docs/behavior/playback-v2-matrix.md`

## Review checklist

- [x] Public P1 types/signatures match the approved contract. One additive,
      undocumented export noted under Ambiguities (non-blocking).
- [x] Synchronous validation occurs before queueing and uses the specified
      error types/codes.
- [x] State-changing events occur before operation Promise resolution.
- [x] No-op operations suppress events except explicit seek.
- [x] Concurrent and reentrant operations execute in invocation order.
- [x] A rejected operation does not poison the queue.
- [x] Rate changes preserve position and reschedule finite boundaries.
- [x] Delayed loop boundaries emit every crossed iteration in order.
- [x] Subscriber exceptions do not block peers or operation completion.
- [x] Disposal is observable, idempotent, terminal, and clears timers.
- [x] P1 does not silently implement P2 media behavior or P3 Engine behavior.
- [x] Matrix `covered` rows have corresponding focused tests. One row is
      mislabeled the other direction (covered by a test but still marked
      `planned`) — see Matrix bookkeeping.

## Verification already run

Re-ran independently and confirmed exact:

- `pnpm --filter @vixeq/core test` — 14 test files, **192 passed**, including
  `playbackTransport.test.ts` (24 tests).
- `pnpm --filter @vixeq/core typecheck` — passed, no errors.
- `pnpm --filter @vixeq/core build` (`tsup`, ESM+CJS+DTS) — passed; `dist/index.js`,
  `dist/index.cjs`, `dist/index.d.ts`, `dist/index.d.cts` all emitted cleanly.
- Full workspace `pnpm test` — confirmed 217 total (192 core + 6 react + 3
  player-react + 5 cycling-workout + 11 playground), matching the claimed count.

## Blockers

None. Implementation matches the frozen contract for every P1-scoped
behavior, and the automated checks in "Verification already run" reproduce
cleanly.

## Ambiguities

**A1 — `PlaybackTransportListener` is a new public export not in the frozen
contract.** `packages/core/src/playbackTransport.ts` defines
`export type PlaybackTransportListener = (event: PlaybackTransportEvent) =>
void;` and `packages/core/src/index.ts` re-exports it. `playback-v2.md` §2
only shows this as an inline parameter type on `subscribe(listener: (event:
PlaybackTransportEvent) => void)` — it never names or freezes a
`PlaybackTransportListener` type. This is additive and non-breaking (a
convenience alias, not a behavior change), but it is a public API surface
`playback-v2.md` doesn't document, which is otherwise described as frozen
for 0.7. Low severity — recommend folding it into the contract doc's code
sample in a later doc pass rather than blocking P1.

**A2 — Construction-time `{ loop: true }` without `durationMs` throw is
undocumented.** `createClockTransport(clock, { loop: true })` (no
`durationMs`) throws `PlaybackError("DURATION_UNAVAILABLE")` synchronously
from the factory itself, before any transport is returned. This is a
reasonable design — `createClockTransport`'s `durationMs` is fixed at
construction with no later setter, so this combination can never become
valid — but `playback-v2.md` §2.1/§2.2 only documents the *asynchronous*
`setLoop(true)`-rejects-with-`DURATION_UNAVAILABLE` path (an already-built
transport calling `setLoop` later), not this synchronous construction-time
throw. No matrix ID names the construction-time scenario distinctly either;
the covering test (`"validates clock transport construction"` in
`playbackTransport.test.ts`) is untagged. Recommend a one-line addition to
§2.1 describing the construction-time case, plus a dedicated matrix ID (e.g.
`PB-TR-014A`) or an explicit note that it shares `PB-TR-014`.

## Matrix bookkeeping

- **`PB-TR-025` is marked `planned` but is already covered.**
  `playback-v2-matrix.md` line 53 lists `PB-TR-025 | two Engines share
  transport | both receive one ordered event stream | planned`, but
  `packages/core/src/playbackTransport.test.ts` already has a passing test
  named `"PB-TR-025 supports multiple independent subscribers"` that
  exercises exactly this scenario (two independent subscribers on one
  shared transport each receive the full ordered event stream, and
  unsubscribing one doesn't affect the other). Per the matrix file's own
  header instructions ("Tests added during P1–P7 must include the ID in the
  test name or an adjacent comment, then change the row status to
  `covered`"), this row's status should be flipped to `covered`. Doc-only
  fix; not a behavior gap.
- **Minor traceability nit:** the test covering `PB-TR-013A` (non-boolean
  `setLoop` input → synchronous `TypeError`) is titled `"validates loop
  input synchronously"` without the `PB-TR-013A` ID in its name or an
  adjacent comment, even though the matrix already (correctly) marks that
  row `covered`. Cosmetic only — the behavior is genuinely tested — but
  worth tagging for future ID-based searches.

## Missing tests

None beyond the two items already covered by test in Matrix bookkeeping and
Ambiguity A2 (both need a matrix/doc update, not a new test).

## Final verdict

Approved. All P1-scoped behavior in `packages/core/src/playbackTransport.ts`
matches the frozen `playback-v2.md` contract, including the newer seek
state-transition rows in §3.2 (`stopped`→seek-above-0→`paused`,
`ended`→seek-below-end→`paused`, etc.), and the claimed test/typecheck/build
results were independently reproduced exactly. No blockers. Two
non-blocking, doc-only follow-ups are recorded (Ambiguities A1/A2) plus one
matrix status correction (`PB-TR-025` → `covered`) and one traceability nit;
none require touching `packages/core/src/playbackTransport.ts` itself. P1
may be marked `done` in the task table.

## Codex closure

- Removed the unfrozen public `PlaybackTransportListener` convenience alias
  instead of expanding the approved API.
- Documented and tagged `PB-TR-014A` for construction-time loop without
  duration.
- Tagged the `PB-TR-013A` runtime boolean-validation test.
- Corrected `PB-TR-025` to describe the multiple-subscriber behavior actually
  covered by P1, and added planned Engine integration case `PB-EN-026` for P3.
- Re-ran the 24 focused tests, Core typecheck, and `git diff --check`.

Resolution status: complete. P1 is `done`.
