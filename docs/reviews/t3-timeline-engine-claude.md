# T3 TimelineEngine Review

- Status: approved (updated by re-review below; originally `changes_requested`)
- Task: T3 — Implement indexed `TimelineEngine`
- Author: Codex
- Reviewer: Claude
- Normative contract: [`../behavior/timeline-arrangement-v2.md`](../behavior/timeline-arrangement-v2.md) §3
- Matrix: [`../behavior/timeline-arrangement-v2-matrix.md`](../behavior/timeline-arrangement-v2-matrix.md) (`TL-EN-001`..`013`)

## Scope

Implements the 0.8 Timeline v2 engine shell in `@vixeq/core`:

- internal indexed Timeline event range helper
- public `TimelineEngine`
- Timeline cue/playback/project event types
- core Timeline exports
- focused TimelineEngine and index tests

## Changed Files

- `docs/plans/v1-collaboration-spec.md`
- `packages/core/src/timeline/eventIndex.ts`
- `packages/core/src/timeline/eventIndex.test.ts`
- `packages/core/src/timeline/TimelineEngine.ts`
- `packages/core/src/timeline/TimelineEngine.test.ts`
- `packages/core/src/timeline/index.ts`
- `packages/core/src/timeline/query.ts`
- `packages/core/src/timeline/types.ts`

## Review Focus

- Confirm `TimelineEngine` matches spec §7:
  - no cue emission on explicit seek
  - local loop does not mutate transport loop
  - local end does not stop shared transport
  - loop boundary dispatch order includes beat-0 cues per iteration
  - hot-swap preserves beat and avoids retroactive cues
  - already-playing transport attachment emits no historical/current cue
- Confirm `eventIndex` preserves existing query semantics while using binary-search boundaries.
- Check whether `scheduledPositionMs` should remain raw iteration position for looped cues, as implemented.
- Check generic `TimelineEvent` typing and exported public surface.

## Commands Run

- `pnpm --filter @vixeq/core test -- src/timeline/eventIndex.test.ts src/timeline/TimelineEngine.test.ts`
- `pnpm --filter @vixeq/core typecheck`
- `pnpm --filter @vixeq/core build`

## Known Failures

None.

---

## Review checklist

- [x] `TimelineEngine` does not implement `ChannelSource` (`TL-EN-001`): no
      `sampleChannels`/`sampleChannelsAt` anywhere in `TimelineEngine.ts` or
      `types.ts` (confirmed by `grep`). True by omission; not exercised by an
      explicit assertion in any test — see N3.
- [x] `seekBeat()` validates synchronously and emits zero cue events
      (`TL-EN-002`/`003`). `seekBeat` is a non-`async` function that `throw`s
      a `RangeError` directly (not inside a returned rejected `Promise`) for
      `beat < 0 || beat > durationBeats || !Number.isFinite(beat)`, confirmed
      by the test's synchronous `expect(() => engine.seekBeat(5)).toThrow(...)`
      (not an `await expect(...).rejects`). The transport `"seek"` branch of
      `handleTransportEvent` never calls `emitDueCues`/`emitCurrentCues`, so a
      valid `seekBeat` updates position/emits a `playback` `"seek"` event but
      no `cue` event — confirmed by the "seekBeat emits playback seek without
      cue events" test.
- [ ] Natural playback delayed-dispatch policy branches correctly
      (`TL-EN-004`/`005`) — **`"emit"` confirmed correct, `"skip"` is
      confirmed broken; see B1.** `"emit"` mode dispatches every crossed
      event in beat order via `getEventsInBeatRangeInclusiveEnd`, each with
      its own `lateByMs` — verified by reading `emitDueCuesForIteration`
      and by the "dispatches cue events from play and natural ticks" test,
      which crosses two events in a single big tick jump and gets both, in
      order.
- [x] Explicit seek never invokes the delayed-dispatch policy and always
      emits zero cues for the traversed range (`TL-EN-006`). Same code path
      as the `TL-EN-002` check above — the `"seek"` transport-event branch
      has no call to `emitDueCues`/`emitCurrentCues`/the `missedCuePolicy`
      field at all, for either a landing position that coincides with an
      event or one that doesn't.
- [x] Loop dispatch repeats beat-0 events every iteration, no dedup
      (`TL-EN-007`). Read `emitDueCuesForIteration`'s per-iteration range
      construction: for every iteration after the first, `fromLocalPositionMs`
      is deliberately set to `-POSITION_EPSILON_MS` (not `0`), so a beat-0
      event's `scheduledLocalPositionMs === 0` is never `<=` the (negative)
      exclusive-from bound and is never skipped. Confirmed by the "dispatches
      local loop boundaries..." test: `cues === ["zero:0", "one:0", "zero:1"]`.
- [x] Dispatch events carry `iteration`/`scheduledPositionMs`/
      `transportPositionMs`/`lateByMs` (`TL-EN-008`). All four fields are
      populated unconditionally in `emitCue` (`TimelineEngine.ts:653-667`);
      `TimelineCueEvent` (`types.ts:83-89`) declares exactly these four plus
      `event`. Confirmed by the `toMatchObject` assertion in the first test.
