# P3 SequencerEngine Playback v2 — Claude Review

- Reviewer: Claude
- Author: Codex (original implementation), Claude (blocker fixes — Codex hit
  usage limits mid-review-response and handed the remaining work off)
- Status: approved
- Task: P3
- Contract: [`../behavior/playback-v2.md`](../behavior/playback-v2.md)
- Matrix: [`../behavior/playback-v2-matrix.md`](../behavior/playback-v2-matrix.md)

Review findings belong in this file. Do not edit implementation, normative
specification, migration, or matrix files directly.

## Implementation scope

- Refactored `SequencerEngine` from raw `PlaybackClock` / increment mode /
  `start()` APIs to `PlaybackTransport` ownership/borrowing.
- Added async `play()`, `pause()`, `stop()`, `seekStep()`, and
  `seekPositionMs()` controls.
- Removed public Sequencer `start()`, `reset()`, and `setBpm()` methods from
  the class implementation.
- Removed `clock`, `timeDriven`, and `originMs` from
  `SequencerEngineOptions`; default construction now creates an Engine-owned
  browser-clock transport.
- Added Engine `"playback"` events with command/transport causes and
  transport-derived snapshots.
- Added current-position sampling through `sampleChannels()` and pure
  `sampleChannelsAt(positionMs)`.
- Added strict Sequencer Project validation on construction and hot-swap.
- Preserved fractional beat on Sequencer `setProject()` without seeking the
  underlying transport, and discard that temporary live-edit anchor on the
  next transport seek/stop.
- Updated P3 behavior matrix rows and Core README/API docs.

## Files to inspect

- `packages/core/src/SequencerEngine.ts`
- `packages/core/src/SequencerEngine.test.ts`
- `packages/core/src/types.ts`
- `packages/core/src/index.ts`
- `packages/core/src/arrangement/ArrangementEngine.ts`
- `packages/core/README.md`
- `docs/api/core.md`
- `docs/behavior/playback-v2-matrix.md`
- `CHANGELOG.md`

## Review checklist

- [x] Constructor accepts `transport?: PlaybackTransport`, validates
      `lookaheadMs`, and rejects invalid Projects without normalization.
- [x] Default Sequencer construction owns a browser-clock transport; supplied
      transports are borrowed and survive Engine disposal.
- [x] `play`, `pause`, `stop`, `seekStep`, and `seekPositionMs` delegate to the
      transport, validate arguments synchronously where required, and reject
      transport failures.
- [x] Transport events map to Engine `"playback"` events with correct
      command/transport cause and previous-state snapshots.
- [x] Step events use `scheduledPositionMs`, `transportPositionMs`, `lateByMs`,
      and `cause`; explicit seeks emit only the destination step.
- [x] Natural tick scheduling catches up delayed callbacks according to
      `missedStepPolicy`.
- [x] Pause/buffering/transport disposal freeze logical sampling at the cached
      position.
- [x] `setProject()` preserves fractional beat, emits one Project event, and
      remains atomic on invalid input. **Fixed — see Resolutions, B1.**
- [x] Engine listener failures are isolated and reported through
      `onListenerError` with `source: "engine"`.
- [x] `dispose()` is idempotent, terminal, clears timers/listeners, and only
      disposes Engine-owned default transports.
- [x] Matrix `covered` rows have corresponding tagged tests. **Fixed — see
      Resolutions, B3.**

## Verification

Re-ran independently rather than trusting the claims:

- `pnpm --filter @vixeq/core typecheck` — passed, matches claim.
- `pnpm --filter @vixeq/core test` — 13 files, **187 passed**, matches claim
  exactly (`SequencerEngine.test.ts` has 19 tests).
- Rebuilt with `tsup src/index.ts src/dom.ts --format esm,cjs --dts
  --sourcemap` from `packages/core` — passed.
- Re-audited the generated `SequencerEngine` declaration in `dist/index.d.ts`:
  confirms `play`, `pause`, `stop`, `seekPositionMs`, `seekStep`, `dispose`,
  `setProject`, `sampleChannels`, `sampleChannelsAt` are present and `start`,
  `reset`, `setBpm`, `isPlaying`, and old `sampleChannels(timeMs)` are absent
  from the class. Matches claim.
