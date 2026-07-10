# T6 Website Pulse Review

- Status: approved
- Task: T6 — Integrate Timeline v2 into `website-pulse`
- Author: Codex
- Reviewer: Claude

## Scope

Updates `examples/website-pulse` to demonstrate the 0.8 Timeline v2 + React hook integration:

- adds typed Timeline cue data beside the existing Sequence project
- attaches `useTimeline<WebsitePulseTimelineEvent>()` to the same audio transport as `SequencePlayer`
- adds live scene/caption cue display
- adds stop, scrub, playback-rate, and full-show loop controls
- switches demo audio transport default loop to false so loop is explicit
- keeps `SequencePlayer` as the choreography editor and SequencerEngine source for channel animation

## Changed Files

- `docs/plans/v1-collaboration-spec.md`
- `docs/reviews/t6-website-pulse-claude.md`
- `examples/website-pulse/src/App.tsx`
- `examples/website-pulse/src/brandProject.ts`
- `examples/website-pulse/src/styles.css`

## Review Focus

- Confirm Timeline and Sequence share the same `PlaybackTransport`.
- Confirm `useTimeline` wrapper controls are used for scrub, playback rate, and transport loop.
- Confirm Timeline duration is 8 beats at 120 BPM (4s), matching `demo-loop.wav`.
- Confirm custom audio replacement reattaches both SequencePlayer and TimelineLayer to the new transport.
- Confirm reduced motion still allows discrete Timeline cue updates.
- Confirm UI remains compact and does not regress the existing editor flow.

## Commands Run

- `pnpm --filter vixeq-example-website-pulse typecheck`
- `pnpm --filter vixeq-example-website-pulse build`
- `pnpm --filter vixeq-example-website-pulse test`
- `browser-use open http://127.0.0.1:5173/`
- `browser-use state`
- `browser-use screenshot /private/tmp/website-pulse-browser.png --full`
- `browser-use eval "JSON.stringify({live:document.querySelector('.live-cue')?.getBoundingClientRect().toJSON(), controls:document.querySelector('.show-controls')?.getBoundingClientRect().toJSON(), hero:document.querySelector('.hero')?.getBoundingClientRect().toJSON(), scene:document.querySelector('.app')?.dataset.scene, overflow:document.documentElement.scrollWidth > window.innerWidth})"`

## Known Limitations

- Desktop browser check passed with no horizontal overflow. The available `browser-use` CLI in this environment did not expose viewport resizing; mobile behavior was covered by responsive CSS review and production build, but not a true mobile screenshot.
- `examples/website-pulse` has no test files; `vitest --passWithNoTests` exits successfully.

---

## Review checklist

- [x] Timeline and Sequence share the same `PlaybackTransport` instance. `App.tsx`
      holds one `transport` piece of state (`useState<PlaybackTransport | null>`,
      `App.tsx:129`) created once from the decoded `demo-loop.wav`
      (`createAudioBufferTransport(ctx, buffer, { loop: false })`, `App.tsx:155`)
      or from a user-uploaded file (`App.tsx:277`, same factory). That single
      `transport` value is passed unchanged to both
      `<TimelineLayer transport={transport} .../>` (`App.tsx:336`) and
      `<SequencePlayer ... transport={transport} .../>` (`App.tsx:502`) — the
      same object reference, not two separately constructed transports. Confirmed
      live in a running browser session (see Verification method): toggling
      "Full-show loop" and playing drove both the Timeline position readout and
      the Sequencer-side hero visuals from the same clock, and scene/caption
      cues continued to fire correctly across an observed loop-boundary crossing.
- [x] UI controls route through the `useTimeline` wrapper, not the raw
      transport. `TimelineLayer` builds a `TimelineControlApi` (`App.tsx:42-46`)
      from `timeline.seekPositionMs`/`timeline.setPlaybackRate`/
      `timeline.setTransportLoop` — all three are values returned by
      `useTimeline()` itself (`App.tsx:80-82`), not `transport.seekMs`/
      `transport.setPlaybackRate`/`transport.setLoop` called directly. The
      scrub `<input type="range">` (`handleScrubChange`, `App.tsx:286-295`),
      the rate `<select>` (`handlePlaybackRateChange`, `App.tsx:297-306`), and
      the loop `<input type="checkbox">` (`handleFullShowLoopChange`,
      `App.tsx:308-317`) all call `timelineControlsRef.current?.<method>`, i.e.
      exclusively through the ref populated from `useTimeline`'s own API `grep
      -n "transport\."` inside `App.tsx` returns no direct transport-command
      call from the component itself. Reading `useTimeline.ts` confirms
      `setPlaybackRate`/`setTransportLoop` do call `transportRef.current.
      setPlaybackRate`/`.setLoop` (`useTimeline.ts:365-383`) — but that call
      happens *inside* the hook, through `enqueueEngineCommand`, which is the
      intended wrapper boundary; the example never bypasses it.
- [x] Timeline duration matches `demo-loop.wav` exactly. `brandTimelineProject`
      (`brandProject.ts:67-116`) is built with `timing: { bpm: 120 }` and
      `durationBeats: 8`; `brandTimelineDurationMs = beatToMs(timing, 8)`
      (`brandProject.ts:118-121`) evaluates to `60000 / 120 * 8 = 4000` ms.
      Measured `examples/website-pulse/public/demo-loop.wav` directly (Python
      `wave` module, not a guess from a comment): 176,400 frames at 44,100 Hz =
      **exactly 4.0000 s**. The scrub bar's `max={brandTimelineDurationMs}`
      (`App.tsx:415`) and the live browser session's own readout (`"... /
      4.00s"`) both confirm the same value end to end, not just at the
      constant-definition level.
