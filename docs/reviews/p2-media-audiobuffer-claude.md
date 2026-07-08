# P2 Media and AudioBuffer Transports — Claude Review

- Reviewer: Claude
- Author: Codex
- Status: approved
- Task: P2
- Contract: [`../behavior/playback-v2.md`](../behavior/playback-v2.md)
- Matrix: [`../behavior/playback-v2-matrix.md`](../behavior/playback-v2-matrix.md)

Review findings belong in this file. Do not edit implementation, normative
specification, migration, or matrix files directly.

## Implementation scope

- Rebuilt `createMediaElementTransport()` as a `PlaybackTransport`.
- Rebuilt `createAudioBufferTransport()` as a `PlaybackTransport` backed by
  P1 `createClockTransport()` for state, queue, rate, loop, and boundary
  behavior.
- Removed `createAudioClock()`, `createAudioContextClock()`, their public
  types, and `stopAtMs` transport options.
- Added media observation for play, pause, seek, rate, duration, buffering,
  natural end, errors, and full-duration loops.
- Added the approved one-command/one-public-event rule. Command-caused DOM
  side events are suppressed while external media manipulation remains
  observable.
- Preserved borrowed ownership: disposal removes listeners/nodes without
  pausing the media element or closing the AudioContext.
- Added 20 focused P2 tests and marked P2 matrix rows covered.

## Files to inspect

- `packages/core/src/audioClock.ts`
- `packages/core/src/audioClock.test.ts`
- `packages/core/src/types.ts`
- `packages/core/src/index.ts`
- `packages/core/README.md`
- `docs/api/core.md`
- `docs/behavior/playback-v2.md`
- `docs/behavior/playback-v2-matrix.md`
- `docs/migrations/0.7-playback-v2.md`

## Review checklist

- [x] Both factories return the exact `PlaybackTransport` contract.
- [x] Invalid arguments throw synchronously before queueing.
- [x] Platform command failures reject without a duplicate `error` event.
- [x] Each successful command emits at most its matching event before Promise
      resolution; command-caused DOM side events do not leak.
- [x] External media changes emit the corresponding public event once.
- [x] Media duration, buffering, ended, error, and loop behavior match the
      normative contract.
- [x] AudioBuffer pause/seek/rate/loop operations keep the source graph and
      logical transport position aligned.
- [ ] AudioBuffer loop and natural-end scheduling remain correct when
      playback rate changes. No test combines rate change with loop or
      natural end for `createAudioBufferTransport` itself — see Missing tests.
- [x] Operation queues recover after rejection and remain invocation-ordered.
- [x] Listener failures remain isolated for both factories.
- [x] Disposal is idempotent and terminal, emits before cleanup, and does not
      destroy borrowed media or AudioContext resources.
- [x] Removed public APIs are absent from generated declarations. Verified by
      rebuilding and grepping `dist/index.d.ts` for `createAudioClock`,
      `createAudioContextClock`, `AudioContextClock`, `stopAtMs` — no matches.
- [x] Matrix `covered` rows have a corresponding tagged test.

## Verification already run

Re-ran independently:

- `pnpm --filter @vixeq/core test` — confirmed 14 files, **191 passed**,
  `audioClock.test.ts` has 20 tests. Matches the claim exactly.
- `pnpm --filter @vixeq/core typecheck` — passed, no errors.
- Rebuilt with `tsup src/index.ts src/dom.ts --format esm,cjs --dts
  --sourcemap` — ESM/CJS/DTS all emitted; grepped `dist/index.d.ts` for the
  removed symbols (none found).
- **New check the review's own list didn't include:** ran `pnpm --filter
  vixeq-example-arrangement-demo typecheck` (`tsc --noEmit`) — **fails**:
  `src/App.tsx(3,3): error TS2305: Module '"@vixeq/core"' has no exported
  member 'createAudioClock'.` See Blocker B2.

## Staged-migration note