- [x] Hot-swap preserves beat position and never seeks the transport
      (`TL-EN-009`). `setProject()` contains no call to `this.transport.seek*`
      anywhere; it recomputes `cachedPositionMs`/`projectAnchor` purely from
      the previously-read beat and the new project's `TimingMap`, then only
      emits a `"project"` event (and, if the new position is at/past the new
      local end, an `"ended"` `playback` event) — no transport command is
      issued. Confirmed by the hot-swap test: position after swap is exactly
      the mapped equivalent beat, not reset to `0` or re-derived from a seek.
- [x] Hot-swap does not retroactively emit events at/before the current beat
      (`TL-EN-010`). `setProject` re-anchors `lastDispatchedRawPositionMs` to
      the *new* project's position at the *current* beat (not to `null` and
      not to the old raw ms), so the next `emitDueCues` call's `fromRawPositionMs`
      starts exactly at the swapped-to position — anything at or before it is
      excluded by the same exclusive-from-bound logic used for loop
      iterations. Confirmed by the hot-swap test: after swapping in a project
      with a new event at beat `0.5` while parked at beat `1`, only the beat
      `1.5` event ("future") fires; "retro" never does.
- [x] Non-looping local end transitions to local `ended` without stopping the
      shared transport (`TL-EN-011`). `tick()`'s local-end branch sets
      `this.playbackState = "ended"` and emits a local `"ended"` `playback`
      event, but never calls `this.transport.stop()` or any transport method.
      Confirmed by the "reaches local ended without stopping a shared
      transport" test: `engine.getPlaybackState() === "ended"` while
      `transport.getPlaybackState() === "playing"`.
- [x] `eventIndex.ts` provides real `O(log n + k)` range access, not a full
      scan (`TL-EN-012`/`013`). `lowerBoundBeat`/`upperBoundBeat` are
      classic binary searches over the (pre-sorted, per T2's
      events-pre-sorted invariant) `project.events` array; every one of
      `getEventsInBeatRange(InclusiveEnd)`/`getEventsAtBeat`/`getNextEvents`
      locates its `[fromIndex, toIndex)` bounds via these binary searches
      and then iterates only that slice in `filterRange` — no method touches
      indices outside the located range. `TimelineEngine`'s per-tick dispatch
      (`emitDueCuesForIteration`) calls
      `eventIndex.getEventsInBeatRangeInclusiveEnd`, never `project.events`
      directly, so per-tick dispatch is index-bound, not scan-bound. Both a
      100,000-event `eventIndex.test.ts` range/next-events test and a
      100,000-event `TimelineEngine.test.ts` dispatch test exist and assert
      exact output identity (not timing), matching the spec's explicit
      "bounded index probes, not scan count" requirement.
- [x] `TimelineEngine` correctly implements the Playback v2 state machine via
      `PlaybackTransport`. `play`/`pause`/`stop`/`seekPositionMs`/`seekBeat`
      are structurally near-identical to the already-approved
      `ArrangementEngine`'s equivalents (`runTransportCommands`, ended-replay
      seek modes, `projectAnchor` position remapping, local-loop vs.
      transport-loop separation via a `localLoop` field that never calls
      `transport.setLoop`) — read side by side with
      `packages/core/src/arrangement/ArrangementEngine.ts` to confirm the
      pattern is reused, not reinvented.
- [x] No duplicated validation logic: `assertValidTimelineProject` in
      `TimelineEngine.ts` calls T2's `validateTimelineProject` from
      `./project` (not a reimplementation), on both construction and
      `setProject()`, threading `options.eventValidator` through unchanged.
- [x] `query.ts` preserves T2 query semantics after being rewritten to go
      through `eventIndex`. `getEventsInBeatRange`'s finite/half-open/
      `RangeError` checks are byte-for-byte the same checks, only relocated
      into `eventIndex.ts`; `trackId: null`/`includeGlobalEvents`/
      `eventTypes`/`includeDisabledTracks` semantics (`matchesQueryOptions`)
      are like-for-like relocated, confirmed via `git diff HEAD --
      packages/core/src/timeline/query.ts`. One small, apparently
      unintentional behavior drift surfaced during the diff read — see N2
      (non-blocking, untested edge case both before and after).
- [x] Independently re-ran every requested command — see Verification
      method and Commands run below. All green, matching the author's
      reported "Known Failures: None."

## Verification method

Read spec §7 (parent plan) and the frozen contract §3
(`timeline-arrangement-v2.md`) in full, then read every changed/new file
(`eventIndex.ts`, `eventIndex.test.ts`, `TimelineEngine.ts`,
`TimelineEngine.test.ts`, `index.ts`, `query.ts`, `types.ts`) end to end,
comparing each spec bullet and each `TL-EN-*` row against the corresponding
code path. Cross-checked `TimelineEngine`'s Playback-v2 state-machine
plumbing against the already-approved `ArrangementEngine`/`SequencerEngine`
(P3/P4) for structural consistency, and diffed `query.ts` against its
pre-T3 version (`git diff HEAD -- packages/core/src/timeline/query.ts`) to
confirm T2 query semantics survived the `eventIndex` rewrite.