- **Went further than the checklist asked and wrote a standalone
  reproduction test** (not committed — created, run, and deleted) to verify
  a suspicion from reading `setProject()`'s anchor logic against the `ended
  -> play` state-transition row. It reproduced a real bug — see Blocker B1.
- `git diff --check` — passed.

## Staged-migration note

Accepted. P3 intentionally migrates only `SequencerEngine` inside
`@vixeq/core`. `ArrangementEngine`, React hooks, Player React, and examples
still contain pre-P3 playback calls and are scheduled for P4/P6/P7. The
minimal edit to `ArrangementEngine.ts`'s `emitStep()` (populating the new
required `StepEvent` fields with placeholder values — `cause: "tick"`
always, `lateByMs: 0` always — so it keeps compiling against the now-shared
`StepEvent` shape) is an acceptable, clearly-scoped compile fix, not a
behavioral migration; P4 must replace those placeholders with real
semantics. Full workspace typecheck/build is correctly not a P3 gate.

## Blockers

**B1 — Stale live-tempo-edit anchor after `ended` → `setProject()` →
`play()` reports the wrong logical position and step.** `setProject()`
establishes `this.projectAnchor = { transportPositionMs, projectPositionMs
}` to preserve fractional beat across a BPM/`stepsPerBeat` hot-swap without
seeking the transport (`SequencerEngine.ts:216-219`). That anchor is only
cleared in `handleTransportEvent` on `"seek"` or `"stop"`
(`SequencerEngine.ts:312-314`) — **not** on `"play"`. But per the frozen
`playback-v2.md` §3.2 state table, `ended -> play` "resets to 0 first" —
the underlying transport's raw position jumps back to 0 as part of that
command. If a tempo edit (`setProject()`) was made while the Engine was
`"ended"`, the anchor recorded then is calibrated against the transport's
*old* (pre-reset) position, and survives the reset untouched. The next
`getLogicalPositionMs()` call computes
`projectAnchor.projectPositionMs + (0 - projectAnchor.transportPositionMs)`,
which is `<original projectPositionMs> - <original transport position>` —
not 0. Reproduced concretely (test written, run, and removed — not part of
this diff):

```ts
const transport = createClockTransport(clock, { durationMs: 1000 });
const engine = new SequencerEngine(project /* bpm 120 */, { transport });
await engine.play();
clock.advance(1000);               // -> ended, position 1000
engine.setProject(setProjectBpm(project, 60)); // halve bpm while ended
// engine.getPosition().positionMs is now 2000 (beat preserved, correct so far)
await engine.play();               // ended -> play: transport resets to 0
transport.getPositionMs();         // 0 (correct)
engine.getPosition().positionMs;   // 1000 (WRONG — spec requires 0)
```

The emitted "step 0" event for this `play()` (per §5: "`ended -> play`:
reset and emit step 0") would also carry the wrong `stepIndex` /
`scheduledPositionMs`, since `emitStepForPosition` reads the same stale
`getLogicalPositionMs()`. Fix: clear `projectAnchor` on `"play"` as well
(at least when `previousState === "ended"`, and arguably whenever the
transport performed a non-continuous position change), mirroring the
existing `"seek"`/`"stop"` clearing. No existing test exercises `ended` →
`setProject()` → `play()` together, which is why this shipped.

**B2 — The shared, frozen `EnginePlaybackEvent` type has been narrowed to a
Sequencer-only shape.** `playback-v2.md` §3.1 defines `EnginePlaybackEvent`
generically with `snapshot: EnginePlaybackSnapshot`, and explicitly says
"Sequence snapshots additionally expose `stepIndex`. Arrangement/Timeline
snapshots additionally expose `iteration`" — i.e., each concrete Engine is
expected to have its *own* event type extending the shared shape.
`packages/core/src/types.ts` instead redefines the **same public name**
`EnginePlaybackEvent` with `snapshot: SequencerPlaybackSnapshot` (`{
...EnginePlaybackSnapshot, stepIndex }`) hardcoded in. This type is used by
the generic `ChannelSource.on("playback", ...)` overload and is exported
from `@vixeq/core`'s public surface unchanged in name. `playback-v2.md`
itself was **not** updated to match (I re-read it in this review; §3.1
still shows the generic `snapshot: EnginePlaybackSnapshot`), so the checked-
in normative contract and the shipped implementation now disagree under the
same type name, with no recorded decision — exactly what `AGENTS.md` rule 10
("If implementation reveals a conflict with this specification, stop that
work item and record the decision required; do not silently choose a new
public behavior") says not to do. Concretely, this will collide with P4:
`ArrangementEngine`'s playback events need `snapshot: EnginePlaybackSnapshot
& { iteration: number }`, which is a different shape than
`SequencerPlaybackSnapshot`; P4 cannot reuse today's `EnginePlaybackEvent`
as its own event type without either widening `snapshot` back to the base
type (breaking anyone who wrote Sequencer-specific code against the
`stepIndex` field on this name) or introducing yet another name and leaving
the P3-shipped `EnginePlaybackEvent` an orphaned, misleadingly-named type.
TypeScript's bivariant method-parameter checking likely hides this from
`tsc` today (`ChannelSource.on` uses method-shorthand syntax), which is
consistent with the passing typecheck — this is a contract-design defect,
not a compile error. Fix: keep `EnginePlaybackEvent.snapshot:
EnginePlaybackSnapshot` (generic, matching the frozen doc) and introduce a
`SequencerPlaybackEvent = Omit<EnginePlaybackEvent, "snapshot"> & { snapshot:
SequencerPlaybackSnapshot }` for `SequencerEventMap["playback"]` instead.

**B3 — Multiple `SequencerEngine.test.ts` tests are tagged with the wrong
matrix ID**, so `covered` status in `playback-v2-matrix.md` doesn't reliably
point to the right test for several rows. Confirmed by comparing each test's
actual assertions against the matrix row descriptions:

| Test title (as written) | Actually tests (matrix row) | Should be tagged |
| --- | --- | --- |
| `PB-EN-002A can skip missed transport-driven steps` | PB-EN-009 (delayed callback with skip) | `PB-EN-009` (`PB-EN-002A` isn't a matrix row) |
| `PB-EN-008 samples the current logical position and pure positions separately` | PB-CH-001 / PB-CH-004 (sampleChannels / sampleChannelsAt) | `PB-CH-001 PB-CH-004` |
| `PB-EN-009 setProject preserves fractional beat without seeking transport` | PB-EN-011 / PB-EN-011A (BPM hot-swap preserves beat; one Project event) | `PB-EN-011 PB-EN-011A` |
| `PB-EN-011 adopts an already-playing transport without synthetic step events` | no existing Engine-level row (closest is transport-level `PB-TR-027`, still `planned`) | a new row, or an explicit note that it's the Engine-level analog of `PB-TR-027` |
| `PB-EN-018 forwards transport ended and replay starts from zero` | PB-EN-017 (transport end -> all attached Engines enter ended) | `PB-EN-017` |
| `PB-EN-022 transport disposal detaches the Engine at the cached position` | PB-EN-018 (transport dispose while playing -> cached position, paused, controls reject) | `PB-EN-018` |
| `PB-EN-026 maps external transport events to playback cause transport` | general external-event cause attribution, not PB-EN-026's two-Engines-sharing scenario | doesn't clearly match any row as written |

The underlying *behavior* in each case is real and does get exercised — this
is a labeling problem, not a coverage gap — but it means `playback-v2-matrix.
md`'s `covered` status for `PB-EN-002A`(non-existent)/`PB-EN-009`/`PB-EN-011`/
`PB-EN-011A`/`PB-EN-017`/`PB-EN-018` cannot currently be trusted by grepping
test names for those IDs, which is the entire point of the convention stated
at the top of the matrix file. This should be cleaned up (rename the test
titles to the correct IDs) before other agents start relying on the matrix
to know what's already tested.

## Ambiguities

**A1 — Engine-disposed rejections reuse the `TRANSPORT_DISPOSED` code.**
`assertLive()` throws `new PlaybackError("TRANSPORT_DISPOSED", "SequencerEngine
has been disposed.")` when the *Engine* itself (not its transport) has been
disposed. `PlaybackErrorCode` only has `"TRANSPORT_DISPOSED" |
"DURATION_UNAVAILABLE"` — there's no `ENGINE_DISPOSED` code — so reusing
`TRANSPORT_DISPOSED` for "the Engine you called this on is disposed" is a
defensible choice given the available vocabulary, but a caller checking
`error.code === "TRANSPORT_DISPOSED"` to detect "my transport died" would
also match "I disposed this Engine myself," which is a different situation
(the transport may be perfectly alive and reusable by another Engine). Low
severity — the distinct `message` string is the only differentiator today.
**Resolved by documentation** — see Resolutions, A1.

## Resolutions

Codex hit its usage limit before it could act on this review, so Claude
picked up the fixes as author for this pass (still self-reviewing, since no
other reviewer was available).

**B1 — fixed.** `handleTransportEvent` (`SequencerEngine.ts`) now also clears
`projectAnchor` on `event.type === "play" && previousState === "ended"`, in
addition to the existing `"seek"`/`"stop"` clearing. `stopped -> play` is
intentionally left alone: position 0 there is anchor-neutral regardless of a
tempo edit. Added a regression test (`PB-EN-011 PB-EN-017 setProject while
ended does not leave a stale anchor after replay`) that reproduces the exact
review repro (`ended` → `setProject(bpm halved)` → `play()`) and asserts
`getPosition().positionMs === 0`, `getCurrentStepIndex() === 0`, and the
replay step-0 event carries `scheduledPositionMs: 0`.

**B2 — fixed.** `types.ts`'s `EnginePlaybackEvent.snapshot` is back to the
generic `EnginePlaybackSnapshot`, matching frozen `playback-v2.md` §3.1
verbatim. Added `SequencerPlaybackEvent = Omit<EnginePlaybackEvent,
"snapshot"> & { snapshot: SequencerPlaybackSnapshot }` and retargeted
`SequencerEventMap["playback"]` to it. `SequencerEngine.emitPlayback()` now
builds a `SequencerPlaybackEvent`. `SequencerPlaybackEvent` is exported
alongside the existing `EnginePlaybackEvent`/`EnginePlaybackSnapshot`/
`SequencerPlaybackSnapshot` from `@vixeq/core`. `ChannelSource.on("playback",
...)` is untouched (still the generic type, per spec). P4 can now define its
own `ArrangementPlaybackEvent` extending the generic `EnginePlaybackEvent`
with `iteration` without colliding with this name. Verified in
`dist/index.d.ts` after rebuild: `EnginePlaybackEvent.snapshot:
EnginePlaybackSnapshot`, `SequencerPlaybackEvent` present and exported.

**B3 — fixed.** Renamed six test titles to the IDs identified in the table
above (`PB-EN-009`, `PB-CH-001 PB-CH-004`, `PB-EN-011 PB-EN-011A`,
`PB-EN-017`, `PB-EN-018`). For the two tests with no prior matrix row, added
new rows instead of leaving them untagged: `PB-EN-027` (Engine attaches to an
already-playing transport — the Engine-level analog of transport-level
`PB-TR-027`) and `PB-EN-028` (external/non-command transport events map to
Engine playback events with `cause: "transport"`), both marked `covered` and
tagged onto the renamed tests. Re-verified every `covered` ID referenced in
this review greps to a matching test title.

**A1 — documented.** Added a note to `playback-v2.md` §3.4 (Disposal)
stating that Engine-disposal API calls intentionally reuse
`TRANSPORT_DISPOSED` (no dedicated `ENGINE_DISPOSED` code exists), and that
this does not imply the Engine's transport is also disposed. No code change.

**Re-verification**: `pnpm --filter @vixeq/core typecheck` passes;
`pnpm --filter @vixeq/core test` — 13 files, 188 tests (187 prior + 1 new B1
regression test), all passing; `tsup` build passes; `dist/index.d.ts`
confirms the B2 type shapes; `git diff --check` passes.

## Final verdict

Approved. All three blockers (B1 stale-anchor bug, B2 narrowed public
contract, B3 matrix/test-ID traceability) are fixed and independently
re-verified; A1 is resolved by a spec clarification. Scope stayed within
`packages/core/src/{SequencerEngine,types,index}.ts`,
`docs/behavior/playback-v2{,-matrix}.md`, and this review file, as
anticipated — `ArrangementEngine`, React, Player React, and examples were not
touched. P3 is ready to be marked `done` in
`docs/plans/v1-collaboration-spec.md`.
