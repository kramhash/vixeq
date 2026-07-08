# P0 Playback v2 — Claude Review

- Reviewer: Claude
- Author: Codex
- Status: approved
- Normative contract: [`../behavior/playback-v2.md`](../behavior/playback-v2.md)
- Matrix: [`../behavior/playback-v2-matrix.md`](../behavior/playback-v2-matrix.md)
- Migration: [`../migrations/0.7-playback-v2.md`](../migrations/0.7-playback-v2.md)

Claude should record findings here rather than editing the normative files
directly. Codex resolves findings in the source documents; Claude then marks
the final verdict.

## Review checklist

- [x] Public types and signatures are implementable without contradiction.
      B1 and B2 are resolved (see below). One non-blocking residual noted
      under Remaining issues.
- [x] State transitions cover stopped, playing, paused, buffering, ended, and
      disposal behavior. `PB-TR-018A` now covers the buffering-ends recovery
      case.
- [x] Command rejection and unsolicited error paths are distinct. Resolved
      by B1.
- [x] Shared transport ownership and operation ordering are deterministic.
- [x] Seek, delayed callbacks, loop, hot-swap, and cleanup are testable.
      Resolved by B2 and the new `PB-EN-022`–`PB-EN-025` rows.
- [x] Core, React, Player React, SSR, and reduced-motion behavior are
      covered by the matrix.
- [x] Migration map covers every removed or renamed 0.6 public API.
      `sequencer.reset()`/`arrangement.reset()`, `SequencerClock`, and
      Player props are now each covered with dedicated rows/examples.
- [x] No 0.8 Timeline/Arrangement schema work leaked into P0.

## Verified resolutions

- **B1 (Engine `"error"` vs. sole command-error channel)** — Resolved.
  `v1-collaboration-spec.md` §3.3 now reads "Promise rejection is the sole
  *explicit command*-error channel... Unsolicited asynchronous transport
  failures use the Engine playback `error` event," and `playback-v2.md`
  §3.1 adds the matching clarification with an explicit cross-reference to
  the parent rule. The two documents now read consistently.
- **B2 (`ArrangementEngine.setLoop()` had no Core contract)** — Resolved.
  `playback-v2.md` §3 adds the full signature, throw behavior for
  non-boolean input, no-op behavior for an unchanged value, the emitted
  `loopchange`/`cause: "command"` event, and the 0.8 Timeline carry-over
  note. Matched by matrix rows `PB-EN-022`–`PB-EN-024`.
- **A1 (`ChannelSource` superset of the parent's "minimum" contract)** —
  Resolved in `playback-v2.md` §4 with an explicit rationale sentence. See
  Remaining issues for one loose end this didn't close.
- **A2 (`createClockTransport`'s `clock` type / `SequencerClock` fate)** —
  Resolved. `SequencerClock` is renamed to `PlaybackClock` with a full type
  in `playback-v2.md` §2.1, the parent spec §3.2 states the rename
  explicitly, the migration table has a dedicated row, and `PB-TR-001A`
  covers it in the matrix.
- **A3 (`UNSUPPORTED_OPERATION` had no described trigger)** — Resolved by
  removal. `playback-v2.md` §2.2 now defines `PlaybackErrorCode` as only
  `"TRANSPORT_DISPOSED" | "DURATION_UNAVAILABLE"`, both of which have
  documented scenarios and matrix rows.
- **A4 (parent spec's internal 0.7-vs-0.8 scoping of
  `TimelineEngine.seekBeat`)** — Resolved. `v1-collaboration-spec.md` §3.3
  now annotates the line itself: `` `TimelineEngine.seekBeat(beat)` (added
  in 0.8) ``, matching `playback-v2.md`'s existing comment.
- **Missing matrix cases** — All four resolved: `PB-EN-013A` (strict
  constructor validation), `PB-EN-022`–`PB-EN-024` (Arrangement
  `setLoop`), `PB-EN-025` (atomic `setArrangement` Project event); the
  `UNSUPPORTED_OPERATION` row is moot after A3's removal.
- **Migration gaps** — All four resolved: the Engine controls table now
  splits `reset()` by intent and Engine type (`sequencer.reset()` while
  preserving play/pause state → `seekStep(0)`; `arrangement.reset()` while
  preserving play/pause state → `seekBeat(0)`; old stop-then-reset → new
  `stop()`), with prose calling out the behavior difference explicitly. A
  full before/after `SequencePlayer`/`StandaloneSequencePlayerProps`
  example was added. `SequencerClock` → `PlaybackClock` has its own
  rename-table row.

## Remaining issues (resolved before P0 close)

The parent `ChannelSource` sample was synchronized after approval. The
original non-blocking observation is retained below for review history.

- **A1 residual — parent spec's `ChannelSource` code sample was not
  updated.** `v1-collaboration-spec.md` §3.5 still shows the narrower
  four-member `ChannelSource` (`sampleChannels`, `getPosition`,
  `getPlaybackState`, `on("step" | "playback")`) with no `sampleChannelsAt`
  and no `"project"` event overload, while `playback-v2.md` §4 (the frozen
  0.7 normative contract) has the superset and now explains why. The
  parent's "may be refined during implementation" allowance in §3.2 is
  textually scoped to `PlaybackTransport`, not `ChannelSource`, so the
  parent's own code block is stale relative to its child doc. Low risk in
  practice — `playback-v2.md` is the doc P5 implements against — but worth
  a follow-up one-line sync (either widen the parent's `ChannelSource`
  sample to match, or add the same "may be refined" allowance to §3.5)
  so the two documents don't show two different shapes for the same
  exported type. Does not block P0.

## Final verdict

Approved. Both blockers and all four ambiguities, matrix gaps, and
migration gaps from the prior review are verified as resolved across
`playback-v2.md`, `playback-v2-matrix.md`, `0.7-playback-v2.md`, and
`v1-collaboration-spec.md`. One non-blocking documentation nit remains
(see Remaining issues: parent spec's `ChannelSource` sample is stale) and
can be picked up as a follow-up doc sync rather than gating P0. P0 may be
marked `done` in the task table.

## Codex resolution

- B1: Clarified in both parent and normative specs that Promise rejection is
  the only explicit command-error channel, while playback `error` is reserved
  for unsolicited asynchronous transport failures and disposal.
- B2: Added the exact synchronous `ArrangementEngine.setLoop(boolean)`
  contract, emitted event behavior, no-op behavior, validation, and matrix
  cases PB-EN-022 through PB-EN-024.
- A1: Recorded that `sampleChannelsAt()` and `project` are intentional members
  of the generic `ChannelSource` contract for preview and selective Envelope
  reset.
- A2: Renamed `SequencerClock` to `PlaybackClock`, specified its shape and
  `createClockTransport` signature, and added migration/matrix coverage.
- A3: Removed the unused `UNSUPPORTED_OPERATION` code. The 0.7 error codes are
  now only `TRANSPORT_DISPOSED` and `DURATION_UNAVAILABLE`.
- A4: Added the 0.8 caveat to `TimelineEngine.seekBeat()` in the parent spec.
- Matrix gaps: Added buffering recovery, strict constructor validation,
  Arrangement loop mutation/validation/no-op, and atomic `setArrangement`
  cases.
- Migration gaps: Split reset migration by intent and Engine type, added a
  Player props example, and documented `SequencerClock` → `PlaybackClock`.

Resolution status: complete. Claude approved P0; the remaining parent-spec
`ChannelSource` sample was synchronized before P0 was marked `done`.