**On B1 (`missedCuePolicy: "skip"`):** The spec text and the `TL-EN-005`
matrix row both say "only the most-advanced due event dispatches; earlier
missed cues... are discarded" — a rule with no mention of `lookaheadMs`.
`ArrangementEngine`'s own `missedStepPolicy: "skip"` (an already-approved,
explicitly-referenced-as-the-model sibling engine, per spec §7's "mirroring
Sequence/Arrangement `missedStepPolicy`") implements exactly that: on a
tick, if `missedStepPolicy === "skip"`, it resolves *only* the position's
current step and emits that one, with no lateness threshold anywhere in the
branch (`ArrangementEngine.ts:637`). `TimelineEngine`'s implementation
instead does, per crossed event, `if (missedCuePolicy === "skip" && lateByMs
> lookaheadMs) continue;` (`TimelineEngine.ts:645`) — a per-event lateness
filter, not a "keep only the last" filter. These are different algorithms
whenever more than one event is due in a single dispatch window. Wrote and
ran two ad hoc probe tests directly against the built engine (temporarily
added under `packages/core/src/timeline/`, run via
`pnpm --filter @vixeq/core exec vitest run`, then deleted — not left in the
tree) to confirm the divergence is real, not a misreading:

```
probe 1 — two events 100ms apart (beat 0.1, 0.2), lookaheadMs: 200, missedCuePolicy: "skip"
  single tick jump 0ms -> 250ms
  expected (spec): only "later" (the most-advanced due event) fires
  actual: cues fired = ["earlier", "later"]   -- BOTH fire (false positive)

probe 2 — a single event (beat 0.1 = 100ms), lookaheadMs: 10, missedCuePolicy: "skip"
  single huge stall jump 0ms -> 5000ms (simulating a backgrounded tab)
  expected (spec): the sole/most-advanced due event always fires under "skip"
  actual: cues fired = []   -- it never fires at all (false negative)
```

Both failure modes are reachable in ordinary use, not just contrived
pathological input: probe 1's scenario (multiple events closer together in
beat-time than `lookaheadMs`) is routine for any project with a moderately
dense cue track and the library's own default `lookaheadMs` (25ms), and
probe 2's scenario (a single stale event past the lookahead window) is the
exact case "skip" exists to handle, yet it silently drops the cue instead of
emitting it once. Full probe source and failing `vitest` output are
preserved in this review's investigation notes; the probe files themselves
were deleted (`git status` confirmed clean of `__probe*.test.ts` afterward).

**On N2 (`getEventsAtBeat` non-finite `toleranceBeats`):** diffed
`query.ts` old vs. new. Old: `tolerance = Math.max(0, toleranceBeats)`, so a
`NaN` `toleranceBeats` produces `tolerance = NaN`, and `Math.abs(...) <=
NaN` is always `false` — every call with `toleranceBeats: NaN` returned
`[]` unconditionally, exact match or not. New (`eventIndex.ts`):
`tolerance = Math.max(0, Number.isFinite(toleranceBeats) ? toleranceBeats :
0)`, i.e. a non-finite `toleranceBeats` is treated as `0` (exact match),
so a call with `toleranceBeats: NaN` at an exact event beat now *does*
return that event. Neither the old nor the new behavior for this specific
degenerate input is covered by any `TL-Q-*` matrix row or existing test, so
this is a silent, incidental semantic change introduced by the refactor
rather than a scoped-and-intentional one — low severity, no spec rule
governs it either way, but worth a decision (restore the old
always-empty behavior, or keep the arguably-more-sensible new one and
document it) rather than leaving it as an untracked side effect.

Independently re-ran every requested command:

- `pnpm --filter @vixeq/core test` — 18 files, **261 tests passed**
  (matches the author's implicit "no known failures"; no regressions in the
  16 pre-existing files).
- `pnpm --filter @vixeq/core typecheck` — clean, no output.
- `pnpm --filter @vixeq/core build` — ESM/CJS/DTS all succeeded.
- `pnpm typecheck` (full workspace) — all 10 projects clean.

## Findings

### B1 (blocking) — `missedCuePolicy: "skip"` does not implement "only the most-advanced due event dispatches"

**File:** `packages/core/src/timeline/TimelineEngine.ts:634-651`
(`emitDueCuesForIteration`), specifically line 645.

Spec (`docs/behavior/timeline-arrangement-v2.md:200-203`) and matrix row
`TL-EN-005` both specify: under `"skip"`, exactly one event — the
most-advanced (highest-beat) one due in the current dispatch window —
fires; every earlier missed cue in that same window is discarded,
unconditionally. The implementation instead applies a per-event
`lateByMs > lookaheadMs` threshold filter inside the loop over all due
events, independently for each event. This is a different algorithm from
"keep only the last, drop the rest," and diverges from it whenever more
than one event falls inside a single dispatch window:

- If two or more due events are all within `lookaheadMs` of the current
  transport position (a normal occurrence for any project with events
  spaced closer together than the polling interval — no stall required),
  **all of them fire**, not just the most-advanced one.
- If the single (or most-advanced) due event's lateness exceeds
  `lookaheadMs` (e.g. after any stall/buffering/backgrounded-tab gap larger
  than one poll interval — exactly the scenario "skip" exists to handle),
  **it is silently dropped and nothing fires**, even though the spec
  guarantees the most-advanced due event always dispatches under "skip".

**Failure scenario:** A timeline with two cues 100ms apart (beats `0.1` and
`0.2` at 60 BPM) and `missedCuePolicy: "skip"`, `lookaheadMs: 200`. A single
natural tick advances the transport from `0ms` to `250ms` (well within one
ordinary polling gap for a `lookaheadMs` this size). Expected: only the
`beat 0.2` cue fires. Actual (confirmed by direct execution): both cues
fire. Separately, a timeline with one cue at beat `0.1` (`100ms`) and
`lookaheadMs: 10`; after a `5000ms` stall (a backgrounded tab resuming,
which is realistic and exactly the case the policy is meant to handle),
expected: that one cue fires once (it is the most-advanced/only due event).
Actual (confirmed by direct execution): no cue fires at all.

**Fix (for author to implement/decide, not applied by this review):** the
`"skip"` branch should identify the *last* (highest-beat) event in the
`events` slice returned by `getEventsInBeatRangeInclusiveEnd` for the
current dispatch window and emit only that one (mirroring
`ArrangementEngine`'s "skip" branch, which resolves and emits only the
step at the *current* position, with no separate lateness threshold at
all), rather than filtering each event independently against
`lookaheadMs`.

**Test-coverage gap:** the existing `"missedCuePolicy skip discards late
cues but keeps on-time cues"` test (`TimelineEngine.test.ts:192-210`) only
exercises two events with a very large beat-time gap (900ms) where the
later one happens to have `lateByMs === 0`, so it cannot distinguish "keep
only the most-advanced event" from "keep any event within
`lookaheadMs`" — both algorithms happen to produce the same result for that
specific input. A corrected test needs (a) two due events close enough
together to both fall under `lookaheadMs` in a single tick, asserting only
the later one fires, and (b) a single due event whose lateness exceeds
`lookaheadMs`, asserting it still fires exactly once.

### Decision required (non-blocking to this verdict) — "cue" vs. "event" terminology diverges from T0's frozen identifiers

This is a naming question, not a behavioral one — verified that no runtime
behavior differs between the two vocabularies, and it does not affect the
verdict above (B1 is the sole blocking issue). Recorded separately per the
task's instruction not to let it affect approval and not to propose a fix.

**What's actually inconsistent**, enumerated by `grep` across the repo:

| Identifier role | Parent spec §7 (prose) | T0 frozen contract §3 / matrix (identifiers) | Implementation |
| --- | --- | --- | --- |
| Delayed-dispatch option name | not a literal identifier; prose only | `missedEventPolicy` (code block + prose, `timeline-arrangement-v2.md:199,204`; matrix rows `TL-EN-004/005/006`) | `missedCuePolicy` (`types.ts:123`; `TimelineEngine.ts` throughout) |
| Dispatch-payload type name | not a literal identifier; prose only | `TimelineDispatchEvent` (explicit `export type` code block, `timeline-arrangement-v2.md:212-218`) | `TimelineCueEvent` (`types.ts:83-89`) |
| Event-channel key (`.on(...)`) | not specified | not specified (no code block gives this) | `"cue"` (`TimelineEventMap.cue`, `types.ts:105`) |
| Handler-option name | not specified | not specified | `onCue` (`types.ts:125`) |
| Internal private field/method names | n/a | n/a | `missedCuePolicy` field, `emitCue()` method (private, not public surface) |

Two observations on the table:

1. The parent spec's own prose (`v1-collaboration-spec.md` §7, and its
   description of Timeline throughout, e.g. "cue scheduler," "seekBeat()
   emits no cue events," "missed cues") consistently uses "cue" as the
   vocabulary word for a dispatched Timeline event. T0's frozen contract
   *also* uses "cue" pervasively in prose ("cue scheduler," "no cue events
   for the seek itself," "missed cues... discarded," "zero cue events for
   the traversed range") — but the two concrete identifiers it actually
   froze in code blocks (`missedEventPolicy`, `TimelineDispatchEvent`) both
   use "event"/"Dispatch," not "Cue." So T0 itself is not internally
   uniform: its prose vocabulary and its frozen identifier vocabulary
   disagree. The implementation is consistent with T0's *prose* vocabulary
   and with the parent spec throughout, just not with T0's two frozen
   *identifiers*.
2. The event-channel key `"cue"` and the `onCue` option have no
   corresponding frozen identifier in T0 at all (T0 never shows a
   `.on(...)` call or a channel-key string), so these two are not a
   deviation from an explicit frozen name — they're a new naming choice
   consistent with (and presumably derived from) the implementation's other
   "Cue" choices, filling a gap T0 left open.

**Behavioral impact:** none. Confirmed by reading every branch that touches
these identifiers — `missedCuePolicy`'s two accepted values (`"emit"`/
`"skip"`) and their semantics, and `TimelineCueEvent`'s four payload fields
(`iteration`/`scheduledPositionMs`/`transportPositionMs`/`lateByMs`), are
exactly what §3 specifies under the *other* names. This is a pure rename
question. `grep`-confirmed zero downstream references to either vocabulary
anywhere in `packages/react`, `packages/player-react`, `examples/`,
`apps/`, or `docs/api`/`docs/migrations` — T5/T6 haven't started, so neither
naming choice has any existing consumer to break.

**On spec §13.10 applicability:** §13.10 says an implementer who discovers
a conflict with the specification should stop the work item and record
that a decision is required, rather than silently choosing new public
behavior. This case sits at the boundary of that rule rather than
squarely inside it: no new *behavior* was invented (every semantic §3
requires is present, just under different names), and T0's contract is not
ambiguous or silent about the two identifiers it did freeze — it gives
explicit code blocks. So this isn't "the spec didn't say, so I picked
something"; it's closer to "the spec said X, the implementation did Y,"
which is a plain deviation from an unambiguous frozen name, not a gap the
implementer had to fill in. Strictly, an unannounced deviation from an
explicit frozen identifier is the kind of thing §13.7 ("report exact
commands run and any checks not run") and the general collaboration spirit
of §13 would expect to be surfaced in the review request — the author's
"Review Focus" section does not mention the renames at all. Recommend the
user decide once, here, which vocabulary is canonical going forward
(`missedEventPolicy`/`TimelineDispatchEvent` to match T0's frozen contract
literally, or `missedCuePolicy`/`TimelineCueEvent`/`"cue"`/`onCue` to match
both specs' prose and give the implementation's own internal consistency
priority, with T0 updated to match) — and record that decision by editing
T0's frozen contract if "cue" wins, or the implementation if "event" wins,
before T5 (`useTimeline`) or T6 (website-pulse integration) build public
surface on top of either name.

### N1 (non-blocking) — matrix `TL-EN-001`..`013` rows were not flipped from `planned`

**File:** `docs/behavior/timeline-arrangement-v2-matrix.md:76-88`.

Unlike T1/T2 (which flipped their corresponding matrix rows to `covered` as
part of the same change), none of `TL-EN-001` through `TL-EN-013` were
updated; all still read `planned`, even though most now have a
corresponding passing test. Given B1, `TL-EN-005` specifically must not be
flipped until the "skip" fix and a corrected test land. The other rows
(`001`-`004`, `006`-`013`) appear ready to flip to `covered` once this
review's findings are otherwise resolved. Recommend doing the flip in the
same change as the B1 fix, per the T1/T2 precedent.

### N2 (non-blocking) — `getEventsAtBeat`'s non-finite `toleranceBeats` handling silently changed during the `eventIndex` rewrite

See Verification method above for the full before/after comparison. Not
covered by any matrix row or test either before or after, and no spec rule
governs the degenerate-input case either way — flagged only because it's
an incidental, apparently-unnoticed side effect of the refactor rather than
a deliberate choice. Low severity; does not block.

### N3 (minor, non-blocking) — `TL-EN-001` (no `ChannelSource`) and "no historical/current cue on attach to an already-playing transport" have no dedicated assertion naming the property being tested

`TL-EN-001` holds by simple omission (confirmed by `grep`), but no test
asserts it explicitly (e.g. `expect((engine as any).sampleChannels).toBeUndefined()`,
or a `// @ts-expect-error` type-level check), unlike T2's precedent of
asserting a removed export's absence directly (`TL-018` in
`project.test.ts`). Separately, the "does not emit historical or current
cues when attached to an already-playing transport" behavior (exercised by
an existing test) is real and correct by inspection, but isn't one of the
enumerated `TL-EN-*` rows, so it isn't tracked by the matrix at all. Neither
gap affects correctness; both are testing-hygiene nits.

### N4 (minor, non-blocking) — no test asserts a nonzero `lateByMs` under the default `"emit"` policy

Every test that produces a genuinely late cue (`lateByMs > 0`) exercises
`missedCuePolicy: "skip"` (whose semantics are the subject of B1); the
`"emit"`-policy tests all happen to have `lateByMs === 0` for every
asserted cue. Recommend adding an `"emit"`-policy case with a real stall
gap, asserting a specific nonzero `lateByMs`, once B1's fix and its own new
tests land (so the two can share a similar "stall" test fixture).