Accepted as scoping justification for why Engines/React/player-react are
still on the old `clock`-based integration — that is a legitimate, intended
staging boundary, not a defect. It does not, however, excuse either blocker
below: B1 is a documentation defect (an example that already claims to use
the *new* API, ahead of what's implemented), and B2 is a regression in an
*existing* consumer that the "not yet migrated" framing doesn't cover — the
example wasn't left alone on the old pattern, its dependency was pulled out
from under it.

## Re-review (blocker fixes)

Re-verified both fixes independently rather than trusting the claimed
commands:

- `packages/core/README.md` — both Audio Sync examples now use
  `new SequencerEngine(project, { clock, timeDriven: true })` +
  `engine.start()`, with `clock` built by adapting
  `transport.getPositionMs()` into a `PlaybackClock`. `SequencerEngineOptions`
  has `clock?: PlaybackClock` and `timeDriven?: boolean` today, and
  `SequencerEngine.start()` exists today — this now compiles and matches the
  actual P1/P2-era Engine surface. Grepped the file for `createAudioClock`,
  `createAudioContextClock`, `SequencerTransport`, `stopAtMs`,
  `engine.play()`, and `{ transport }`/`{transport}` — no matches remain.
- `examples/arrangement-demo/src/App.tsx` — no longer imports
  `createAudioClock`; it now builds a `PlaybackTransport` via
  `createMediaElementTransport()` and adapts it into a `PlaybackClock`
  (`now: () => mediaTransport.getPositionMs()`) for `useArrangement({
  clock })`, mirroring the same adapter pattern the README fix uses.
- Ran independently, not just re-read the claim:
  - `pnpm --filter @vixeq/core typecheck` — passed.
  - `pnpm --filter @vixeq/core test` — 14 files, **191 passed**.
  - `pnpm --filter vixeq-example-arrangement-demo typecheck` — passed.
  - `pnpm --filter vixeq-example-arrangement-demo build` (`tsc --noEmit &&
    vite build`) — passed, produced `dist/` output.
  - `git diff --check` — clean.

Both B1 and B2 are resolved and confirmed compiling/running against the
current codebase, not just documented as fixed.

## Blockers (original — both resolved, see Re-review above)

**B1 — `packages/core/README.md`'s Audio Sync examples use an API that does
not exist yet.** Lines 48–59 and 65–75 now read:

```ts
const transport = createMediaElementTransport(audio);
const engine = new SequencerEngine(project, { transport });

await engine.play();
```

but `packages/core/src/types.ts`'s `SequencerEngineOptions` has no
`transport` field (only `clock?: PlaybackClock`, unchanged from 0.6), and
`packages/core/src/SequencerEngine.ts` has no `play()` method — only
`start()`, `stop()`, `reset()`. This is exactly the P3-future integration
this review's own "Staged-migration note" says P2 does not deliver. A reader
following today's README gets a TypeScript error (`transport` does not exist
on `SequencerEngineOptions`) and, un-typed, a runtime `TypeError: engine.play
is not a function`. The README must keep showing the *current* (P1/P2-era)
integration — `{ clock: transport.clock }` plus `engine.start()`, or
explicitly mark the new snippet as a forward-looking preview of the P3
contract — until `SequencerEngine` actually gains `transport`/`play()`.

**B2 — `examples/arrangement-demo/src/App.tsx` no longer typechecks.** It
still does `import { createAudioClock, ... } from "@vixeq/core"` and calls
`createAudioClock(audioEl, { audioContext: ctx })` (lines 3, 45), but P2
removed `createAudioClock` from `@vixeq/core`'s public exports (confirmed
absent from `packages/core/src/index.ts` and from the rebuilt
`dist/index.d.ts`). Reproduced independently:
`pnpm --filter vixeq-example-arrangement-demo typecheck` →
`error TS2305: Module '"@vixeq/core"' has no exported member
'createAudioClock'.` This is not a "not yet migrated to the new pattern"
situation covered by the staged-migration note — it's an existing consumer
that built cleanly before this change and is broken by it now. Per
`AGENTS.md`'s collaboration rules ("preserve pre-existing and unrelated
working-tree changes" / definition of done: "no unrelated working-tree
changes are overwritten"), this example needs to be migrated to
`createMediaElementTransport`/`createClockTransport` (or `createAudioClock`
needs to stay until this last consumer moves) before P2 is complete.

## Ambiguities