- [x] Custom audio replacement reattaches both consumers to the new transport.
      `handleFileChange` (`App.tsx:266-284`) disposes the old transport and
      calls `setTransport(nextTransport)`, which is the same React state both
      `<TimelineLayer transport={transport}>` and `<SequencePlayer transport=
      {transport}>` read from — so both re-render with the new transport
      object. Confirmed this is not just a prop pass-through that the
      underlying hooks ignore: `useTimeline`'s construction effect dependency
      array includes `transport` (`useTimeline.ts:282`) and `useSequencerEngine`
      's construction effect dependency array also includes `transport`
      (`useSequencerEngine.ts:260`) — both are pre-existing, already-approved
      (T5/P6) behaviors that rebuild the Engine against a changed `transport`
      prop, and `SequencePlayer` passes `transport` straight through to
      `useSequencePlayer({ ..., transport })` (`SequencePlayer.tsx:146`)
      without an intermediate memoization that would mask a reference change.
      No live file-upload was exercised in the browser session (no synthetic
      audio fixture was on hand), so this item is confirmed by code-path
      tracing through already-reviewed hook internals, not by driving the
      actual `<input type="file">` end to end.
- [x] Reduced motion suppresses only channel animation, not discrete Timeline
      cues. `useAnimatedChannels(engine, { motionPreference: reducedMotion ?
      "reduce" : "no-preference", ... })` (`App.tsx:214-223`) is the only place
      `reducedMotion` is threaded into animation code; `grep -n
      "reducedMotion|prefersReducedMotion" App.tsx` shows no occurrence inside
      `TimelineLayer` or its `useTimeline(...)` call (`App.tsx:69-76`) — the
      Timeline hook is constructed unconditionally regardless of the media
      query. This matches T5's already-verified design ("`useTimeline` does
      not imply `ChannelSource` or connect to `useAnimatedChannels`"). Live
      browser check: `window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches` was `false` in the headless session, so the reduced-motion
      *branch itself* was verified by code reading rather than by driving the
      emulated-media-feature path live.