## Final verdict

**Changes requested.** The bulk of T3 is implemented correctly and closely
mirrors the already-approved `ArrangementEngine`/`SequencerEngine` Playback
v2 pattern: `seekBeat`/`seekPositionMs` synchronously validate and never
trigger dispatch; loop boundary dispatch correctly re-fires beat-0 events
every iteration via a deliberately-asymmetric range bound; hot-swap
preserves beat position, never seeks the transport, and correctly avoids
retroactive dispatch by re-anchoring `lastDispatchedRawPositionMs` to the
new project's mapped position; local non-looping end transitions to local
`ended` without touching the shared transport; `eventIndex.ts` is a real
binary-search-backed range index (not a scan) that `TimelineEngine`'s
per-tick dispatch and `query.ts`'s public functions both correctly route
through, backed by 100,000-event fixtures in both `eventIndex.test.ts` and
`TimelineEngine.test.ts`; T2's `validateTimelineProject` is reused rather
than reimplemented; and `query.ts`'s T2-established `trackId: null`/
`includeGlobalEvents`/half-open-`RangeError` semantics survived the
rewrite to go through `eventIndex` essentially unchanged (one minor,
untested edge-case drift noted as N2). All four requested commands
(`pnpm --filter @vixeq/core test`/`typecheck`/`build`, `pnpm typecheck`)
were independently re-run and are green, matching the author's reported
"no known failures."

However, **B1 is a genuine, empirically-confirmed correctness bug**:
`missedCuePolicy: "skip"` does not implement `TL-EN-005`'s "only the
most-advanced due event dispatches" — it implements a per-event
`lateByMs > lookaheadMs` threshold filter instead, which both under- and
over-fires relative to spec in reachable, non-pathological scenarios (two
close-together due events both firing; a single late due event firing
zero times). This must be fixed — matching `ArrangementEngine`'s
"resolve-and-emit-only-the-current-position" pattern for `"skip"` is the
straightforward path — with a corrected test that distinguishes the two
algorithms, before this task is marked `done`.

Separately, and **not affecting this verdict**, this review surfaced a
naming question requiring the user's decision: the implementation's
`missedCuePolicy`/`TimelineCueEvent`/`"cue"` channel key/`onCue` vocabulary
does not match T0's two frozen identifiers (`missedEventPolicy`/
`TimelineDispatchEvent`), even though it does match both specs' own prose
("cue scheduler," "cue events," "missed cues" throughout). No behavior
differs either way, and no downstream code yet depends on either name — see
the "Decision required" section above for the full comparison and
recommendation to resolve this before T5/T6 build on top of it.

The four non-blocking findings (N1: matrix rows not flipped; N2: an
incidental, unspecified edge-case behavior drift in `getEventsAtBeat`'s
non-finite-tolerance handling; N3: `TL-EN-001` and the already-playing-
attach property lack dedicated assertions; N4: no test asserts a nonzero
`lateByMs` under `"emit"`) do not block sign-off on their own and may be
addressed at the author's discretion, ideally alongside the B1 fix.