**A1 — `suppressPlay`/`suppressPause` are booleans; `suppressSeekTargetMs`/
`suppressRateTarget` are value-correlated.** In
`packages/core/src/audioClock.ts`, the seek and rate-change suppression
mechanisms record the *expected value* and only suppress a DOM event that
actually matches it (`Math.abs(positionMs - suppressSeekTargetMs) < 0.5`,
`playbackRate === suppressRateTarget`). `suppressPlay`/`suppressPause` are
plain booleans with no correlation to a specific command. Per the HTML
spec, a real `<video>`/`<audio>` element's native `play`/`pause` DOM events
fire as queued tasks, not necessarily synchronously inside the `.play()`/
`.pause()` call (unlike this test suite's `FakeMedia`, which dispatches
synchronously). If a second command of the same kind is queued and runs
before the first command's native event fires, the stale flag could
theoretically swallow a later, unrelated native event instead of the one it
was meant for. Not reproduced by any test — the fake media's synchronous
dispatch can't expose this ordering. Recommend a token/generation-counter
approach symmetric with the seek/rate pattern, or an explicit note that the
native event is assumed to always fire before the next same-type command is
queued.

## Missing tests

- **`suppressNextError` path is never exercised.** In
  `createMediaElementTransport`, a failed `play()` sets `suppressNextError =
  media.error !== null` to swallow one delayed, command-correlated native
  `"error"` event. `FakeMedia.error` is never set non-null in
  `audioClock.test.ts`, so this branch has no coverage.
- **No test for `play()` rejecting from the `ended` state.** `play()` from
  `"ended"` eagerly does `media.currentTime = 0` (with
  `suppressSeekTargetMs = 0`) *before* the fallible `await media.play()`. If
  `media.play()` rejects, the catch block recomputes state from the
  already-reset position, landing on `"stopped"` (position 0) rather than
  restoring the original `"ended"` (position = duration) state. No test
  confirms whether this is the intended behavior for a failed play-from-ended,
  and it's a plausible, if narrow, atomicity gap: a rejected command
  otherwise isn't supposed to leave the transport in a state other than the
  one it started from.
- **No AudioBuffer rate-change × loop/natural-end interaction test.** `PB-
  TR-011` (rate) and `PB-TR-013` (loop) and `PB-TR-016` (natural end) are
  each tested independently for `createAudioBufferTransport`; none combines
  a rate change with loop or natural-end scheduling at this layer (the
  checklist calls this out explicitly). The underlying scheduling is
  inherited from P1's already-tested `createClockTransport`, so risk is low,
  but the wrapper's own `source.playbackRate.value` sync isn't verified
  under that combination.

## Final verdict

Approved. Both blockers are confirmed fixed and independently re-verified:
`packages/core/README.md` now documents the actual current
(`clock`/`timeDriven`/`start()`) Engine surface instead of the unimplemented
P3 `{ transport }`/`play()` API, and `examples/arrangement-demo` no longer
imports the removed `createAudioClock` — it builds a `PlaybackTransport` and
adapts it to `PlaybackClock` instead, and typechecks and builds cleanly. The
Core transport logic itself (`createMediaElementTransport`,
`createAudioBufferTransport`) was already sound in the prior pass. Ambiguity
A1 (boolean vs. value-correlated suppression flags) and the three
missing-test items (`suppressNextError` path, play-from-`ended`-rejection
atomicity, AudioBuffer rate×loop/natural-end interaction) remain as
non-blocking follow-ups — none require touching `packages/core/README.md`
or `examples/arrangement-demo`, and none block marking P2 `done`.

## Codex resolution

- **B1 fixed:** `packages/core/README.md` now documents the current P1/P2-era
  integration boundary: `SequencerEngine` still consumes `PlaybackClock`, while
  the new `PlaybackTransport` is adapted through `getPositionMs()` until the P3
  Engine integration lands. The examples no longer use `{ transport }` or
  `engine.play()`.
- **B2 fixed:** `examples/arrangement-demo/src/App.tsx` now uses
  `createMediaElementTransport()` and adapts its position to the
  `PlaybackClock` required by `useArrangement()`. It no longer imports the
  removed `createAudioClock`.
- Reverification after fixes:
  - `pnpm --filter @vixeq/core typecheck` — passed.
  - `pnpm --filter @vixeq/core test` — passed, 14 files / 191 tests.
  - `pnpm --filter vixeq-example-arrangement-demo typecheck` — passed.

Claude re-review signed off. P2 may be marked `done`.