- [x] `styles.css` additions do not regress the hero/editor layout. Diffed
      the full change (`git diff examples/website-pulse/src/styles.css`): all
      109 added lines are new rules for `.live-cue`, `.live-cue__meta`,
      `.live-cue__scene`, `.show-controls`, `.show-control*`, plus one changed
      existing declaration (`.title-accent`'s `color` now blends in
      `--scene-accent` via `color-mix`) and a new mobile-breakpoint block
      inside the pre-existing `@media` query. No selector touching
      `.editor-panel`, `.track-legend`, `.vixeq-player__*`, or `.hero` itself
      was changed. Live browser session (desktop, 2056×1329 — the environment's
      default headless viewport, not a chosen 1280×800): `.live-cue` and
      `.show-controls` both render fully inside `.hero`'s bounding box
      (`left: 518` vs. hero `left: 478`/`right: 1578`), `document.documentElement
      .scrollWidth > window.innerWidth` is `false` (no horizontal overflow),
      and a full-page screenshot (saved under this session's scratchpad) shows
      the live-cue strip and show-controls row compactly stacked under the
      hero copy with no visual collision. True mobile-viewport verification
      was not possible — `browser-use --help` confirms this CLI build still
      has no viewport-resize/device-emulation command, matching the review
      request's own disclosed limitation — so the mobile-only rules
      (`.show-controls { grid-template-columns: 1fr; }`,
      `.live-cue__meta { flex-direction: column; }`) were verified by reading
      the CSS only, not rendered.
- [x] T3/T5 patterns are followed correctly: `useTimeline<WebsitePulseTimelineEvent>()`
      is used exactly like `useTimeline.test.tsx`'s own generic-event pattern
      (a discriminated `TimelineEvent<"scene"|"caption", ...>` union), and the
      loop-toggle path goes through `timeline.setTransportLoop` (a *transport*
      command), never `timeline.setLoop` (the T5-reviewed local/non-disposing
      Engine-loop setter) — the right choice for a "full-show loop" that must
      also loop the Sequencer side of the same shared transport.
- [x] No `player-react` or T7 scope creep. `git diff --stat` for this task
      touches only `App.tsx`, `brandProject.ts`, `styles.css`,
      `v1-collaboration-spec.md`, and this review file — no
      `packages/player-react/` file is touched, and `SequencePlayer` is used
      as-is with `showTransportControls={false}`, i.e. `website-pulse` builds
      its own transport UI in `App.tsx` rather than growing a generic
      Timeline/Arrangement surface inside `player-react`, consistent with
      spec §12's "Generic Arrangement/Timeline component in `player-react`"
      non-goal and §11's "`@vixeq/player-react` remains a Sequence-only GUI."
      No migration-fixture or beta-smoke files (T7's scope) are present in the
      diff either.
- [ ] **Undisclosed, out-of-scope core-package change bundled into the working
      tree alongside T6's declared files** — see **B1** below. This is the
      dominant finding of this review and is why the verdict is
      `changes_requested` despite every T6-scoped file being sound.

## Verification method

Read spec §11 ("Official examples and hosting") and §13 ("Agent collaboration
protocol") in full, then re-read T3's, T4's, and T5's review files
(`docs/reviews/t3-timeline-engine-claude.md`, `t4-arrangement-v2-claude.md`,
`t5-react-hooks-claude.md`) to match this review's checklist granularity and
verification rigor to the established precedent. Read `App.tsx`,
`brandProject.ts`, and the full `styles.css` diff end to end. Read
`useTimeline.ts`, `useSequencerEngine.ts`, and `SequencePlayer.tsx` (all
already-approved T5/P6/P7 code, not part of this diff) to confirm the
transport-sharing and reattachment claims are backed by real dependency-array
behavior, not just plausible-sounding prose.

**Live verification:** started the example's dev server
(`pnpm --filter vixeq-example-website-pulse dev --port 5183`) and drove it
with the `browser-use` CLI (confirmed available via `browser-use doctor`,
unlike whatever the author's environment had — the author's own "Known
Limitations" note says viewport resizing wasn't available in their build;
this session's build has the same gap, confirmed independently via
`browser-use --help`). Sequence of checks: loaded the page, confirmed the
scrub bar's `max=4000` and the transport/controls became enabled once
`demo-loop.wav` decoded; clicked "Play" and polled `.live-cue__meta`'s text
and `--pulse-beat` every ~1s to confirm position advanced in real time and
scene cues fired at the expected beats (`surge` at beat 2 = 1.0s, `signal` at
beat 4 = 2.0s); stopped, checked the "Full-show loop" checkbox *before*
restarting playback (to avoid a race between toggling the checkbox and the
4s track already ending — an artifact hit once during this session that
produced a misleading one-shot "stopped instead of looped" result, resolved
by reordering the check-then-play sequence), then restarted playback and
polled continuously through the 4s boundary: the scene cue correctly
progressed `arrival → surge → signal → afterglow` and then, after crossing
`4.00s`, continued from a low position again through `surge`/`signal` in a
second iteration — i.e. the shared transport's loop was genuinely exercised
live, not just asserted from reading code, and the Timeline side of the
shared transport continued dispatching correctly across the loop boundary (as
already established for `TimelineEngine` by T3). No console errors or
`.audio-error` text appeared at any point. A full-page screenshot taken
mid-loop (second iteration, `afterglow` cue) shows the hero, live-cue strip,
and show-controls row all rendering without collision.

Attempted, but abandoned as impractical, a live visual re-confirmation of the
`--pulse-beat` CSS variable "freezing" specifically: the kick envelope decays
fast enough (per `ENVELOPE_CONFIGS.beat`'s `decayRate: 4.5`) that polling via
sequential `browser-use eval` calls (each carrying real subprocess/CLI
round-trip latency, not a tight in-page loop) almost always samples the
variable already decayed back to `"0"`, whether or not step events are still
firing — so this particular black-box signal cannot distinguish "still
pulsing, just sampled between pulses" from "frozen." This does not weaken the
finding below: the freeze claim is instead verified by direct code tracing
(next section) and by the author's own new regression test, which was
independently re-run and hand-traced rather than trusted from its title
alone.

Independently re-ran every requested and full-workspace command:

- `pnpm --filter vixeq-example-website-pulse typecheck` — clean, no output.
- `pnpm --filter vixeq-example-website-pulse build` — `tsc --noEmit && vite
  build` succeeded (65 modules, no errors).
- `pnpm --filter @vixeq/core test` — **19 files, 270 tests passed** (one more
  file's worth of assertions than a pre-fix baseline would show: the new
  loop-boundary regression test), no failures.
- `pnpm --filter @vixeq/core typecheck` — clean, no output.
- `pnpm -r --no-bail typecheck` (full workspace, 10 projects) — all report
  `Done`, no errors, including `examples/website-pulse`.
- `pnpm -r --no-bail test` (full workspace) — every package passes or reports
  `--passWithNoTests` for packages with no test files (`packages/core` 270,
  `packages/react` 33, `packages/player-react` 6, `apps/playground` 11,
  `examples/cycling-workout` 5; `examples/website-pulse` itself still has no
  test files, matching the author's disclosed "Known Limitations").

## Findings

### B1 (blocking) — Undisclosed core-package change bundled into T6's working tree: real, necessary regression fix; genuinely relied upon by T6's headline feature; but claimed and documented nowhere

**Files:** `packages/core/src/SequencerEngine.ts:355-365`,
`packages/core/src/SequencerEngine.test.ts:105-137`,
`packages/core/src/types.ts:46`. None of these three files appear in this
review request's "Changed Files" list, and none is inside
`examples/website-pulse/`, T6's declared primary-files scope in the task
table (`docs/plans/v1-collaboration-spec.md`'s Task table, T6 row: "Primary
files: `examples/website-pulse/`"). `SequencerEngine.ts` is P3's primary file
— a task already marked `done`, with its own closed, already-approved review
(`docs/reviews/` — P3 predates the per-task review-file convention but is
recorded `done` in the task table) — and no task-table row currently claims
this change; T6's own row still lists only `examples/website-pulse/`.

**1. Is the bug real, and is the fix correct?** Yes to both, verified by
direct code tracing, not by taking the diff's own comment at face value.

Before this change, `SequencerEngine.handleTransportEvent`
(`SequencerEngine.ts:300-395`) had no branch for `event.type === "loop"` (a
transport event type that has existed since P1/P2 —
`packages/core/src/playbackTransport.ts:29`, `type: "loop"; iteration: number;
snapshot: PlaybackSnapshot` — and is emitted by `createClockTransport`
whenever a looping transport wraps position,
`playbackTransport.ts:214`/`audioClock.ts:213-215`). A `"loop"` event
therefore fell through to the final catch-all branch
(`SequencerEngine.ts:393-394`, pre-fix): `this.emitPlayback(event.type, cause,
previousState); this.rescheduleIfPlaying();` — no call to
`emitStepForPosition`/`emitDueSteps`, and critically no reset of
`this.lastEmittedAbsoluteStep`.

`emitDueSteps` (`SequencerEngine.ts:466-481`) guards re-emission with a
one-directional monotonicity check: `const last = this.lastEmittedAbsoluteStep;
if (last !== null && absoluteStep <= last) return;` — i.e. once
`lastEmittedAbsoluteStep` reaches some value `N` (the last step index before
the loop wraps), no `"tick"`-caused step will ever fire again unless a future
tick's `absoluteStep` exceeds `N`. But after a transport loop wrap, every
subsequent `positionMs` this engine will ever observe is bounded to `[0,
loopDurationMs)` — i.e. bounded by the same range that produced `N` in the
first place — so `absoluteStep` can be at most `N` again, never greater.
`absoluteStep <= last` is therefore true for every tick for the rest of the
session: **step emission (and, downstream, every envelope's
`.trigger()` call in `useAnimatedChannels`, since that trigger only fires
from the `"step"` event, `useAnimatedChannels.ts:110-120`) permanently stops
the instant a transport this Engine is attached to loops once**, regardless
of how many more times it loops afterward or how long playback continues.
Channel *sampling* (`sampleProjectChannels`, used by `sampleChannels()`) is
unaffected, since it derives directly from `positionMs` rather than from
`lastEmittedAbsoluteStep` — but `website-pulse` uses the envelope-based
`useAnimatedChannels` path (`App.tsx:214-223`, `envelopes: {...}` is passed),
whose values only *change* on `.trigger()`, so this is exactly the failure
mode that matters for this example.

The fix inserts a `"loop"` branch (`SequencerEngine.ts:355-365`) that calls
`this.emitStepForPosition(this.getLogicalPositionMs(), "loop")` — which goes
through `emitStepAtAbsolute` and unconditionally sets
`this.lastEmittedAbsoluteStep = absoluteStep` (`SequencerEngine.ts:495`) to
the *new*, post-wrap (small) `absoluteStep`. This re-anchors the monotonicity
guard so the next ordinary tick's `absoluteStep` (which will be `>=` this new,
small anchor) is no longer permanently suppressed. Traced this against the
author's own new test (`SequencerEngine.test.ts:105-137`, "resumes step
emission across a transport loop boundary"): a 4-step loop, stepped one
`STEP_MS` at a time across two full loop iterations (8 steps), asserts
`stepIndex` sequence `[0,1,2,3,0,1,2,3,0]` and `cause` sequence
`["play","tick","tick","tick","loop","tick","tick","tick","loop"]` — hand-
verified this is exactly what the fixed code produces (each loop wrap emits
one `"loop"`-caused step immediately, then three more `"tick"`-caused steps
until the next wrap) and exactly what the pre-fix catch-all branch would
*not* produce (it would emit `[0,1,2,3]` and then nothing ever again, since
`lastEmittedAbsoluteStep` would stay pinned at `3` for the rest of the run).
Independently re-ran `pnpm --filter @vixeq/core test`: 270/270 pass, including
this test. **Conclusion: this is a genuine, previously-unnoticed regression
in already-`done` P3 code, reachable by any ordinary Sequencer + looping-
transport combination (no contrived input needed), and the fix is correct.**

**2. Does `website-pulse` actually depend on this fix?** Yes, directly and
non-hypothetically, confirmed by reading `App.tsx` rather than assuming it
from the bug's description. The "Full-show loop" checkbox
(`handleFullShowLoopChange`, `App.tsx:308-317`) calls
`timelineControlsRef.current.setTransportLoop(nextLoop)`, which is
`useTimeline`'s `setTransportLoop`
(`useTimeline.ts:375-383`) — and that function calls
**`currentTransport.setLoop(nextLoop)`, i.e. it sets loop on the transport
object itself**, not on the `TimelineEngine`'s own local loop flag
(`setLoop`, a different, non-transport-affecting method also exposed by the
hook but not what this checkbox calls). Since `App.tsx` passes the exact same
`transport` instance to `<SequencePlayer transport={transport}>` (checklist
item 1, above), enabling "Full-show loop" makes the *shared* transport loop
— and the `SequencerEngine` powering the hero's `beat-disk`/`eq-bars`/
mood-color animation, via `SequencePlayer` → `useSequencerEngine`, is
subscribed to that same transport and will receive its `"loop"` event on
every wrap. Confirmed live in a browser session (see Verification method):
checking "Full-show loop" and playing past the measured 4.0s boundary showed
the Timeline scene cue correctly cycling through a second iteration, i.e.
the loop genuinely engaged on the shared transport during ordinary use of
this exact feature.

Put together: **without this fix, checking "Full-show loop" and letting the
4-second demo track loop even once would permanently freeze the hero's beat
pulse, CTA glow, EQ bars, and mood-color wash for the remainder of the
session** (Timeline scene/caption cues would keep working, since
`TimelineEngine`'s own loop handling was verified separately and correctly
under T3) — i.e. the single feature this task's own Scope section highlights
first ("full-show loop") and that spec §11 explicitly requires
website-pulse to demonstrate would visibly misbehave in exactly the way the
undisclosed fix's own test name describes ("effects freeze while audio
loops"). This is not a marginal or unlikely-to-be-hit dependency; it is the
demo's headline scenario.

**3. Protocol position.** Three independent §13 gaps, not one:

- **§13.2** ("claim one work item... before implementation"): no task-table
  row claims this change. T6's own row still reads "Primary files:
  `examples/website-pulse/`" (`v1-collaboration-spec.md`'s Task table diff for
  this change touches nothing about this — confirmed by reading the current
  table, reproduced in this review's background). P3, whose primary file this
  is, is `done`, closed, with its own review already resolved. There is no
  "P3F"-style row (compare `P7F`, added specifically to let a P7 fix land as
  its own claimed, reviewable unit) and no amendment to T6's row disclosing
  that it now also touches `packages/core/src/SequencerEngine.ts`.
- **§13.6** ("Update API docs, migration notes, and the API report in the
  same change as the public API modification"): `StepEventCause` is exported
  from `@vixeq/core` (`packages/core/src/index.ts:104`), so widening it from
  `"play" | "tick" | "seek" | "project-change"` to add `"loop"`
  (`types.ts:46`) is a public API addition. `git diff docs/api/core.md
  CHANGELOG.md docs/behavior/playback-v2-matrix.md docs/migrations` is
  **empty** — none of these were touched. The `playback-v2-matrix.md`'s
  `PB-EN-*` rows (`PB-EN-015`/`016`/`026`/`027` are its nearest neighbors,
  covering loop/shared-transport/attach semantics already) have no row for
  "Sequencer resumes step emission across a transport loop boundary" at all,
  covered or otherwise — this is a real, newly-guaranteed behavior with zero
  matrix representation.
- **Disclosure**: this review request's own "Changed Files"/"Known
  Limitations" sections (top of this file, authored by Codex) do not mention
  `packages/core` at all. Per §13.11's convention (established and followed
  by every T3–T5 review), the review file is supposed to be *the* record of
  what changed and why; a reviewer relying on it alone — as the collaboration
  protocol intends — would not learn that `@vixeq/core` changed underneath
  this task, let alone why.

**4. A related, smaller loose end surfaced by the same diff (not separately
blocking, folded in here):** `StepEventCause` is shared between
`SequencerEngine` and `ArrangementEngine` (`arrangement/types.ts:7` imports it
for `StepEvent.cause`; `ArrangementEngine.ts:655-704` uses it). `grep -n
'"loop"' packages/core/src/arrangement/ArrangementEngine.ts` returns no
match — `ArrangementEngine.handleTransportEvent`
(`ArrangementEngine.ts:421-531`) has the same "no explicit `loop` branch,
falls through to the generic catch-all" shape `SequencerEngine` had
pre-fix. Read `ArrangementEngine`'s `emitDueSteps`
(`ArrangementEngine.ts:628-...`) closely enough to confirm it is *not*
exposed to the identical failure mode — its re-emission guard compares a
`stepKey` (section+step identity) for equality rather than an ever-increasing
absolute counter for a `<=` bound, so a backward position jump from a loop
wrap naturally produces a *different* key and re-fires rather than being
permanently suppressed — so this is not a second instance of the same bug.
But the type surface now silently claims Arrangement `StepEvent`s can carry
`cause: "loop"` when `ArrangementEngine` never produces that value, which is
an inconsistency introduced by this same undisclosed change and not
mentioned anywhere. Low severity on its own (no incorrect behavior results,
just an achievable-but-never-achieved type state), but it is exactly the kind
of cross-cutting consequence that claiming the work item and writing it down
would have surfaced before merge, rather than after a reviewer went looking.

**Not a proposed fix for the SequencerEngine bug itself** — the fix in the
working tree is correct and should be kept; re-implementing it differently is
not warranted. What is missing is the paperwork the collaboration protocol
requires around it. **Before this task can be marked `done`, the following
need to happen, in the user's or Codex's judgment on how to split the work:**
(a) explicitly claim this change under a task-table row (amend T6's own row's
"Primary files" to disclose `packages/core/src/SequencerEngine.ts`, or add a
dedicated row mirroring `P7F`'s precedent for a P3-scoped fix landing after
P3 closed); (b) update `CHANGELOG.md`, `docs/api/core.md`'s `StepEventCause`-
adjacent text if any, and add or update a `playback-v2-matrix.md` `PB-EN-*`
row for "Sequencer resumes step emission across a transport loop boundary";
(c) record a decision on whether `ArrangementEngine` needs the equivalent
explicit `"loop"` handling (even if only to document that its different
`stepKey`-based guard already makes it unnecessary, per point 4 above) so the
shared `StepEventCause` type's `"loop"` member isn't silently
Sequencer-only in practice while claiming to be engine-agnostic in its type.

## Final verdict

**Changes requested — but not because of any defect in the files this task
actually declares.** Every item in the review request's own Review Focus is
verified correct: `App.tsx` and the internal `TimelineLayer` genuinely share
one `PlaybackTransport` between `useTimeline` and `SequencePlayer`; every
scrub/rate/loop control routes through `useTimeline`'s own returned API, never
touching the transport directly from the component; `brandTimelineProject`'s
8 beats at 120 BPM is exactly 4000 ms, matching a directly-measured 4.0000 s
`demo-loop.wav`; custom audio replacement flows through the same `transport`
React state that both `useTimeline` and `useSequencerEngine` already rebuild
against per their pre-existing (T5/P6) dependency arrays; `useAnimatedChannels`
is the only place `reducedMotion` gates anything, leaving `useTimeline`'s
discrete cues untouched by the media query, exactly as T5 established; and
the new `styles.css` rules are additive, scoped to new classes plus one
`color-mix` tweak, and were confirmed live (via `browser-use`, run
independently in this session, not reused from the author's own screenshot)
to render without overflow or collision with the hero/editor layout. All
declared and full-workspace commands (`typecheck`, `build`,
`@vixeq/core test`, `pnpm -r typecheck`, `pnpm -r test`) were independently
re-run and are green.

**However, B1 is a real problem with how this task was executed, not with
what it produced.** The working tree bundles an undisclosed change to
`packages/core/src/SequencerEngine.ts`/`.test.ts`/`types.ts` — files that
belong to P3, an already-`done`, already-reviewed task, and that are outside
T6's declared scope entirely. On inspection this change is a genuine,
correct fix for a real regression (`SequencerEngine` permanently stops
emitting `"step"` events, and therefore stops triggering
`useAnimatedChannels`' envelopes, after the first time any transport it is
attached to loops), and — this is what elevates it above a mere hygiene
note — **`website-pulse`'s own headline "full-show loop" feature drives
exactly this code path on the exact shared transport this task's Review
Focus asked about**, so shipping T6 without this fix would have shipped a
visibly broken flagship demo. That makes the fix itself worth keeping. But
it was added with no task-table claim (§13.2), no CHANGELOG/API-doc/behavior-
matrix update for the public `StepEventCause` addition it required (§13.6),
and no mention anywhere in this review request's Changed Files or Known
Limitations (§13.11's own disclosure convention) — three independent process
gaps around a change to already-shipped, already-approved core Engine code,
which is precisely the situation §13's claim-first/disclose-everything rules
exist to prevent. A secondary, lower-severity consequence surfaced by the
same undisclosed change: `ArrangementEngine`'s `StepEvent.cause` now
type-admits `"loop"` via the shared `StepEventCause` union even though
`ArrangementEngine` never produces it (verified not to share
`SequencerEngine`'s failure mode, by a different, key-equality-based
re-emission guard — so no behavioral bug results, just an unrecorded type/
behavior mismatch).

Recommend: keep the `SequencerEngine` fix as-is (it is correct and T6
depends on it), but before marking T6 `done`: explicitly claim it in the task
table (amending T6's own row or adding a dedicated fix row per the `P7F`
precedent), add the missing `CHANGELOG.md`/`docs/api/core.md`/
`docs/behavior/playback-v2-matrix.md` updates for the new `StepEventCause`
member and the newly-guaranteed loop-resume behavior, and record a decision
on `ArrangementEngine`'s now-inconsistent (but not incorrect) relationship to
the same shared type. Once those are in place, this task's own files —
`App.tsx`, `brandProject.ts`, `styles.css` — need no further changes on the
strength of this review.

## Paperwork resolution (by the user's decision, applied by Claude)

- **Task-table claim**: T6's row in `docs/plans/v1-collaboration-spec.md` now
  lists `packages/core/src/SequencerEngine.ts` alongside
  `examples/website-pulse/` in Primary files, with an inline note identifying
  it as "P3 loop-resume regression fix surfaced by this task" — amending T6's
  own row rather than adding a separate `P3F`-style row, per the user's
  choice.
- **`CHANGELOG.md`**: added a `### Fixed` entry under `Unreleased` describing
  the freeze/fix, and a `### Added` entry for the new `StepEventCause`
  `"loop"` member, including the note that `ArrangementEngine` shares the
  type but never produces `"loop"`.
- **`docs/api/core.md`**: added a bullet under Sequencing describing
  `StepEvent.cause`'s new `"loop"` value and its re-anchoring purpose.
- **`docs/behavior/playback-v2-matrix.md`**: added `PB-EN-029` ("attached
  transport wraps on a natural loop") as `covered`, and the existing
  regression test in `SequencerEngine.test.ts` now carries the `PB-EN-029` ID
  in its name per this repo's ID-in-test-name convention.
- **`ArrangementEngine` decision**: documented in place (a code comment at
  `ArrangementEngine.ts`'s `emitDueSteps` step-identity guard) explaining
  that its `stepKey`-equality-based re-emission guard already resumes
  correctly across a loop wrap without an explicit `"loop"` branch, unlike
  `SequencerEngine`'s absolute-counter-based guard — a decision to leave
  `ArrangementEngine` as-is, not a code change to its behavior.
- Re-ran `pnpm --filter @vixeq/core test`/`typecheck`: 270/270 tests pass
  (one more than this review's own count, from the `PB-EN-029` ID now in the
  existing regression test's name — no new test was added), clean typecheck.

## Re-review (fixes verification)

Independently re-verified each of the six paperwork items claimed above,
against the actual working tree, not against the "Paperwork resolution"
summary's own prose.

1. **Task-table claim.** `docs/plans/v1-collaboration-spec.md`'s Task table,
   T6 row, Primary files column now reads: `` `examples/website-pulse/`,
   `packages/core/src/SequencerEngine.ts` (P3 loop-resume regression fix
   surfaced by this task) ``. Confirmed by direct read of the current table
   (line 642) — the file, the inline note, and its attribution to P3 are all
   present exactly as described. (Per this task's own instructions, this
   check is verification-only; the task table itself was not further edited
   as part of this re-review, and its `in_progress` status was left
   untouched.)

2. **`CHANGELOG.md`.** The `Unreleased` section now has both a `### Fixed`
   entry (the `SequencerEngine` permanent-freeze-after-one-loop regression
   and its fix, explicitly naming the `website-pulse` full-show-loop feature
   as how it was discovered) and a `### Added` entry (`StepEventCause` gains
   `"loop"`, with an explicit note that `ArrangementEngine` shares the type
   but never produces `"loop"`, and why). Both entries are present, accurate,
   and match the content described in the Paperwork resolution section.

3. **`docs/api/core.md`.** The Sequencing section now includes: `` `StepEvent
   .cause` includes `"loop"`: when an attached transport wraps position on a
   natural loop, `SequencerEngine` emits one `"loop"`-caused step immediately
   at the wrapped position, re-anchoring step emission so it does not
   permanently stop after the first loop. `` — present and technically
   accurate (matches the actual `emitStepForPosition(...,"loop")` call in
   `SequencerEngine.ts`'s new branch).

4. **`docs/behavior/playback-v2-matrix.md`.** A new row, `PB-EN-029 |
   attached transport wraps on a natural loop | SequencerEngine emits one
   cause:"loop" step at the wrapped position and resumes ordinary
   tick-caused step emission afterward (does not permanently stop) |
   covered`, is present immediately after `PB-EN-026`–`PB-EN-028` (the
   nearest neighbors the original review pointed at as having no such row).
   Cross-checked `packages/core/src/SequencerEngine.test.ts:105`: the test
   itself — the same "resumes step emission across a transport loop
   boundary" regression test hand-traced in the original review's B1
   finding — now begins `it("PB-EN-029 resumes step emission across a
   transport loop boundary (regression: effects freeze while audio
   loops)", ...)`, i.e. the matrix ID is embedded in the test name per this
   repo's established convention (confirmed against neighboring tests in the
   same file, e.g. `PB-EN-001`, `PB-EN-027`, `PB-EN-028`, which follow the
   identical `it("PB-EN-0NN <description>", ...)` pattern). No new test was
   added; the existing regression test was renamed to carry the ID, matching
   the Paperwork resolution's own description.

5. **`ArrangementEngine` decision documentation.** `ArrangementEngine.ts`'s
   `emitDueSteps` (`packages/core/src/arrangement/ArrangementEngine.ts:628-644`)
   now carries a comment directly above its `stepKey` equality guard
   explaining that, unlike `SequencerEngine`'s ever-increasing absolute-step
   counter, this guard compares section+step identity, so a transport loop
   wrap naturally produces a different `stepKey` and re-emission resumes on
   its own — `"ArrangementEngine does not need (and does not implement) a
   'loop'-caused step."` This is a comment-only change: re-ran `grep -n
   '"loop"' packages/core/src/arrangement/ArrangementEngine.ts` and it still
   returns no match outside comments — `ArrangementEngine.handleTransportEvent`
   has no `"loop"` branch and `emitDueSteps`'s guard logic (the `stepKey`
   comparison itself, lines 641-644) is byte-for-byte the pre-existing logic
   with only the comment inserted above it. `ArrangementEngine`'s actual
   behavior (never producing `cause: "loop"`) is unchanged, exactly as
   intended for a decision record rather than a behavior change.

6. **Command re-run, all green:**
   - `pnpm --filter @vixeq/core test` — **19 files, 270/270 tests pass.**
   - `pnpm --filter @vixeq/core typecheck` — clean, no output.
   - `pnpm --filter @vixeq/core build` — `tsup` ESM+CJS+DTS build succeeds,
     no errors.
   - `pnpm -r --no-bail typecheck` (root `typecheck` script is `pnpm -r
     typecheck`; ran directly) — all 10 workspace projects report `Done`,
     including `examples/website-pulse typecheck: Done`.
   - `pnpm --filter vixeq-example-website-pulse typecheck` — clean, no
     output; confirms T6's own example files are unaffected by the
     paperwork changes (none of the paperwork changes touch
     `examples/website-pulse/`).

**Conclusion: B1 is resolved.** All three §13 gaps identified in the
original review — no task-table claim, no CHANGELOG/API-doc/behavior-matrix
update for the public `StepEventCause` addition, no disclosure — now have
matching, verified artifacts in the working tree, and the `ArrangementEngine`
inconsistency noted as a secondary, lower-severity item has been recorded as
an explicit decision (not silently left open) without altering
`ArrangementEngine`'s actual behavior. All previously-green commands remain
green, plus the fix's own regression test (now `PB-EN-029`-tagged) still
passes. No new issues were found during this re-review.

**Status: approved.**