Recommend: fix B1 (rewrite the `"skip"` branch to emit only the
most-advanced due event in the dispatch window, unconditionally, matching
`ArrangementEngine`'s pattern), add the two corrected test cases described
under B1's test-coverage gap, and flip the now-correct `TL-EN-*` matrix
rows (N1) in the same change, then re-request review. The terminology
decision (separate from this verdict) should be resolved by the user before
T5/T6 land any public surface on top of either vocabulary.

## Re-review (fixes verification)

**Reviewer:** Claude (this session). Verified by reading the current source
(not just the diff) and re-running every previously-requested command; no
findings below are taken on faith from commit messages.

### B1 (blocking) — RESOLVED

`packages/core/src/timeline/TimelineEngine.ts`'s `emitDueCuesForIteration`
(now lines ~616-662) collects **every** due event from
`getEventsInBeatRangeInclusiveEnd` into a `dueEvents` array using only the
half-open-window bounds check (`scheduledLocalPositionMs <=
exclusiveFromPositionMs` / `> toLocalPositionMs + POSITION_EPSILON_MS`) —
there is no `lateByMs > lookaheadMs` (or any lateness) comparison anywhere
in that loop; `grep -n lookaheadMs TimelineEngine.ts` confirms the field is
referenced only in the constructor (validation/default) and in
`scheduleNextTick`'s `setTimeout` interval, never inside
`emitDueCuesForIteration`. After collection, the dispatch selection is:

```ts
const toDispatch = this.missedCuePolicy === "skip" ? [dueEvents[dueEvents.length - 1]] : dueEvents;
```

i.e. for `"skip"`, unconditionally take the last (highest-beat, most-advanced)
element of the array actually built from *all* due events, regardless of its
own `lateByMs` — exactly "collect all due, keep only the most-advanced,
discard the rest unconditionally," matching `TL-EN-005`/spec §3 and
`ArrangementEngine`'s `missedStepPolicy: "skip"` pattern. The old per-event
`lateByMs > lookaheadMs` filter is completely gone; nothing resembling it
remains in the method or elsewhere in the file.

Manually traced both of the review's original failure-mode probes against
this code:

- Probe 1 (two events 100ms/200ms apart, single tick 0→250ms,
  `lookaheadMs: 200`, `"skip"`): `dueEvents` ends up `[earlier, later]`
  (both pass the window-bound check, no lateness filter to exclude either);
  `toDispatch` takes only `later`. Only "later" fires — correct.
- Probe 2 (one event at 100ms, single stall 0→5000ms, `lookaheadMs: 10`,
  `"skip"`): `dueEvents` ends up `[stale]` (still inside the window even
  though very late — there is no lateness check to drop it); `toDispatch`
  takes the only element, `stale`. It fires exactly once — correct.

Both previously-reported false-positive and false-negative failure modes are
gone by construction, not just by the two new tests happening to pass.

### Regression tests (B1) — RESOLVED, correctly discriminating

`packages/core/src/timeline/TimelineEngine.test.ts` adds:

- `"missedCuePolicy skip keeps only the most-advanced due event when
  several are due in one tick"` (lines 212-233): two events at beat `0.1`
  and `0.2`, `lookaheadMs: 200`, `missedCuePolicy: "skip"`, a single
  `tickEngine(clock, 250, 200)` (one clock jump 0→250ms, one fired tick —
  this is exactly the review's probe 1 shape, not a multi-tick simulation).
  Asserts `cues === ["later"]`.
- `"missedCuePolicy skip still dispatches the sole due event after a stall
  longer than lookaheadMs"` (lines 235-254): one event at beat `0.1`,
  `lookaheadMs: 10`, a single `tickEngine(clock, 5_000, 10)` (one clock jump
  0→5000ms, one fired tick — probe 2's shape). Asserts `cues === ["stale"]`.

Hand-traced both against the code (not just "ran and it's green"): for test
1, `fromBeat = 0`, `toBeat = 0.25`, `getEventsInBeatRangeInclusiveEnd(0,
0.25)` returns both events (`0.1`, `0.2` beat ≤ `0.25`); both pass the
`exclusiveFromPositionMs`/`toLocalPositionMs` window check since the window
is `[~0, 250]` ms and both are at `100`/`200` ms; `dueEvents = [earlier,
later]`; `"skip"` keeps `dueEvents[1]` = `later`. For test 2, `fromBeat =
0`, `toBeat = 5`, the single event at `100` ms is well inside `[~0, 5000]`
ms and is the only (and thus last) element of `dueEvents`; it fires. Each
test is specifically shaped so the old buggy per-event `lateByMs >
lookaheadMs` filter would have produced a *different*, wrong result (test 1:
old code would keep both, since neither event's `lateByMs` — `150`/`50` ms —
exceeds `lookaheadMs: 200`; test 2: old code would drop the sole event,
since its `lateByMs` — `4900` ms — exceeds `lookaheadMs: 10`), so these tests
do discriminate the two algorithms, not just re-confirm the already-passing
900ms-gap test. Ran `pnpm --filter @vixeq/core test` — both tests pass
(details under Commands re-run below).

### N2 (non-blocking) — RESOLVED

`packages/core/src/timeline/eventIndex.ts`'s `getEventsAtBeat` (lines
129-141) now reads:

```ts
// Deliberately not Number.isFinite-guarded: a non-finite toleranceBeats
// (e.g. NaN) propagates into an always-empty result, matching the
// pre-eventIndex behavior this function replaces.
const tolerance = Math.max(0, toleranceBeats);
const fromIndex = lowerBoundBeat(events, beat - tolerance);
const toIndex = upperBoundBeat(events, beat + tolerance);
```

The `Number.isFinite(toleranceBeats) ? toleranceBeats : 0` guard reported in
the original review is gone. Traced the binary search with `toleranceBeats =
NaN`: `Math.max(0, NaN) === NaN`, so both `lowerBoundBeat(events, beat -
NaN)` and `upperBoundBeat(events, beat + NaN)` are called with `NaN` as the
target. In `lowerBoundBeat`, the loop condition `events[middle].beat <
NaN` is `false` for every element (any comparison against `NaN` is `false`),
so every iteration takes the `else` branch (`high = middle`) and `low` never
advances from `0`; the loop terminates with `low === high === 0`, so
`lowerBoundBeat` returns `0`. In `upperBoundBeat`, the analogous condition
`events[middle].beat <= NaN` is likewise always `false`, so it also always
takes `high = middle` and also returns `0`. Both bounds collapse to `0`,
giving `fromIndex = toIndex = 0`; `filterRange(0, 0, ...)`'s loop condition
`index < toIndex` (`0 < 0`) is immediately false, so it returns `[]`
unconditionally — for *any* beat, not only special-cased ones. This
reproduces the pre-T3 behavior (old: `Math.abs(...) <= NaN` always `false`
→ always `[]`) via a different code path (binary-search collapse instead of
an `Math.abs` comparison), with the same observable result. Confirmed by
reading the code; `eventIndex.test.ts`/`query.test.ts` still pass (this
degenerate case is still untested, same as before T3 — not a new gap
introduced by this fix).

### N1 (non-blocking) — RESOLVED

`docs/behavior/timeline-arrangement-v2-matrix.md`'s `TL-EN-*` table (lines
74-88): all of `TL-EN-001` through `TL-EN-013` now read `covered` (verified
by direct read, not `grep` alone — every row's `Status` cell was checked).
`TL-EN-005`'s `Expected result` cell was also updated in the same edit, from
whatever it read before, to "only the most-advanced due event dispatches,
unconditionally (no lateness threshold)" — i.e. it now states the corrected
algorithm, not the withdrawn per-event-lateness one, so the row's `covered`
status is not stale relative to its own description.

### N3 (non-blocking) — RESOLVED

`packages/core/src/timeline/TimelineEngine.test.ts` adds `"TL-EN-001 does
not implement ChannelSource (no sampleChannels methods)"` (lines 275-282),
which directly asserts
`(engine as unknown as { sampleChannels?: unknown }).sampleChannels` and
`...sampleChannelsAt` are both `toBeUndefined()` — a dedicated, named
assertion for `TL-EN-001`, matching T2's precedent style. (The second half
of the original N3 note — the already-playing-attach behavior not being an
enumerated `TL-EN-*` row — is a matrix-scope observation, not something a
test change resolves; it remains true but was explicitly out of scope for a
"resolved/not resolved" call since N3's actionable ask was the missing
assertion, which is now present.)

### N4 (non-blocking) — RESOLVED

`TimelineEngine.test.ts` adds `"missedCuePolicy emit reports a nonzero
lateByMs for a stalled cue"` (lines 256-273): default (`"emit"`) policy, a
single event, a `5_000`ms stall with `lookaheadMs: 10`, asserting
`cues[0].lateByMs` is `toBeGreaterThan(0)` (concretely `4_900`, per a manual
trace: `transportPositionMs 5_000 - scheduledPositionMs 100`) alongside
`scheduledPositionMs: 100`/`transportPositionMs: 5_000` via `toMatchObject`.
This is a real nonzero-lateness case under `"emit"`, independent of the
`"skip"`-only tests that motivated the original finding.

### Terminology decision — recorded as resolved (non-blocking, informational)

The task instructions state the user has decided "cue" is the canonical
vocabulary going forward, and that `docs/behavior/timeline-arrangement-v2.md`
§3 and its matrix were edited to match (`missedEventPolicy` →
`missedCuePolicy`, `TimelineDispatchEvent` → `TimelineCueEvent`), with the
implementation left unchanged (it already used "cue"). Verified directly:

- `docs/behavior/timeline-arrangement-v2.md` §3 (lines 186-225) now reads
  `missedCuePolicy` and `export type TimelineCueEvent<...>` throughout;
  `grep -n "missedEventPolicy\|TimelineDispatchEvent"` across
  `docs/behavior/`, `packages/`, `apps/`, and `examples/` returns **no
  matches** — the only remaining occurrences of the old names in the repo
  are inside this review file's own pre-existing Findings section (an
  intentional historical record of what T0 used to say, left untouched per
  the task instruction not to edit prior content).
- No internal contradiction remains in §3: every sentence in the "Dispatch
  policy for events skipped by natural transport delay" bullet and the
  `TimelineCueEvent` code block use the "Cue" vocabulary consistently, and
  this now matches `packages/core/src/timeline/types.ts`/`TimelineEngine.ts`
  verbatim (`missedCuePolicy`, `TimelineCueEvent`, `"cue"` channel key,
  `onCue`) — T0 and the implementation are no longer divergent on these two
  identifiers.
- This was a naming-only question with no behavioral impact (as the
  original review already established), so no code or test changes were
  expected or needed on the implementation side, and none were made.

### Commands re-run

- `pnpm --filter @vixeq/core test` — **18 files, 265 tests passed** (4 more
  than the original review's 261: the two B1 regression tests, the N4
  nonzero-`lateByMs` test, and the N3 `TL-EN-001` assertion test). No
  regressions.
- `pnpm --filter @vixeq/core typecheck` — clean, no output.
- `pnpm --filter @vixeq/core build` — ESM/CJS/DTS all succeeded.
- `pnpm typecheck` (full workspace, 10 projects) — all clean.

### Updated verdict

**All items from the original review are resolved: B1 (the sole blocking
issue) is fixed and correctly covered by two new discriminating regression
tests; N1-N4 are all addressed; the cue/event terminology question has been
decided by the user and T0's frozen contract now matches the
implementation with no remaining contradiction.** No new issues were found
during this re-review. The document's `Status:` field (top of this file)
has been updated from `changes_requested` to `approved` accordingly.
