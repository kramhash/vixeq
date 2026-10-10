# RC1G Engine re-entrancy guards — handoff brief and review

- Status: review_requested (round 5: E1–E3 fixed, see
  [Round 5 fix](#round-5-fix-e1-e2-e3))
- Author: Claude (Opus 5.5)
- Reviewer: round 1 `critic` (Fable), adversarial review, changes_requested;
  findings independently reproduced by the main session (Claude Opus 5.5),
  2026-10-10. See [Review](#review). Round 2: `critic` (Fable),
  changes_requested (C1 only); C1 reproduced by the main session. Round 3:
  `critic` (Fable), changes_requested (D1; D2/D3 low); D1 reproduced by the
  main session. Round 4: `critic` (Fable), changes_requested (E1–E3, all
  low); E1 reproduced by the main session, E3 confirmed by reading.
- Origin: adversarial `critic` review of the RC1B–RC1D production changes
  (`d2141e7..dffec0d`), 2026-10-10. All four findings below were reproduced
  independently by the main session. They also reproduce on `d2141e7` (before
  RC1B–RC1D), so they are pre-existing gaps that the RC1C/RC1D re-entrancy
  guards did not cover, not regressions from those changes.
- Scope: make catch-up dispatch in `TimelineEngine` and `ArrangementEngine`
  stop as soon as a listener re-entrantly resets dispatch state (seek, stop,
  pause, `setProject` / `setArrangement`, `setLoop`, dispose). Blocks
  `1.0.0-rc.1` (RC2 depends on RC1G).

## Ground rules for the implementer

- Read `AGENTS.md` and `docs/plans/v1-collaboration-spec.md` first. Claim the
  RC1G row (`in_progress`, owner) before editing code.
- The fix must move behavior toward rules the docs already state
  (`docs/behavior/timeline-arrangement-v2.md`: non-retroactive hot-swap,
  local-end, explicit seek dispatches zero passed cues). If any fix would need
  a behavior that the docs do not state, stop and ask (spec rule 10).
- No public API change: `pnpm api:check` must report no diff.
- Tests go through public APIs only (spec §10). The `ManualTransport` helper
  already in each Engine test file is a public `PlaybackTransport`
  implementation and is fine to reuse.
- Critical files stay at 100% branch coverage (`pnpm test:coverage`); no new
  exclusions or threshold changes. Any guard that is truly unreachable must be
  removed rather than excluded.
- Lesson from RC1B: before deleting a branch as "unreachable", check it under
  listener re-entrancy (a listener may synchronously dispose a shared
  transport, dispose the Engine, hot-swap, `setLoop`, seek, play/pause).

## Findings

Line numbers are as of `dffec0d`.

### F1 (medium-high) — Timeline local-end tick ignores a re-entrant `setProject` / `setLoop`

- Where: `packages/core/src/timeline/TimelineEngine.ts:552-558` (`tick()`, the
  `isAtOrPastLocalEnd` branch).
- Cause: the branch calls `emitDueCues(getDurationMs())` and then
  unconditionally writes `cachedPositionMs = getDurationMs()`,
  `lastDispatchedRawPositionMs = getDurationMs()`, `playbackState = "ended"`
  and emits `ended`. A cue listener that called `setProject()` or
  `setLoop(true)` is overridden, and `getDurationMs()` now reads the *new*
  project, so the position jumps too.
- Repro (clock transport, `lookaheadMs: 10`): project A = 2 beats with cue
  `last@1.5`; project B = 8 beats with cue `b-cue@3`. The `cue` listener calls
  `engine.setProject(B)` on `last`. Play, advance the clock 2.2 s.
  - Observed: state `ended`, position `{ positionMs: 8000, beat: 8 }`,
    playback `["play:0", "ended:8000"]`; `b-cue` never fires.
  - Expected: playback continues on B at beat 2.2 (B is longer than the
    current beat, so the non-loop "move to end and end" rule does not apply).
- Variant: the listener calls `engine.setLoop(true)` instead. Observed: state
  `ended` at 2000 ms and one leaked timer (`vi.getTimerCount() === 1`; the
  tick that `setLoop` scheduled returns immediately because the state is
  `ended`). Expected: looping continues.
- Not affected: `ArrangementEngine`'s equivalent branch sets
  `playbackState = "ended"` before emitting, and `emitDueSteps(duration)`
  resolves no step at exactly the duration, so a `setArrangement` in a
  section/playback listener recovers through the ended → playing path. The
  Arrangement variant of this repro ends at 2000 ms with only `play:0`, which
  is correct.

### F2 (medium) — synchronous re-entrant seek during catch-up replays the skipped range

- Where: `TimelineEngine.ts:676` (guard inside `emitDueCuesForIteration`) and
  `ArrangementEngine.ts:665` (guard inside `emitDueSteps`).
- Cause: the guards compare only `disposed` / project / loop. A seek handler
  resets `lastDispatchedRawPositionMs` (Timeline) or
  `lastEmittedScheduledPositionMs` (Arrangement), but the loop keeps going and
  then overwrites that state with the pre-seek position
  (`lastDispatchedRawPositionMs = toRawPositionMs` at the end of
  `emitDueCues`; `emitStepResolution` for the remaining due steps).
- Only reachable with a transport that emits `seek` synchronously inside
  `seekMs()` (the test files' `ManualTransport`, or any third-party
  `PlaybackTransport`). The built-in clock/media transports enqueue events
  asynchronously and do not reproduce it. `PlaybackTransport` is public, so
  this is in scope.
- Repro, Timeline: cues `one@1, two@2, three@3, four@4`; the `one` listener
  calls `engine.seekPositionMs(3500)`. Transport at 2.5 s → tick → observed
  `[one, two]` (`two` is dispatched after the seek). Transport at 3.6 s → tick
  → observed `three@3600` as well. Expected: an explicit seek dispatches zero
  passed cues, so neither `two` nor `three`.
- Repro, Arrangement: 8 steps over 8 beats; the step-1 tick listener calls
  `engine.seekPositionMs(5500)`. Tick 1 observed
  `[play:0, tick:1, seek:5, tick:2]`; tick 2 adds `tick:3, tick:4, tick:5`
  (the seeked-over range is replayed and step 5 fires twice). Expected: after
  `tick:1`, only `seek:5`.

### F3 (low-medium) — Timeline `emitCurrentCues` has no re-entrancy guard

- Where: `TimelineEngine.ts:566-582`.
- Repro: project A has cues `a1@0, a2@0`; project B has `b1@0`. The `a1`
  listener calls `engine.setProject(B)`. `play()` → observed `[a1, a2]`
  (`a2` belongs to the replaced project). Expected: `[a1]`.
- The trailing `lastDispatchedRawPositionMs = rawPositionMs` also overwrites
  the value `setProject` just computed (harmless at play start, where it is 0,
  but wrong in general).
- Doc impact: the third Unreleased "Fixed" entry in `CHANGELOG.md` ("cues
  from the replaced data are not dispatched") is only true for the
  `emitDueCues` path today. Fix F3, then keep or adjust the wording.

### F4 (low) — Arrangement emits a `tick` step after `ended` when a listener calls `setLoop(false)`

- Where: `ArrangementEngine.ts:665` (same guard as F2).
- Repro: `loop: true`, 4 steps over 4 beats, clock transport. Advance to 4.2 s
  (wraps, emits step 0 of the second iteration), then advance 2.3 s more (due:
  steps 1 and 2). The step-1 listener calls `engine.setLoop(false)`. Observed
  `[..., step:tick:1, pb:loopchange, pb:ended, step:tick:2]`, state `ended`.
  Expected: no step after `ended`.
- The Timeline guard already compares `localLoop`; the Arrangement guard does
  not.

## Recommended fix

Introduce a private dispatch generation counter in both Engines (Sequencer
only if a matching gap is found there):

1. Every path that resets or replaces dispatch state increments it: transport
   `seek` / `stop` / `pause` / `ended` / dispose handlers, `setProject` /
   `setArrangement`, `setLoop`, the Engine's `dispose()`, and the
   ended → playing restart.
2. `emitCurrentCues`, `emitDueCues` / `emitDueCuesForIteration`,
   `emitDueSteps`, and the Timeline local-end branch in `tick()` capture the
   generation before emitting and compare it after every listener dispatch. If
   it changed, return immediately without writing `cachedPositionMs`,
   `lastDispatchedRawPositionMs`, `lastEmittedScheduledPositionMs`, or
   `playbackState`. The re-entrant command has already set those and
   rescheduled.
3. This replaces the per-field `project !== project || localLoop !== localLoop`
   / `arrangement !== arrangement` comparisons added in RC1C/RC1D, so all four
   findings are closed by one mechanism.

Alternatives considered:

- Add `localLoop` to the Arrangement guard plus a snapshot check in F1/F3.
  This closes F1, F3, and F4 but not F2.
- Re-evaluate `isAtOrPastLocalEnd` after `emitDueCues` in F1. This is narrower
  and still misses F2/F3.

Also check: whether `SequencerEngine`'s tick path has the same "listener seeks
synchronously mid-dispatch" gap. The critic did not test it.

## Repro tests

The `critic` repro file, adjusted to relative imports. Drop it at
`packages/core/src/__rc1g_repro.test.ts` to observe the current behavior (it
only logs, it does not assert), then turn each case into an asserting test in
the matching `*.test.ts` file, using its `describe("RC1G re-entrancy ...")`
block and its `ManualTransport` helper. Delete the scratch file afterwards.

```ts
import { afterEach, describe, it, vi } from "vitest";
import {
  createClockTransport,
  type PlaybackSnapshot,
  type PlaybackTransport,
  type PlaybackTransportEvent,
} from "./playbackTransport";
import type { PlaybackClock, StepEvent } from "./types";
import { TimelineEngine } from "./timeline/TimelineEngine";
import { createTimelineProject } from "./timeline/index";
import type { TimelineCueEvent, TimelineEvent, TimelineProject, TimelinePlaybackEvent } from "./timeline/types";
import { ArrangementEngine } from "./arrangement/ArrangementEngine";
import { createArrangement } from "./arrangement/project";
import { createProject } from "./project";

class FakeClock implements PlaybackClock {
  currentTime = 0;
  private nextTimerId = 1;
  private timers: Array<{ id: number; dueAt: number; callback: () => void }> = [];
  now(): number { return this.currentTime; }
  setTimer(callback: () => void, delayMs: number): unknown {
    const id = this.nextTimerId++;
    this.timers.push({ id, dueAt: this.currentTime + delayMs, callback });
    return id;
  }
  clearTimer(timerId: unknown): void { this.timers = this.timers.filter((t) => t.id !== timerId); }
  advance(ms: number): void {
    const target = this.currentTime + ms;
    while (true) {
      this.timers.sort((a, b) => a.dueAt - b.dueAt);
      const t = this.timers[0];
      if (!t || t.dueAt > target) break;
      this.timers.shift();
      this.currentTime = t.dueAt;
      t.callback();
    }
    this.currentTime = target;
  }
}

class ManualTransport implements PlaybackTransport {
  snapshot: PlaybackSnapshot = { state: "stopped", positionMs: 0, durationMs: null, playbackRate: 1, loop: false, buffering: false };
  private listeners = new Set<(event: PlaybackTransportEvent) => void>();
  emitEvent(event: PlaybackTransportEvent): void {
    this.snapshot = { ...event.snapshot };
    for (const l of [...this.listeners]) l(event);
  }
  getSnapshot() { return { ...this.snapshot }; }
  getPlaybackState() { return this.snapshot.state; }
  getPositionMs() { return this.snapshot.positionMs; }
  getDurationMs() { return this.snapshot.durationMs; }
  getPlaybackRate() { return this.snapshot.playbackRate; }
  getLoop() { return this.snapshot.loop; }
  async play() { this.emitEvent({ type: "play", snapshot: { ...this.snapshot, state: "playing" } }); }
  async pause() {}
  async stop() {}
  async seekMs(positionMs: number) {
    const state = this.snapshot.state === "playing" ? "playing" : "paused";
    this.emitEvent({ type: "seek", previousPositionMs: this.snapshot.positionMs, snapshot: { ...this.snapshot, state, positionMs } });
  }
  async setPlaybackRate() {}
  async setLoop() {}
  subscribe(l: (e: PlaybackTransportEvent) => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  dispose() {}
}

const BEAT_MS = 1000;
const proj = (durationBeats: number, events: Array<Pick<TimelineEvent, "id" | "beat" | "type">>): TimelineProject =>
  createTimelineProject({ timing: { bpm: 60 }, durationBeats, events: events.map((e) => ({ ...e, trackId: null })) });
const tickEngine = async (clock: FakeClock, ms: number, lookaheadMs = 10) => { clock.advance(ms); await vi.advanceTimersByTimeAsync(lookaheadMs); };

afterEach(() => vi.useRealTimers());

describe("F1: local-end tick + re-entrant setProject/setLoop", () => {
  it("timeline: listener on last cue loads a longer project", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const a = proj(2, [{ id: "last", beat: 1.5, type: "cue" }]);
    const b = proj(8, [{ id: "b-cue", beat: 3, type: "cue" }]);
    const engine = new TimelineEngine(a, { transport, lookaheadMs: 10 });
    const playback: TimelinePlaybackEvent[] = [];
    const cues: TimelineCueEvent[] = [];
    engine.on("playback", (e) => playback.push(e));
    engine.on("cue", (e) => { cues.push(e); if (e.event.id === "last") engine.setProject(b); });
    await engine.play();
    await tickEngine(clock, BEAT_MS * 2.2);
    console.log("F1-timeline", engine.getPlaybackState(), engine.getPosition(), playback.map((p) => `${p.type}:${p.snapshot.positionMs}`));
    await tickEngine(clock, BEAT_MS * 1);
    console.log("F1-timeline cues", cues.map((c) => c.event.id), engine.getPlaybackState(), engine.getPosition());
  });

  it("timeline: listener on last cue enables loop", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const a = proj(2, [{ id: "last", beat: 1.5, type: "cue" }]);
    const engine = new TimelineEngine(a, { transport, lookaheadMs: 10 });
    engine.on("cue", (e) => { if (e.event.id === "last") engine.setLoop(true); });
    await engine.play();
    await tickEngine(clock, BEAT_MS * 2.2);
    console.log("F1-timeline-loop", engine.getPlaybackState(), engine.getPosition(), vi.getTimerCount());
  });

  it("arrangement (control, behaves correctly): final-step listener loads a longer arrangement", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const pat = createProject({ stepCount: 2, stepsPerBeat: 1, trackCount: 1 });
    const a = createArrangement({ timing: { bpm: 60 }, durationBeats: 2, patterns: { p: pat }, sections: [{ id: "s", patternId: "p", startBeat: 0, endBeat: 2 }] });
    const b = createArrangement({ timing: { bpm: 60 }, durationBeats: 8, patterns: { p: pat }, sections: [{ id: "s", patternId: "p", startBeat: 0, endBeat: 8 }] });
    const engine = new ArrangementEngine(a, { transport, lookaheadMs: 10 });
    const steps: StepEvent[] = [];
    engine.on("step", (e) => { steps.push(e); if (e.cause === "tick" && e.stepIndex === 1 && engine.getArrangement() === a) engine.setArrangement(b); });
    await engine.play();
    await tickEngine(clock, BEAT_MS * 2.2);
    console.log("F1-arr", engine.getPlaybackState(), engine.getPosition(), steps.map((s) => `${s.cause}:${s.stepIndex}`));
  });
});

describe("F3: emitCurrentCues re-entrancy", () => {
  it("stale same-beat cue still dispatched after setProject in cue listener at play", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const a = proj(4, [{ id: "a1", beat: 0, type: "cue" }, { id: "a2", beat: 0, type: "cue" }]);
    const b = proj(4, [{ id: "b1", beat: 0, type: "cue" }]);
    const engine = new TimelineEngine(a, { transport, lookaheadMs: 10 });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (e) => { cues.push(e); if (e.event.id === "a1") engine.setProject(b); });
    await engine.play();
    console.log("F3", cues.map((c) => c.event.id), engine.getProject() === b);
  });
});

describe("F2: re-entrant synchronous seek during catch-up", () => {
  it("timeline: cue skipped by forward seek is dispatched on next tick", async () => {
    vi.useFakeTimers();
    const transport = new ManualTransport();
    const a = proj(6, [{ id: "one", beat: 1, type: "cue" }, { id: "two", beat: 2, type: "cue" }, { id: "three", beat: 3, type: "cue" }, { id: "four", beat: 4, type: "cue" }]);
    const engine = new TimelineEngine(a, { transport, lookaheadMs: 10 });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (e) => { cues.push(e); if (e.event.id === "one") void engine.seekPositionMs(BEAT_MS * 3.5); });
    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.5 };
    await vi.advanceTimersByTimeAsync(10);
    console.log("F2-timeline after tick1", cues.map((c) => c.event.id), transport.getPositionMs());
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 3.6 };
    await vi.advanceTimersByTimeAsync(10);
    console.log("F2-timeline after tick2", cues.map((c) => `${c.event.id}@${c.transportPositionMs}`));
  });

  it("arrangement: steps skipped by forward seek replayed", async () => {
    vi.useFakeTimers();
    const transport = new ManualTransport();
    const pat = createProject({ stepCount: 8, stepsPerBeat: 1, trackCount: 1 });
    const a = createArrangement({ timing: { bpm: 60 }, durationBeats: 8, patterns: { p: pat }, sections: [{ id: "s", patternId: "p", startBeat: 0, endBeat: 8 }] });
    const engine = new ArrangementEngine(a, { transport, lookaheadMs: 10 });
    const steps: StepEvent[] = [];
    engine.on("step", (e) => { steps.push(e); if (e.cause === "tick" && e.stepIndex === 1) void engine.seekPositionMs(BEAT_MS * 5.5); });
    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.5 };
    await vi.advanceTimersByTimeAsync(10);
    console.log("F2-arr tick1", steps.map((s) => `${s.cause}:${s.stepIndex}`));
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 5.6 };
    await vi.advanceTimersByTimeAsync(10);
    console.log("F2-arr tick2", steps.map((s) => `${s.cause}:${s.stepIndex}`));
  });
});

describe("F4: arrangement setLoop(false) in step listener during catch-up", () => {
  it("emits tick steps after ended", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const pat = createProject({ stepCount: 4, stepsPerBeat: 1, trackCount: 1 });
    const a = createArrangement({ timing: { bpm: 60 }, durationBeats: 4, patterns: { p: pat }, sections: [{ id: "s", patternId: "p", startBeat: 0, endBeat: 4 }] });
    const engine = new ArrangementEngine(a, { transport, lookaheadMs: 10, loop: true });
    const log: string[] = [];
    engine.on("playback", (e) => log.push(`pb:${e.type}`));
    engine.on("step", (e) => { log.push(`step:${e.cause}:${e.stepIndex}`); if (e.cause === "tick" && e.stepIndex === 1 && e.scheduledPositionMs === BEAT_MS) engine.setLoop(false); });
    await engine.play();
    // Wrap to 4.2 s (step 0 of the 2nd iteration), then advance to 6.5 s (due: steps 1, 2).
    await tickEngine(clock, BEAT_MS * 4.2);
    log.push("--");
    await tickEngine(clock, BEAT_MS * 2.3);
    console.log("F4", log, engine.getPlaybackState());
  });
});
```

## Already verified sound (do not re-investigate)

- Removing the `?.` / `??` fallbacks on `result.errors[0]`: the validators
  always push at least one error when `ok` is false.
- Removing `track.steps[idx] ?? 0`: validation enforces
  `steps.length === stepCount` with `minStepCount: 1`, and `stepIndex` is
  always taken `% stepCount`. Every Engine entry point validates.
  (`resolve.ts:111-112` still has a `?? 0`; this is inconsistent but not a
  bug.)
- Removing the `transportDisposed ? 1 : getPlaybackRate()` ternary in
  Sequencer: the early return just before it already excludes that case.
- Removing the inverted-range early return in `emitDueCuesForIteration`:
  unreachable for both non-loop and loop ranges.
- Constructors calling `rescheduleIfPlaying()`: the condition is equivalent to
  the old code.
- `disposedTransportPositionMs` (Arrangement/Timeline): consistent across
  dispose → `setProject` → `setLoop`, with or without an anchor, and while
  buffering or ended. After dispose there is no seek or re-attach path, so the
  value cannot go stale. Sequencer does not need it.
- The Timeline early return that leaves `lastDispatchedRawPositionMs`
  untouched: `setProject` / `setLoop` write it on the new anchor, so there is
  no double dispatch or missed cue.
- CHANGELOG Unreleased "Fixed" entries 1 and 2 are accurate. Entry 3 is
  covered by F3 above.
- RC1B–RC1D tests go through public APIs only; no private fields are read.

## Definition of done

1. Each of F1–F4 has an asserting test that fails on `dffec0d` and passes with
   the fix (verify by reverting the production change once).
2. Run `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:coverage` (all
   critical files at 100% branches), `pnpm api:check` (no diff), and
   `pnpm behavior:check`.
3. `CHANGELOG.md` Unreleased "Fixed" describes the new guarantees accurately.
4. Fill in "Changed files / Commands run / Results" below, set `Status:
   review_requested`, and hand off for independent review. The re-entrancy
   class has already produced one regression (RC1B), so an adversarial review
   is recommended.
5. Mark RC1G `done` in the task table only after review approval.

## Implementation notes

The recommended fix was implemented as written: each Engine has a private
`dispatchGeneration` counter. No public API changed.

- Bumped by (round 2: `pause` no longer bumps, see R1 below): transport
  `seek` / `stop` / `ended` / `dispose`, `play`
  from `stopped` / `ended` (including the ended replay) and `play` that lands
  at local end, `setProject` / `setArrangement`, `setLoop` (Timeline,
  Arrangement), the transport `loop` event (Sequencer), and `dispose()`.
  `ratechange`, `bufferingchange`, `error`, and a redundant `play` do not bump:
  they do not move the dispatch cursor, so abandoning a batch there would
  re-dispatch the part already sent.
- Checked by: Timeline `emitCurrentCues`, `emitDueCues`,
  `emitDueCuesForIteration`, and the local-end branch of `tick()`;
  Arrangement `emitDueSteps` and `tick()`; Sequencer `emitDueSteps`. The
  RC1C/RC1D per-field comparisons (`project` / `localLoop` /
  `arrangement` / `disposed`) are replaced.
- The normal (not local-end) tick path still calls `scheduleNextTick()` after
  an abandoned batch. That call is idempotent for every re-anchored state, and
  keeping it keeps `scheduleNextTick()`'s own state guard reachable (RC1B
  lesson); no branch was removed or excluded.

### Findings beyond the brief

- F5 (Sequencer, medium) — the brief asked to check Sequencer. Its catch-up
  loop had no re-entrancy check at all: a step listener that seeks
  synchronously got the seeked-over steps replayed after the `seek` step.
  Fixed by the same counter; test "SequencerEngine — RC1G re-entrancy".
- F6 (Arrangement, medium) — a `"section"` listener that seeks synchronously
  in a tick was followed by a stale `"tick"` step for the pre-seek position.
  `tick()` now returns when the generation changed after the section
  emission.
- F7 (Arrangement, low-medium) — the brief's "Not affected" note on the
  Arrangement local-end branch holds for step listeners, but a `"section"`
  listener at local end that loads a longer arrangement got a
  `"playback"` `ended` event whose snapshot said `playing`, while the Engine
  kept playing. `tick()` now emits `ended` only while the Engine is still
  `ended` (a same-or-shorter swap still announces `ended` once).

### Deviation from the brief's expected values

- F1: the brief expected playback to continue "at beat 2.2". It continues at
  beat 2. The project A logical position is clamped to its end (beat 2) when
  the listener runs, and the existing hot-swap rule preserves that logical
  beat; the transport's 2.2 s is not a project-A position. The test asserts
  `{ positionMs: 2000, beat: 2 }` and that `b-cue@3` fires one beat later.

### Out of scope, decision needed (not changed)

- O1: `ArrangementEngine` catch-up does not cross a local loop wrap, a gap, or
  local end. `getDueStepResolutions()` works on normalized positions, so after
  a wrap it returns nothing; `emitDueSteps()` returns early when the tick
  lands in a gap or at the end (`resolveAtPosition()` is `null`). In the F4
  repro, advancing 4.2 beats with `loop: true` emits no step for the wrapped
  range under `missedStepPolicy: "emit"`, and the local-end
  `emitDueSteps(duration)` call never emits. Correction (after measuring):
  the docs do state the intent — spec §3.4/§3.6 apply `missedStepPolicy` to
  natural delays, `PB-EN-008` says "every crossed step emitted in order"
  (tested on Sequencer only), the Timeline doc says `missedCuePolicy` mirrors
  Arrangement, and `playback-v2.md` says section events follow the same
  delayed-callback rules. So this is a deviation, not a gap. What the docs do
  not state is the `scheduledPositionMs` of a step from a previous loop
  iteration and the section/step order during catch-up; those need a decision
  before it can be fixed. Decided 2026-10-10 and split out as RC1H
  (`docs/reviews/rc1h-arrangement-catch-up-claude.md`).
- O2: the play and seek handlers emit `"playback"`, then `"section"` (Arrangement),
  then the destination step/cues in sequence without a generation check; a
  listener that re-enters between them can get a duplicate destination
  step. This is not catch-up dispatch and was left out of RC1G.

## Review focus

The change is uncommitted on top of `dffec0d`; review
`git diff dffec0d -- packages/core CHANGELOG.md`. Try to break these claims:

1. Bump completeness: every path that moves or ends the dispatch cursor bumps
   `dispatchGeneration` (each `handleTransportEvent` branch, hot-swap,
   `setLoop`, `dispose()`, transport dispose, Sequencer `loop` event). A
   missing bump lets a stale batch continue.
2. No over-bumping: no path bumps without moving the cursor. An abandoned
   batch does not advance the cursor, so an over-bump re-dispatches what was
   already sent. Check `ratechange`, `bufferingchange`, `error`, redundant
   `play`, and Arrangement `setLoop` / `pause`, which do not rewrite
   `lastEmittedScheduledPositionMs` (the remaining due steps are sent on the
   next tick instead; is that a duplicate or a loss anywhere?).
3. After an abandoned batch, the next tick neither replays nor skips anything
   the docs require, for each re-entrant command (seek, stop, pause, hot-swap
   longer/shorter, `setLoop` both ways, Engine dispose, transport dispose),
   in loop and non-loop modes, with `missedCuePolicy` / `missedStepPolicy`
   `"emit"` and `"skip"`.
4. F7: `tick()` emits local `ended` only while `playbackState === "ended"`.
   Check Engine dispose, transport dispose, `setLoop(true)`, and stop from a
   section listener at local end.
5. The normal tick path still calls `scheduleNextTick()` after an abandoned
   batch (kept so its state guard stays reachable). Is that ever wrong, beyond
   the pre-existing harmless timer after an Engine dispose?
6. The F1 deviation (beat 2, not 2.2) and the O1/O2 out-of-scope calls: agree
   or show a documented rule they violate.
7. Tests use public APIs only, would fail without the fix, and the
   `ManualTransport.seekMs()` helper change does not alter the meaning of
   existing tests. The `CHANGELOG.md` entry claims nothing the code does not
   do.

## Changed files

- `packages/core/src/timeline/TimelineEngine.ts` — counter, bumps, guards in
  `emitCurrentCues` / `emitDueCues` / `emitDueCuesForIteration` / local end.
- `packages/core/src/arrangement/ArrangementEngine.ts` — counter, bumps,
  guards in `emitDueSteps` and `tick()` (F6, F7).
- `packages/core/src/SequencerEngine.ts` — counter, bumps, guard in
  `emitDueSteps` (F5).
- `packages/core/src/timeline/TimelineEngine.test.ts` — "TimelineEngine —
  RC1G re-entrancy" (F1 setProject, F1 setLoop, F2, F3).
- `packages/core/src/arrangement/ArrangementEngine.test.ts` —
  "ArrangementEngine — RC1G re-entrancy" (F2, F6, F4, F7); `ManualTransport`
  test helper's `seekMs()` now emits `seek` synchronously like the Timeline
  helper (no existing test seeked through it).
- `packages/core/src/SequencerEngine.test.ts` — "SequencerEngine — RC1G
  re-entrancy" (F5); same `ManualTransport.seekMs()` change.
- `CHANGELOG.md` — Unreleased "Fixed": the third entry replaced by one entry
  covering all three Engines.
- `docs/plans/v1-collaboration-spec.md` — RC1G row claimed; Sequencer added to
  its primary files.
- The scratch `packages/core/src/__rc1g_repro.test.ts` was used and deleted.

## Commands run

- `pnpm vitest run src/__rc1g_repro.test.ts` (in `packages/core`) on
  `dffec0d` and after the fix.
- Fail-before check: production files reset to `HEAD` (`dffec0d`) with the new
  tests in place, then
  `pnpm vitest run src/SequencerEngine.test.ts src/timeline/TimelineEngine.test.ts src/arrangement/ArrangementEngine.test.ts`
  — run twice (before and after the test-helper change).
- `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:coverage`,
  `pnpm api:check`, `pnpm behavior:check` (repository root).

## Results

- Repro on `dffec0d` matched the brief for F1–F4 (F4: the 4.2-beat advance
  emits no step, see O1, and the bug still reproduces on the next tick).
- Fail-before: 9 failed / 130 passed on `dffec0d` production code (all 9 RC1G
  tests fail); 139 passed with the fix.
- All six gates exit 0. Tests: core 407, react 36, player-react 8,
  playground 11, cycling-workout example 5. `SequencerEngine.ts`,
  `ArrangementEngine.ts`, `TimelineEngine.ts`: 100% statements / branches /
  functions / lines, no new exclusions or threshold changes. `api:check`: no
  report diff and no warnings. Behavior matrix: 191 covered.
- Not run: browser E2E and pack smoke (no packaging or browser-facing change).

## Review

- Date: 2026-10-10
- Reviewer: `critic` (Fable), adversarial review of
  `git diff dffec0d -- packages/core CHANGELOG.md` against the seven
  "Review focus" items. Each finding below was then reproduced independently
  by the main session, on the working tree and on a copy of the `dffec0d`
  `TimelineEngine.ts`, with the same input sequence.
- Verdict: **changes_requested**. Two regressions in `TimelineEngine`, both
  caused by the new `dispatchGeneration` bump in the transport `pause`
  handler. Arrangement and Sequencer are not affected.
- All scratch files (`__rc1g_critic*.test.ts`, `__rc1g_verify*.test.ts`,
  `timeline/__old_TimelineEngine.ts`) were deleted; `git status` shows only
  the pre-existing RC1G changes.

Both findings need a `PlaybackTransport` that emits `pause` synchronously
inside `pause()`. The built-in clock and media transports enqueue events and
do not reach them. This is the same reachability class as F2, which this
brief puts in scope because `PlaybackTransport` is public.

Repro harness: the brief's `ManualTransport`, with
`async pause() { this.emitEvent({ type: "pause", snapshot: { ...this.snapshot, state: "paused" } }); }`.
`lookaheadMs: 10`, bpm 60 (1 beat = 1000 ms), "tick" =
set `transport.snapshot.positionMs`, then `vi.advanceTimersByTimeAsync(10)`.

### R1 (medium) — Timeline: a cue listener that pauses synchronously loses the rest of the batch permanently

- Where: `packages/core/src/timeline/TimelineEngine.ts:418-423` (`pause`
  branch of `handleTransportEvent`).
- Cause: the branch now bumps `dispatchGeneration`, which abandons the
  running batch. It also still moves the cursor to the pause position
  (`lastDispatchedRawPositionMs = rawPositionFromTransportPosition(...)`).
  Together, the abandoned cues count as already dispatched and are never
  sent. Arrangement and Sequencer `pause` do not move their cursor, so the
  remaining steps go out on the first tick after resume (critic verified:
  `tick:2` appears after resume).
- Repro: 6-beat project, cues `one@1`, `two@2`, `three@3`. The `cue` listener
  calls `void engine.pause()` on `one`. `play()` → tick at 2500 →
  `engine.play()` → tick at 2600 → tick at 3100.
  - Observed (working tree): cues `["one@2500", "three@3100"]`, playback
    `["play@0", "pause@2500", "play@2500"]`. `two` is never dispatched.
  - On `dffec0d`: cues `["one@2500", "two@2500", "three@3100"]`.
- Expected: `two` is dispatched exactly once. Consistent with the RC1G
  mechanism and with Arrangement/Sequencer, that happens on the first tick
  after resume. Rule: `docs/behavior/timeline-arrangement-v2.md` §3,
  `missedCuePolicy: "emit"` ("every event between the previous and current
  tick position dispatches"). Only an explicit seek dispatches zero passed
  cues; pause is not a seek, and `playback-v2.md` §3.3 (pause/replay
  re-anchors from the frozen logical position) does not drop cues either.
- Related pre-existing defect (outside the diff, same line): with the
  built-in clock transport and no re-entrancy, a cue between the last tick
  and the pause position is also lost. Repro: cue `c@2.493`; tick at
  2490 ms; `engine.pause()` at 2495 ms; `play()`; ticks at 2600 and 2700 →
  observed cues `[]`. Leaving the cursor alone on pause, as Arrangement and
  Sequencer do, would close R1 and this case together. Whether the
  pre-existing case belongs in RC1G is the author's call.

### R2 (low-medium) — Timeline: a cue listener that pauses synchronously during the local-end tick suppresses `ended`

- Where: `packages/core/src/timeline/TimelineEngine.ts:568-579` (`tick()`,
  local-end branch, `if (!this.emitDueCues(this.getDurationMs())) return;`).
- Cause: inside the pause handler, `applyTransportSnapshot` sets
  `playbackState = "ended"` because the position is at or past local end,
  but the handler emits only `pause`. The tick then sees the changed
  generation and returns, so nobody emits the local `ended`. Arrangement
  sets `ended` before it emits and then emits `ended` while the state is
  still `ended` (F7 guard). The critic verified that it emits
  `ended:local-end:playing->ended` after `pause` there.
- Repro: 2-beat project, cue `last@1.5`. The `cue` listener calls
  `void engine.pause()` on `last`. `play()` → tick at 2200.
  - Observed (working tree): playback
    `["play:command@0", "pause:command@2000"]`, state `ended`, 0 timers. No
    `ended` event.
  - On `dffec0d`: `pause:command@2000` followed by
    `ended:local-end:playing->…@2000`.
- Expected: one `ended` (cause `local-end`) announces the transition to
  `ended`. Rules: `playback-v2.md` §3.2 state table ("playing | local finite
  end, no Project loop | ended | local end") and
  `timeline-arrangement-v2.md` §3 ("reaching its local end transitions to
  local `ended`").
- Fix note: copying the Arrangement rule ("emit while the state is still
  `ended`") is not enough here. A re-entrant `setProject(shorter)` already
  emits its own `ended`, so that rule would emit it twice (the critic
  verified that the current code emits it exactly once). Either the pause
  path announces a playing → ended transition itself, or the fix for R1
  changes what pause does to the cursor and state. That is a design call for
  the author.

### Focus items

1. Bump completeness: **holds**. Every `handleTransportEvent` branch,
   play from stopped/ended (including the ended replay), play that lands at
   local end, `setProject` / `setArrangement`, `setLoop` (a same-value call
   returns early without bumping), `dispose()`, transport dispose, and the
   Sequencer `loop` event all bump.
2. No over-bumping: **broken** (R1). Timeline `pause` bumps and moves the
   cursor. `ratechange`, `bufferingchange`, `error`, and a redundant `play`
   correctly do not bump. Arrangement `setLoop` / `pause` leave the cursor
   alone and send the remaining steps on the next tick: verified with no
   duplicate and no loss.
3. Next tick after an abandoned batch: **holds except pause** (R1, R2).
   Covered: seek (non-loop, and after a loop wrap), stop → play, hot-swap
   shorter (loop: wraps and continues, non-retroactive; non-loop: exactly
   one `ended`), hot-swap longer (F1), `setLoop` both ways (F1 variant, F4),
   Engine dispose, transport dispose. `"skip"` dispatches a single item, so
   the guard does not affect it.
4. F7: **holds**. Engine dispose (`ended` emits after listeners are
   cleared), transport dispose (`error` then `ended`, as on `dffec0d`),
   `setLoop(true)` from ended (Arrangement keeps `ended` under an existing
   rule, outside the diff), stop from a section listener (state `stopped`,
   no `ended`).
5. `scheduleNextTick()` after an abandoned batch: **holds**. It is
   idempotent after seek / `setLoop` / `setProject` and a guarded no-op after
   pause / stop / ended / transport dispose. The only leftover is the known,
   harmless timer after an Engine dispose.
6. F1 deviation, O1, O2: **agree**. Beat 2: `getPosition()` clamps to
   project A's end, and §3 "hot-swap preserves the current beat position"
   keeps that value. O1: the docs do not define `"emit"` across a wrap, gap,
   or end. O2: not catch-up dispatch, and no documented rule is violated.
7. Tests / helper / CHANGELOG: **holds**. All nine RC1G tests use public
   APIs only and fail without the fix. The `ManualTransport.seekMs()` change
   does not alter existing tests: the existing Arrangement (`:763`, `:795`,
   `:815`) and Sequencer (`:840`) `ManualTransport` tests never seek. The
   CHANGELOG claims match the code, but the new entry does not mention the
   R1/R2 side effects of pause (resolve these with the fix).

### Candidates discarded after falsification

- Timeline normal tick, cue listener calls `setLoop(true)`: the remaining
  cues are dropped, but RC1D behaved the same (the old `localLoop`
  comparison also abandoned the batch) and the earlier CHANGELOG entry
  documents it. Not a regression.
- Timeline `setLoop(true)` skipping a beat-0 cue just after an iteration
  boundary: this follows the "`setLoop` re-anchors at the current position"
  rule and is outside the diff.
- Timeline local-end tick plus `setProject(same or shorter)`: `setProject`
  emits `ended` once and the tick returns. No duplicate.
- A transport `ended` bump abandoning the remaining cues: replay restarts
  from 0, and only a third-party transport can reach this. No rule is
  violated.
- Re-entrancy inside Arrangement `emitDueSteps(duration)` at local end:
  `resolveAtPosition(duration)` is always `null` (see O1).
- Arrangement and Sequencer pause during catch-up: the remaining steps go
  out after resume, with no loss and no duplicate.
- The timer after `dispose()`: known, harmless, and present before the
  change.
- The seek handler sets `lastDispatchedRawPositionMs = null` and then
  assigns it again: this order is needed for the suppress-seek branch and is
  correct.

### Not re-run by the reviewer

`pnpm test:coverage`, `pnpm api:check`, and `pnpm behavior:check` were not
re-run; the author's results above were relied on. Re-check coverage after
the R1/R2 fix, which may add or remove branches.

### Fix direction (decided by the user, 2026-10-10)

- R1 (first decision, superseded during implementation): Timeline `pause`
  no longer moves the dispatch cursor, and the abandoned cues go out on the
  first tick after resume. Removing the cursor line alone was measured to
  duplicate a cue: Timeline writes `lastDispatchedRawPositionMs` only at the
  end of a batch, so an abandoned batch leaves the cursor at its start, and
  the first tick after resume re-dispatches the cues already sent
  (`["one@2500", "one@2600", "two@2600"]`). Arrangement and Sequencer advance
  their cursor per step and are not affected.
- R1 (final decision): `pause` does not bump `dispatchGeneration` in any
  Engine, and Timeline `pause` no longer moves the cursor. Pause moves no
  dispatch cursor, so under focus item 2 ("bump only when the cursor moves")
  it must not abandon a batch. A batch that a listener pauses runs to
  completion, right after the `pause` event (the `dffec0d` behavior). Cues
  passed between the last tick and a pause go out on the first tick after
  resume, which closes the pre-existing clock-transport loss. The removed
  line dates from the T3 implementation (`317fc2e`) and has no recorded
  rationale. Rejected: a per-cue cursor plus a record of the cues already
  dispatched at the same position. It would deliver on resume in all three
  Engines, but it touches the dispatch core and about eight cursor writes
  just before the RC.
- R2: in the `pause` branch of both `TimelineEngine` and `ArrangementEngine`,
  when the Engine was `playing` and applying the pause snapshot leaves it
  `ended` at local end, emit `pause` and then exactly one `ended`
  (`cause: "local-end"`). This fixes the re-entrant case (R2) and a
  pre-existing race that the main session reproduced on both Engines with
  the built-in clock transport, without re-entrancy. In that race,
  `pause()` runs after the clock has passed local end and before the
  local-end tick. Observed:
  `["play:command:stopped->playing", "pause:command:playing->ended"]`, and
  no `ended`. The Arrangement re-entrant path already emits `ended` through
  the F7 guard; the tick there sets `ended` before it emits, so the pause
  handler sees `previousState === "ended"` and must not emit a second one.
- The behavior docs do not state this ordering. Add one line to
  `docs/behavior/playback-v2.md` §3.2/§3.3 (a pause that lands at or past
  local end while playing emits `pause`, then `ended` with cause
  `local-end`) together with the fix (spec rule 10).
- Tests: R1 (re-entrant and clock-transport variants) and R2 (re-entrant
  Timeline; race on both Engines), each failing before the fix. Re-run all
  six gates and the coverage check, then request review again.

### Round 2 fix (R1, R2)

Implemented on 2026-10-10 as decided above. Uncommitted; review
`git diff -- packages/core docs/behavior CHANGELOG.md` against the round 1
tree.

- `TimelineEngine.ts`: in the `pause` branch, removed the bump and the
  cursor write, and added `ended` (`local-end`) after `pause` when the Engine
  goes from `playing` to `ended`. The local-end branch of `tick()` now also
  returns when the state is no longer `playing` after `emitDueCues` (a
  pausing cue listener has already announced local end). Otherwise `ended`
  would be emitted twice.
- `ArrangementEngine.ts`: in the `pause` branch, removed the bump and added
  the same `ended` after `pause`. The re-entrant local-end path still
  announces through the F7 guard (the tick sets `ended` first, so the pause
  handler sees `previousState === "ended"`).
- `SequencerEngine.ts`: removed the bump from the `pause` branch.
- The comments on the `dispatchGeneration` fields and the catch-up loops no
  longer list `pause`.
- Tests (public APIs only; `PausingTransport` is a `ManualTransport`
  subclass local to each RC1G block that emits `pause` synchronously; the
  shared helper is unchanged):
  - Timeline: "finishes a catch-up batch that a cue listener pauses, ..."
    (R1), "dispatches a cue passed between the last tick and a pause ..."
    (pre-existing clock loss), "PB-EN-030 announces local end once when a cue
    listener pauses during the local-end tick" (R2), "PB-EN-030 announces
    local end when a pause lands past local end before the tick" (race).
  - Arrangement: "finishes a catch-up batch that a step listener pauses,
    ...", "PB-EN-030 ... pause lands past local end before the tick" (race),
    "PB-EN-030 announces local end once when a section listener pauses at
    local end" (guards against a double `ended`; passes before the fix by
    design).
  - Sequencer: "finishes a catch-up batch that a step listener pauses, ...".
- Docs: `docs/behavior/playback-v2.md` §3.3 adds the pause-at-local-end
  ordering. `playback-v2-matrix.md` adds PB-EN-030. `CHANGELOG.md`: the RC1G
  entry no longer lists pause as stopping dispatch and states that a pausing
  listener's batch completes once. Two entries were added: the clock-transport
  cue loss, and `ended` after a late pause.

Fail-before (the engine files were rebuilt as scratch copies; the test
imports were redirected to them, then deleted):

- Round 1 tree: 6 of the 7 new Timeline/Arrangement tests fail (the
  section-listener guard test passes, as intended).
- `dffec0d`: the clock-loss test and both race tests fail. The R1/R2
  re-entrant tests pass there, which is consistent with R1/R2 being RC1G
  regressions.

Gates (repository root): `pnpm typecheck`, `pnpm build`, `pnpm test`,
`pnpm test:coverage`, `pnpm api:check`, `pnpm behavior:check` all exit 0.
Tests: core 415, react 36, player-react 8, playground 11, cycling-workout
example 5. `SequencerEngine.ts`, `ArrangementEngine.ts`, and
`TimelineEngine.ts` are at 100% statements, branches, functions, and lines,
with no new exclusions. API reports are up to date. Behavior matrix: 192
covered. Not run: browser E2E and pack smoke (no packaging or
browser-facing change).

### Round 2 review

- Date: 2026-10-10
- Reviewer: `critic` (Fable), adversarial review of the round 2 tree
  (`git diff dffec0d -- packages/core docs/behavior CHANGELOG.md`). C1 was
  reproduced independently by the main session with the built-in clock
  transport. All scratch files were deleted.
- Verdict: **changes_requested**, for C1 only. The re-entrancy mechanism and
  the R1/R2 resolution are sound.

#### C1 (low-medium) — Timeline: a pause that lands past local end drops the cues between the last tick and local end

- Where: `packages/core/src/timeline/TimelineEngine.ts:419-431` (`pause`
  branch). It emits `pause` and then `ended` (`local-end`), but never
  dispatches the cues in `(lastDispatchedRawPositionMs, durationMs]`. The
  local-end tick (`:575-588`) calls `emitDueCues(getDurationMs())` before
  `ended`.
- Repro (clock transport, no re-entrancy, bpm 60, `lookaheadMs: 10`): a
  2-beat project with cue `final@1.95`. `play()`; tick at 1900 ms; advance
  the clock to 2200 ms without a tick; `pause()`.
  - Observed: `["play:command", "pause:command", "ended:local-end"]`, state
    `ended`, no cue. The next `play()` is an ended replay from 0, so `final`
    is never delivered.
  - Control (let the tick run instead of pausing):
    `["play:command", "cue:final", "ended:local-end"]`.
- Rule: `timeline-arrangement-v2.md` §3, `missedCuePolicy: "emit"` (every
  passed cue dispatches; only an explicit seek skips them). The two paths to
  local `ended` now disagree on whether the final cues fire.
- Not a regression: `dffec0d` also lost this cue, because pause overwrote the
  cursor. But the new `CHANGELOG.md` line ("no longer drops cues passed
  between the last tick and a `pause()`; they are dispatched on the first
  tick after resume") is false for this case, because no tick follows the
  resume (it replays from 0).
- Options: (a) in the `pause` branch, when the Engine goes from `playing` to
  `ended`, dispatch `emitDueCues(getDurationMs())` before `ended`, keeping
  the generation check (cue listeners may re-enter); or (b) narrow the
  CHANGELOG line to pauses before local end.
- Arrangement has the same loss when a pause lands past the end. It is the
  O1 / RC1H gap (`emitDueSteps(duration)` never emits) and reproduces on the
  plain tick path too, so it is not attributed to this diff. RC1H's D9 covers
  it.

#### Per-item verdicts

1. Removing the `pause` bump (a deviation from the round 1 fix direction):
   **accepted.** No documented rule forbids cue/step events after a `pause`
   playback event. Their `transportPositionMs` is the frozen pause position,
   and "paused → play: do not re-emit the current step" holds. The
   documented direction is not viable for Timeline without a per-cue cursor,
   because the cursor is written only at batch end, so an abandoned batch
   re-dispatches what it already sent (round 1 measured this).
2. Pause, then a re-entrant seek / setProject / play / stop / dispose:
   **holds.** Every path that writes the cursor bumps, and pause no longer
   writes one.
3. R2 / PB-EN-030: **holds.** `ended` is emitted exactly once in Timeline
   (the pause branch announces it, and the tick's new `playbackState !==
   "playing"` return suppresses the second) and in Arrangement (the tick
   announces it, and the pause branch sees `previousState === "ended"`).
   The early return does not swallow `ended` on buffering, dispose, or stop.
4. The clock-transport cue-loss fix: **holds except C1.** No duplicates
   after pause → play / seek / setProject / stop, and `lateByMs` is measured
   from the frozen position.
5. Coverage: **holds.** `pnpm test:coverage` exits 0; the three Engines are
   at 100% with no exclusions; each new branch is reached by a test that
   fails without the fix (the Arrangement section-listener test covers the
   false arm of a legitimate guard).
6. Tests and docs: **holds except the C1 CHANGELOG line.**

#### Not reviewed in round 2

The `ROADMAP.md`, task-table, and checklist bookkeeping. `pnpm api:check` and
`pnpm behavior:check` were not re-run (no public signature changed).

### Round 3 fix (C1)

Implemented on 2026-10-10 with option (a), as decided by the user.
Uncommitted.

- `TimelineEngine.ts`, `pause` branch: when the pause takes the Engine from
  `playing` to `ended`, emit `pause`, then dispatch
  `emitDueCues(getDurationMs())`, then emit `ended` (`local-end`) if the
  Engine is still `ended`. Rules added while doing this:
  - A `pause` listener that re-entrantly replays, seeks, or hot-swaps (a
    generation change across the `pause` emission) takes over, and the branch
    returns. Without this, a replay from a `pause` listener would be followed
    by a dispatch of every cue up to the end and a second `ended`.
  - Inside the local-end tick's own batch, the branch does not dispatch.
    A nested batch would re-dispatch the cues already sent, because the
    Timeline cursor moves at batch end. It marks
    `localEndDispatch.paused`, and `tick()` finishes the batch and announces
    `ended` if the Engine is still `ended`. Without a pause, `tick()` keeps
    the round 1 rule (`return` when the batch was abandoned).
  - "Still `ended`" rather than "batch completed" after a pause, because the
    Engine is already `ended` before the cue listeners run: a re-entrant
    `setProject(shorter)` then does not announce `ended` itself, so it must be
    announced once here. A seek, replay, `setLoop(true)`, or stop moves the
    Engine away, and nothing is announced.
  - `isEnded()` is a method because `tick()` has narrowed `playbackState` to
    `"playing"` for the compiler.
- Order change for the round 2 re-entrant case (R2): a cue listener that
  pauses during the local-end tick now gets the remaining final cues before
  `ended`. Round 2 emitted `ended` from the `pause` handler and then the
  remaining cues after it.
- Arrangement is unchanged here. Its local-end tick dispatches nothing either
  (O1), so the two Arrangement paths agree; RC1H D9 covers both.
- Tests (Timeline "RC1G re-entrancy" block):
  - "PB-EN-030 dispatches the cues due up to local end before ended when a
    pause lands past local end" (C1 repro, clock transport).
  - "stops the past-end pause dispatch when a cue listener seeks, and
    announces end once after a shorter hot-swap".
  - "leaves a past-end pause to a pause listener that replays from the
    start". This passes on the round 2 code by design; it guards the
    generation check that the round 3 dispatch needs.
  - "does not announce local end when a later cue listener seeks after a
    pausing one in the local-end tick".
- Docs: `playback-v2.md` §3.3 and `PB-EN-030` now include the dispatch
  between `pause` and `ended`. `CHANGELOG.md`: the pause cue-loss entry now
  covers both the before-end and past-end cases.

Fail-before: with the round 2 `TimelineEngine.ts` restored, the first,
second, and fourth tests fail (3 failed / 53 passed); with the fix, 56 of 56
pass. The fail-before run used the first draft of the fix (a string state
instead of the `{ paused }` holder); the final version is a type-only
rewrite and passes the same tests.

Gates (repository root): `pnpm typecheck`, `pnpm build`, `pnpm test`,
`pnpm test:coverage`, `pnpm api:check`, `pnpm behavior:check` all exit 0.
Core 419 tests. The three Engines are at 100% statements, branches,
functions, and lines, with no new exclusions. `api:check` has no warnings.
Behavior matrix: 192 covered. Not run: browser E2E and pack smoke.

### Round 3 review

- Date: 2026-10-10
- Reviewer: `critic` (Fable), adversarial review of the round 3 tree
  (`git diff dffec0d -- packages/core docs/behavior CHANGELOG.md`), focused on
  the `TimelineEngine.ts` `pause` branch, the local-end branch of `tick()`,
  `localEndDispatch`, and the four new tests. Findings were classified against
  a scratch rebuild of the round 2 `TimelineEngine.ts`. D1 was reproduced
  independently by the main session with the built-in clock transport
  (observed `["play:stopped", "pause:playing", "project@2000"]`, state
  `ended`, no `ended` event). All scratch files were deleted.
- Verdict: **changes_requested**, for D1 only. C1 itself is fixed. D2 and D3
  are low: fold them into the D1 fix or defer them with a note.

Harness: the test file's `ManualTransport` with a synchronous `pause()`
(`PausingTransport`), bpm 60, `lookaheadMs: 10`. A "tick" sets
`transport.snapshot.positionMs`, then runs `vi.advanceTimersByTimeAsync(10)`.
D1 also reproduces with `createClockTransport(FakeClock)`, without a
synchronous emission.

#### D1 (medium) — Timeline: a `pause` listener that hot-swaps to a same-or-shorter project on a past-end pause suppresses `ended`

- Where: `packages/core/src/timeline/TimelineEngine.ts:434-436` (`pause`
  branch, `if (!reachedLocalEnd || this.dispatchGeneration !== generation)
  return;`).
- Cause: the generation check across the `pause` emission returns
  unconditionally. `setProject()` sees `previousState === "ended"` (the pause
  snapshot already set it), so it does not announce `ended` itself (`:310`).
  The `pause` branch then returns without announcing it, so nothing announces
  the playing → ended transition. The cue-listener case is handled ("announces
  end once after a shorter hot-swap"); the pause-listener case is not.
- Repro (clock transport): project A is 4 beats with cue `late@3.5`; project B
  is 2 beats. A `playback` listener calls `engine.setProject(B)` on `pause`.
  `play()`; tick at 3000; advance the clock to 4500 without a tick; `pause()`.
  - Observed (round 3): `["play:stopped->playing", "pause:playing->ended@4000",
    "project@2000"]`, state `ended`, no `ended` event.
  - Round 2 rebuild: `[..., "pause:playing->ended@4000", "project@2000",
    "ended:playing->ended@2000"]`.
  - Control without the listener (round 3): `["play", "pause",
    "cue:late@4000", "ended:local-end"]`.
- Variant inside the local-end tick (synchronous pause transport): the
  listener for cue `x@3.5` pauses, and a `pause` listener calls
  `setProject(B)`. Observed: `["play", "cue:x", "pause:playing->ended",
  "project@2000"]`, no `ended`. The `pause` branch returns without marking
  `localEndDispatch.paused`, and `tick()` takes the `!completed` arm. Round 2
  emitted `ended` here.
- Rule: `playback-v2.md` §3.3 (the new line) and PB-EN-030 exempt only a
  listener that seeks, replays, or hot-swaps to a **longer** Project. A shorter
  hot-swap is not exempt, and the Engine is still `ended`. §3.2 requires the
  `playing` → local finite end → `ended` transition to be announced.
- Regression: **yes, against round 2**, which announced it. Not a regression
  against `dffec0d`, which announced nothing after a late pause.
- Fix shape: do not return on a generation change. Skip only the dispatch, then
  apply the same "announce if still `ended`" rule that cue listeners use:
  ```ts
  if (!reachedLocalEnd) return;
  if (this.dispatchGeneration === generation) {
    if (this.localEndDispatch) { this.localEndDispatch.paused = true; return; }
    this.emitDueCues(this.getDurationMs());
  }
  if (this.playbackState !== "ended" || this.disposed) return;   // disposed: D2
  this.emitPlayback("ended", "local-end", previousState);
  ```
  The reviewer checked this shape against the other pause-listener
  re-entries, and no `ended` is announced in any of them:

  | Pause listener calls | Resulting state |
  | --- | --- |
  | `play()` (replay) | `paused` / `playing`; the existing replay test still holds |
  | `setLoop(true)` | `paused` |
  | `stop()` | `stopped` |
  | `seek` below end | `paused` |

  In the local-end-tick variant, the `pause` branch announces inside the
  batch, and `tick()` then takes the `!completed` arm, so `ended` is still
  emitted exactly once. Add a test for the clock-transport repro; it fails on
  round 3.

#### D2 (low) — Timeline: `ended` is emitted after a cue listener disposes the Engine during the past-end pause dispatch

- Where: `TimelineEngine.ts:443-447`. After `emitDueCues(getDurationMs())`, the
  only check is `playbackState !== "ended"`, and `dispose()` does not change
  `playbackState`.
- Repro: a synchronous pause transport whose `getSnapshot()` throws after
  `dispose()`, as `createClockTransport` does at `:245-248`. Project of 4 beats
  with cue `x@3.2`. The cue listener calls `engine.dispose()`, then
  `transport.dispose()` (what `Engine.dispose()` does for an owned transport,
  `:345-347`). `play()`; tick at 3000; snapshot at 4500; `pause()`.
  - Observed: `["play", "pause", "cue:x"]`, plus one error caught by the
    transport's emit loop: `PlaybackError: Playback transport has been
    disposed.`, thrown by `createPlaybackSnapshot()` →
    `transport.getSnapshot()`. With the built-in owned clock transport it goes
    to `reportListenerError` (`globalThis.reportError` / `console.error`).
  - Control (the same listener in the local-end tick): no error. `tick()`
    takes the `!completed` arm.
- Impact: Engine listeners are already cleared, so the only harm is a spurious
  reported error. State is not corrupted.
- Regression: none against `dffec0d` or round 2. This is new surface from the
  round 3 dispatch.
- Fix: add `|| this.disposed` to the guard before the final
  `emitPlayback("ended", ...)` (already in the D1 sketch). This adds one
  branch, which a `ManualTransport` whose `getSnapshot()` throws after
  `dispose()` covers through public APIs.

#### D3 (low, third-party transport only) — Timeline: a synchronous `pause` whose snapshot lands past local end inside a normal tick batch re-dispatches the batch

- Where: `TimelineEngine.ts:437-443`. Only the local-end branch of `tick()`
  sets `localEndDispatch`. Suppose a pause lands past end while a normal-tick
  batch is running. The `pause` branch then runs a nested
  `emitDueCues(getDurationMs())` from a cursor still at the batch start. The
  outer batch then continues, because pause does not bump the generation.
- Repro: a `ManualTransport` subclass whose `pause()` emits a snapshot at
  `getPositionMs() + 1500`. Project of 4 beats with cues `p@1.5`, `q@2.5`, and
  `r@3.8`; the `p` listener pauses. `play()`; tick at 3000.
  - Observed: `["play", "cue:p@3000", "pause:playing->ended", "cue:p@4000",
    "pause:ended->ended", "cue:q@4000", "cue:r@4000", "ended:local-end",
    "cue:q@3000"]`. `p` and `q` fire twice, and `q` fires after `ended`.
  - Round 2 rebuild: `["play", "cue:p@3000", "pause", "ended",
    "cue:q@3000"]` (a cue after `ended`, `r` lost). `dffec0d`: `q` and `r`
    are lost silently, with no `ended`. All three are wrong; round 3 trades
    loss for duplicates.
- Reachability: it needs a third-party `PlaybackTransport` that emits `pause`
  synchronously. The pause snapshot must also report a later position than
  `getPositionMs()` returned at the start of the same tick, with local end in
  between. The built-in transports cannot reach it.
- Fix shape if taken now: set the holder for every batch (`localEndDispatch` →
  `activeDispatch`, also around the normal-tick `emitDueCues`). After the
  batch, when `activeDispatch.paused && this.isEnded()`, run the local-end
  completion (`emitDueCues(duration)`, then announce). Otherwise document it as
  a known limitation of synchronous transports and defer it; it should not
  block RC1G.

#### Per-focus verdicts (round 3)

1. C1 fixed: **holds.** Clock transport, cue `final@1.95`, tick at 1900, pause
   at 2200: `["play", "pause", "cue:final@2000", "ended:local-end"]`, exactly
   once, with the same `transportPositionMs` and cursor as the local-end tick.
2. Re-entrancy in the `pause` branch: **holds for cue listeners; does not hold
   for pause listeners (D1).** Cue listener during the past-end dispatch:

   | Call | Result |
   | --- | --- |
   | `setProject(longer)` | `paused`; no `ended`; no further old cues |
   | `setProject(shorter)` | one `ended` |
   | `setLoop(true)` | `paused`; no `ended`; remaining cues dropped (the round 1 rule) |
   | `play()` | replay, no `ended` |
   | `stop()` | `stopped`, no `ended` |
   | second `pause()` | one extra `pause:ended->ended`; one `ended` |
   | `dispose()` | D2 |

3. `localEndDispatch` in the local-end tick: **holds.** Combinations tested:
   `setProject(shorter|longer)`, `setLoop(true)`, `seek`, and `dispose()` from
   a later cue listener. No duplicate cues, no lost final cues, and
   `vi.getTimerCount() === 0`. The holder is reset correctly after an ended
   replay and before a later unrelated past-end pause. No nested `tick()`
   exists, and `emit()` catches listener errors, so the `= null` reset always
   runs.
4. Round 1–2 regressions: **holds.** The Arrangement and Sequencer diffs are
   unchanged from round 2. F1, F2, F3, R1, and R2/PB-EN-030 all pass
   (Timeline 56/56).
5. Docs, CHANGELOG, and tests: **holds, except that D1 contradicts the new
   §3.3 sentence.** The C1 CHANGELOG line is now true. The four new tests use
   public APIs only. Fail-before was confirmed on the round 2 rebuild: 3
   tests fail, and the replay guard test passes by design.
6. Simplification: **the holder is justified.** `tick()` must tell apart "a
   re-anchoring command took over" from "paused, still `ended`, nobody
   announced it". `isEnded()` could be replaced by a widened local
   (`const state: PlaybackState = this.playbackState`); that is a matter of
   taste. The D1 fix removes one `return`.

#### Candidates discarded after falsification (round 3)

- A cue listener seeks to the exact end during the past-end dispatch. The
  output is `seek:ended->ended`, then `ended`. The tick path gives
  `seek:playing->ended` and no `ended`, which predates this diff. This is
  contrived and defensible.
- A cue listener runs pause → `setLoop(true)` → `setLoop(false)` in the
  local-end tick. One `ended` is emitted with `previousState: "playing"`.
  `setLoop(false)` entering `ended` silently from `paused` is outside the diff.
- A past-end pause with a `null` cursor is unreachable while `playing`.
- `missedCuePolicy: "skip"` takes the same `emitDueCuesForIteration` path;
  nothing new.
- Double `pause` events from a re-entrant second `pause()`: the same happens
  on `dffec0d`.
- Arrangement's `pause` branch has no generation check across its `pause`
  emission (`ArrangementEngine.ts:480-491`), so a synchronous pause listener
  that replays would get `ended` after the replay. This is outside round 3
  (accepted in round 2, Arrangement untouched). It could be aligned with the
  Timeline rule later.

#### Not run in round 3

`pnpm test:coverage`, `api:check`, `behavior:check`, `typecheck`, and `build`
were not run; the author's gate results were relied on. The D1/D2 fix adds
branches, so re-run coverage after it.

### Round 4 fix (D1, D2, D3)

Implemented on 2026-10-10. All three findings were fixed at the user's
request (D3 was not deferred). Uncommitted. Only `TimelineEngine.ts`, its
tests, `playback-v2.md` §3.3, and `CHANGELOG.md` changed; Arrangement and
Sequencer were not touched.

- `TimelineEngine.ts`:
  - `localEndDispatch` → `activeDispatch`, set by a new `runDispatch()` around
    every dispatch batch: the normal tick, the local-end tick, and
    `emitCurrentCues()` at play. The outer holder is restored afterwards for
    nested batches. Suppose a cue listener's pause takes the Engine from
    `playing` to `ended` during a batch. The `pause` branch only marks the
    holder; the batch runs to completion (the R1 rule) and then finishes local
    end. This fixes D3: the normal tick no longer runs a nested batch from a
    stale cursor.
  - A new `finishLocalEndPause(dispatchRemaining)` is shared by the `pause`
    branch (no batch running) and `runDispatch()` (paused batch). It
    dispatches the cues due up to local end only when no listener re-anchored
    dispatch (`pause` branch: generation unchanged across the `pause`
    emission; batch: the batch completed). It then emits `ended`
    (`local-end`) unless the Engine left `ended` or was disposed. D1: a
    generation change no longer suppresses `ended`, so a `pause` listener's
    shorter hot-swap announces it once. D2: `|| this.disposed`.
  - The local-end tick returns when `runDispatch()` returns `false`
    (abandoned, or finished by a pause), as before.
  - `isEnded()` was removed: `finishLocalEndPause()` reads `playbackState`
    without the narrowing that `tick()` had.
- Tests (Timeline "RC1G re-entrancy" block, public APIs only):
  - "announces local end once when a pause listener hot-swaps to a shorter
    project on a past-end pause" (D1: clock transport, plus the local-end-tick
    variant with `PausingTransport`; asserts `vi.getTimerCount() === 0`).
  - "does not announce local end after a cue listener disposes the Engine
    during a past-end pause" (D2: a `PausingTransport` whose `getSnapshot()`
    throws after `dispose()`; `engine.pause()` must resolve).
  - "finishes a normal tick batch before local end when a cue listener's pause
    lands past local end" (D3: the reviewer's `+1500 ms` pause snapshot).
    Expected `["play", "cue:p@3000", "pause", "cue:q@3000", "cue:r@4000",
    "ended"]`, with no timer left.
- Docs: `playback-v2.md` §3.3 lists every takeover (seek, replay, stop,
  enable loop, longer hot-swap, dispose). It also states that a pause from a
  listener lets the running dispatch finish first, with no duplicates.
  `CHANGELOG.md`: the pause cue-loss entry adds "each once", covering a
  third-party transport whose pause snapshot lands past local end.

Fail-before: rebuilt the round 3 `TimelineEngine.ts` as a scratch copy and
redirected a copy of the test file to it. All three new tests fail there (3
failed / 56 passed); with the fix, 59 of 59 pass. The scratch files were
deleted.

Gates (repository root): `pnpm typecheck`, `pnpm build`, `pnpm test`,
`pnpm test:coverage` (exit 0), `pnpm api:check`, and `pnpm behavior:check` all
pass. Tests: core 422, react 36, player-react 8, playground 11, and
cycling-workout example 5. `SequencerEngine.ts`, `ArrangementEngine.ts`, and
`TimelineEngine.ts` are at 100% statements, branches, functions, and lines,
with no new exclusions. API reports are up to date. Behavior matrix: 192
covered. Not run: browser E2E and pack smoke (no packaging or browser-facing
change).

Review focus for round 4:

1. The `runDispatch()` / `activeDispatch` holder covers every batch. Check
   nesting: a cue listener's `play()` replay runs `emitCurrentCues()` inside
   an outer batch.
2. `finishLocalEndPause()` covers each takeover from both pause and cue
   listeners: shorter/longer hot-swap, replay, seek, stop, `setLoop(true)`,
   and dispose.
3. D3 ordering: cues after `pause` keep the tick's `transportPositionMs`, and
   the local-end remainder uses `durationMs`.

### Round 4 review

- Date: 2026-10-10
- Reviewer: `critic` (Fable), adversarial review of the round 4 tree
  (`git diff dffec0d -- packages/core docs/behavior CHANGELOG.md`; only
  `TimelineEngine.ts`, its tests, `playback-v2.md` §3.3, and `CHANGELOG.md`
  changed since round 3). E1 Repro A was reproduced independently by the main
  session (observed `["play", "cue:p@2000", "seek", "pause", "ended"]`, state
  `ended`, `r` never dispatched). E3 was confirmed by reading
  `TimelineEngine.ts:466`. All scratch files were deleted.
- Verdict: **changes_requested (low)**. D1, D2, and D3 are fixed and
  re-verified. The round 1–3 tests (F1–F4, R1, R2/PB-EN-030, C1) all pass
  (Timeline 59/59, core 422). Three low findings remain. All are in the same
  reachability class as D3: a third-party `PlaybackTransport` whose
  synchronous `pause` reports a position past local end that is later than
  the position the tick read. The built-in transports cannot reach them.
  Because D3 was fixed rather than deferred, they are reported. Deferring all
  three with one "known limitation of synchronous transports" line would also
  be defensible and should not block RC1G.

Harness: the test file's `ManualTransport` with synchronous `play`, `stop`,
`seek`, and `pause`, where `pause()` reports `positionMs + pauseOffset`
(`pauseOffset: 0` is the file's `PausingTransport`; `> 0` is the D3
`LatePausingTransport`). bpm 60, `lookaheadMs: 10`. "Tick at X" sets
`snapshot.positionMs = X`, then runs `vi.advanceTimersByTimeAsync(10)`. Log
format: `type:previousState->state@positionMs`, `cue:id@transportPositionMs`.

#### E1 (low) — a re-anchor followed by a late pause in the same cue listener loses the cues between the new cursor and local end

- Where: `TimelineEngine.ts:615-621` (`runDispatch`:
  `finishLocalEndPause(completed)`).
- Cause: `runDispatch` treats `completed` ("the batch was not abandoned") as
  the predicate "nothing re-anchored dispatch, so it is safe to dispatch from
  the cursor". That conflates two cases. Suppose the generation changed
  *before* the pause (in the same listener: a seek, or `stop()` + `play()`).
  The re-entrant command already set the cursor to a fresh value, so
  dispatching `(cursor, durationMs]` is exactly what the local-end tick would
  do, and the batch is abandoned anyway, so nothing is sent twice. The code
  skips the dispatch and announces `ended` over the lost cues. The pause
  branch outside a batch (`:430-441`) uses the right predicate (generation
  unchanged across the pause listeners) and does dispatch.
- Repro A (seek, then pause): a 4-beat project with cues `p@1.5`, `q@2.5`,
  and `r@3.8`; `pauseOffset: 1500`. The `p` listener calls
  `void engine.seekPositionMs(3000); void engine.pause();`. `play()`; tick at
  2000.
  - Observed: `["play", "cue:p@2000", "seek:playing->playing@3000",
    "pause:playing->ended@4000", "ended:playing->ended@4000"]`. `r` is never
    dispatched (the seek correctly skips `q`).
  - Control (the same seek, then pause, outside a batch): `[..., "seek@3000",
    "pause", "cue:r@4000", "ended"]`.
- Repro B (`stop()` + `play()`, then pause): a 2-beat project with cues `z@0`,
  `a@1.5`, and `b@1.8`; `pauseOffset: 2500`. The first `a` listener calls
  `stop(); play(); pause();`. `play()`; tick at 1600.
  - Observed: `["play", "cue:z@0", "cue:a@1600", "stop",
    "play:stopped->playing@0", "cue:z@0", "pause:playing->ended@2000",
    "ended"]`. The replayed project's `a` and `b` are lost. The Engine is
    `ended` with no way to get them back (the next `play()` replays from 0).
- Rule: `playback-v2.md` §3.3 (the new line) says the pause "dispatches what
  is due up to the local end exactly as the local-end tick does";
  `timeline-arrangement-v2.md` §3 defines `missedCuePolicy: "emit"`. The
  CHANGELOG clause "each once, including when a `"cue"` listener pauses and a
  third-party `PlaybackTransport` reports a pause position past local end" is
  false here (zero times, not once).
- Regression: not against `dffec0d` or round 2 (both lost more). It is new
  surface from the round 3/4 dispatch, in the same class as D3.
- Fix shape: record the generation at pause time in the holder instead of a
  boolean, and use the same predicate as the pause branch:
  ```ts
  private activeDispatch: { pausedGeneration: number | null } | null = null;
  // pause branch: this.activeDispatch.pausedGeneration = this.dispatchGeneration; return;
  // runDispatch:
  if (batch.pausedGeneration === null) return completed;
  this.finishLocalEndPause(this.dispatchGeneration === batch.pausedGeneration);
  return false;
  ```
  "Unchanged since the pause" covers three cases: a completed batch (dispatch
  from the batch-end cursor), a re-anchor before the pause (dispatch from the
  fresh cursor), and a re-anchor after the pause (skip; the later command took
  over). Both callers of `finishLocalEndPause` then share one rule, which is
  simpler than the current `completed` reasoning.

#### E2 (low) — nested batch: a replay inside a paused batch announces `ended` twice

- Where: `TimelineEngine.ts:611-622` (`runDispatch`, outer batch) and
  `:635-638` (`finishLocalEndPause`, "announce if still `ended`").
- Cause: the outer batch decides whether it owes an announcement by "the
  Engine is `ended` now", not by "the Engine has been `ended` since that
  pause". A nested batch (a play from `stopped` or `ended` inside the outer
  batch) means the Engine left `ended`. If the inner batch is then paused past
  end itself, the inner `finishLocalEndPause` announces, and the outer one
  announces again for a transition that no longer exists. D1 rules out the
  obvious "announce only when the generation is unchanged" fix, because the
  shorter hot-swap must still announce.
- Repro: a 2-beat project with cues `z@0`, `a@1.5`, and `b@1.8`; synchronous
  transport. The `a` listener pauses (`pauseOffset: 0`, the natural local-end
  case). The first `b` listener calls `stop(); play();`. The `z` listener,
  once replayed, pauses with `pauseOffset: 2500`. `play()`; tick at 2500.
  - Observed: `["play", "cue:z@0", "cue:a@2000", "pause:playing->ended",
    "cue:b@2000", "stop", "play:stopped->playing@0", "cue:z@0",
    "pause:playing->ended", "cue:a@2000", "pause:ended->ended", "cue:b@2000",
    "ended:playing->ended", "ended:playing->ended"]`. That is two `ended`
    events for one transition. The first pause's transition was superseded by
    `stop`, which §3.3 says must not be announced.
  - With the synchronous transport, an ended replay (`play()` while `ended`)
    does not nest, because `runTransportCommands` awaits `seekMs` before
    `play`. `stop()` + `play()` and the seek-as-play replay (E3) are the
    synchronous nesting paths. Without the inner pause (control N1:
    `stop()` + `play()` in a normal tick), nesting is clean: no duplicate
    cues, the outer batch is abandoned, one timer.
- Regression: no (round 3 had no holder nesting at all). It needs two
  D3-class pauses and is very contrived.
- Fix shape: a nested batch implies that the Engine left `ended`, so clear
  the outer batch's pending pause when a nested batch runs. In `runDispatch`,
  after `this.activeDispatch = outerDispatch;`, add
  `if (outerDispatch) outerDispatch.pausedGeneration = null;` (or
  `paused = false`). D1 is unaffected, because a hot-swap does not run a
  batch. With E1's `pausedGeneration`, both fixes come to three lines in
  `runDispatch`.

#### E3 (low) — the seek-as-play replay's `emitCurrentCues()` is not a batch

- Where: `TimelineEngine.ts:466` (`seek` branch,
  `endedReplaySeekMode === "seek-as-play"`). `this.emitCurrentCues()` is
  called directly, not through `runDispatch()`. The round 4 fix notes say the
  holder wraps "every dispatch batch: the normal tick, the local-end tick, and
  `emitCurrentCues()` at play". This replay path (Engine `ended`, shared
  transport still playing) is a fourth batch.
- Repro: a 1-beat project with cues `a0@0`, `b0@0`, and `m@0.5`; synchronous
  transport, `pauseOffset: 1500`. `play()`; tick at 1200 (local end; the
  transport keeps playing). Then add a listener that pauses on `a0`, and call
  `engine.play()` (seek-as-play).
  - Observed after the replay: `["play:ended->playing@0", "cue:a0@0",
    "pause:playing->ended@1000", "ended:playing->ended@1000", "cue:b0@0"]`.
    `b0` is dispatched after `ended`, and `m@0.5` is never dispatched. The
    pause branch's `emitDueCues(durationMs)` ran with a `null` cursor, so it
    re-ran `emitCurrentCues` at the paused position and moved the cursor
    to 1000.
  - Nested variant (N4): a cue listener in a normal tick calls
    `setProject(shorter)`, so the Engine ends. It then calls `play()`, which
    replays as seek-as-play, and the inner `z` listener late-pauses. The
    pause marks the *outer* batch, which announces `ended` once, but the
    replayed project's `a` and `b` are lost (E1 class).
- Regression: no. Same reachability class as D3.
- Fix shape: `this.runDispatch(() => this.emitCurrentCues());` at `:466`, as
  at `:418`. The pause then lands inside the holder, and E1's predicate
  applies.

#### Per-focus verdicts (round 4)

1. D1/D2/D3 fixed: **holds.** The reviewer's repros were re-run on the
   current tree. D1 clock: `["play:stopped->playing@0",
   "pause:playing->ended@4000", "ended:playing->ended@2000"]`, state `ended`,
   0 timers. D1 in-tick variant: `["play", "cue:x@4000", "pause", "ended"]`,
   0 timers. D2: `["play", "pause", "cue:x"]`; `pause()` resolves and no
   listener error is reported. D3: `["play", "cue:p@3000", "pause",
   "cue:q@3000", "cue:r@4000", "ended"]`, state `ended`, 0 timers.
2. `runDispatch` / holder nesting: **holds for every nesting without a nested
   late pause** (N1: no duplicate cue, and the holder is restored; a later,
   unrelated past-end pause still works). **Does not hold** for E1 (a
   re-anchor before the pause in the same listener), E2 (a nested late
   pause), or E3 (`:466` is not wrapped).
3. `finishLocalEndPause` takeovers: **holds** for every command from both
   listener kinds.

   | Pause listener (synchronous pause past end) calls | Result |
   | --- | --- |
   | `play()` | replay, no `ended`, 1 timer |
   | `setLoop(true)` | `loopchange:ended->paused@500`, no `ended` |
   | `stop()` | `stopped` |
   | seek | `seek:ended->paused` |
   | `dispose()` | nothing after `pause` |
   | `setProject(longer)` | `paused`, no `ended` |
   | second `pause()` | `pause:ended->ended`, the final cue, one `ended` |

   A cue listener during the pause-branch dispatch gives the same results for
   the same seven calls, and `setProject(shorter)` gives exactly one
   `ended:playing->ended@2000`. Engine `dispose()` plus disposing the owned
   transport: no `ended` and no error (D2). A cue listener that disposes a
   shared transport: `error:ended->ended`, then `ended:playing->ended`. This
   matches the Arrangement precedent from round 1 and is accepted.
4. D3 ordering and `transportPositionMs`: **holds.** Cues after `pause` in
   the batch keep the tick's position (`q@3000`), the local-end remainder
   uses `durationMs` (`r@4000`), `ended` comes last, and no timer is left.
5. Regressions against rounds 1–3: **none found.** All 59 Timeline tests
   pass. Arrangement and Sequencer are unchanged (confirmed with `git diff`).
6. Coverage and unreachable code: **holds.** `pnpm vitest run --coverage` in
   `packages/core` reports `SequencerEngine.ts`, `ArrangementEngine.ts`, and
   `TimelineEngine.ts` at 100/100/100/100. This run had the scratch files
   present, which can only add coverage, so the author's 100% claim stands.
   Every new branch (`!batch.paused`, `dispatchRemaining`, `disposed ||`,
   `activeDispatch` in the pause branch) is reached by a test that fails on
   round 3. Nothing unreachable needs removing, and removing `isEnded()` was
   correct.
7. Docs and CHANGELOG: §3.3 and PB-EN-030 match the code for the built-in
   transports, with two nuances.
   - The CHANGELOG clause "each once" is false for E1 (zero times).
   - §3.3 says that "a listener that ... replays ... during the pause ...
     takes over, and `ended` is not emitted". This holds only for a transport
     that emits `seek` synchronously. With the built-in clock transport the
     replay's seek is enqueued, so the observed order is `pause`,
     `cue:late`, `ended`, `play:ended->playing` (verified). That order is
     reasonable, because the replay is simply a later command, but the
     sentence reads as unconditional. Consider "a listener whose command
     re-anchors dispatch synchronously".
8. Simplification: the holder is justified (the round 3 reasoning stands),
   but using `completed` as the dispatch predicate is the source of E1 and
   E2. A `pausedGeneration` in the holder puts both callers of
   `finishLocalEndPause` under one rule ("generation unchanged since the
   pause"), and the `completed` return value no longer matters on the pause
   path.

#### Candidates discarded after falsification (round 4)

- A nested replay via `play()` from `ended` duplicating cues: with a
  synchronous transport the replay awaits `seekMs` before `play`, so the
  inner batch runs on a microtask after the outer batch. Verified: no
  duplicates and one `ended`.
- `stop()` + `play()` nested in a normal tick without a pause (N1): the outer
  batch is abandoned, the inner one dispatches `z@0` once, and one timer
  remains. Correct.
- A cue listener calling a redundant `play()` in the local-end tick with a
  past-end snapshot: it hits `:406` (bump, `ended`, return), the batch is
  abandoned, and one `ended` is emitted. It cannot combine with an earlier
  pause in the same batch, because `play()` is then an ended replay instead.
- A cue listener seeking to exactly the end during a batch:
  `seek:playing->ended` plus the outer announcement is the round 3 "contrived
  and defensible" case; unchanged.
- `finishLocalEndPause` hard-coding `previousState: "playing"`: the flag is
  set only when `previousState === "playing" && playbackState === "ended"`,
  so the value is always correct.
- `emitDueCues(durationMs)` in `finishLocalEndPause` is not wrapped in
  `runDispatch`. A nested pause there has `previousState === "ended"` and is
  ignored. A nested replay is asynchronous with the built-in transports and is
  E2 with a synchronous one (already reported).
- `activeDispatch` is not restored on a throw: `emit()` catches listener
  errors, and nothing else in a batch throws (`getTransportPositionMs` uses
  `disposedTransportPositionMs`). Verified by reading, not reproduced.
- `missedCuePolicy: "skip"`: the same loop with a single item; nothing new.
- The timer left after `play()` from a pause listener is the replay's
  legitimate tick timer (state `playing`), not a leak.

#### Not run in round 4

The reviewer did not run `pnpm typecheck`, `pnpm build`, `pnpm api:check`,
`pnpm behavior:check`, the root `pnpm test` (react, player-react, playground,
examples), or browser E2E; the author's gate results were relied on for
those. The core coverage run was done once, with the scratch files present.

### Round 5 fix (E1, E2, E3)

Implemented on 2026-10-10. All three findings were fixed at the user's
request. Uncommitted. Only `TimelineEngine.ts`, its tests, and
`playback-v2.md` §3.3 changed; Arrangement, Sequencer, and `CHANGELOG.md`
were not touched (the CHANGELOG "each once" clause now holds for E1).

- `TimelineEngine.ts`:
  - The holder is now `{ pausedGeneration: number | null }`. The `pause`
    branch records the generation from before the `pause` emission, and
    `runDispatch()` calls
    `finishLocalEndPause(dispatchGeneration === pausedGeneration)`. Both
    callers of `finishLocalEndPause` now share one rule: dispatch the rest
    only when nothing re-anchored dispatch since the pause. This fixes E1: a
    seek or `stop()` + `play()` before the pause in the same listener
    re-anchors the cursor, and the rest is dispatched from there. The
    `completed` return value no longer decides the pause path.
  - E2: after a nested batch, `runDispatch()` clears the outer batch's
    `pausedGeneration` (a nested batch means the Engine left `ended`), so only
    the inner pause announces `ended`.
  - E3: the seek-as-play replay's `emitCurrentCues()` now runs through
    `runDispatch()`, as the play path does.
- Tests (Timeline "RC1G re-entrancy" block, public APIs only, a
  `LiveClockTransport` with a synchronous `stop` and a pause offset):
  - "dispatches up to local end from where a cue listener re-anchored before
    its pause lands past local end" (E1 Repro A and Repro B).
  - "announces local end once when a replay inside a paused batch is itself
    paused past local end" (E2).
  - "finishes an ended replay's batch before local end when a cue listener's
    pause lands past local end" (E3: expected `["play", "cue:a0@0", "pause",
    "cue:b0@0", "cue:m@1000", "ended"]`).
  - All three assert `vi.getTimerCount() === 0`.
- Docs: `playback-v2.md` §3.3 now says that a command the transport applies
  only later (a replay on the built-in clock transport) follows `ended`. It
  also says that a dispatch a listener pauses continues from where an earlier
  command in the same listener re-anchored it (review item 7).

Fail-before: the round 4 logic was restored in place temporarily (the boolean
predicate, no nested clear, `:466` unwrapped). All three new tests fail there
(3 failed / 59 passed). With the fix, 62 of 62 pass. The file was then
restored and confirmed identical to the fixed version.

Gates (repository root): `pnpm typecheck`, `pnpm build`, `pnpm test` (core
425, react 36, player-react 8, playground 11, cycling-workout example 5),
`pnpm test:coverage` (exit 0; the three Engines at 100% statements, branches,
functions, and lines), `pnpm api:check`, and `pnpm behavior:check` (192
covered) all pass. Not run: browser E2E and pack smoke (no packaging or
browser-facing change).

Review focus for round 5:

1. The `pausedGeneration` predicate in all three cases: a completed batch, a
   re-anchor before the pause, and a re-anchor after the pause (including the
   D1 shorter hot-swap from a `pause` listener inside a batch).
2. Clearing the outer holder after a nested batch: check the order against an
   inner `finishLocalEndPause` dispatch whose listener starts another nested
   batch.
3. The new §3.3 wording.

### Round 5 review

- Date: 2026-10-10
- Reviewer: `critic` (Fable), adversarial review of the round 5 tree
  (`git diff dffec0d -- packages/core docs/behavior CHANGELOG.md`; only
  `packages/core/src/timeline/TimelineEngine.ts`, its tests, and
  `docs/behavior/playback-v2.md` §3.3 changed since round 4). G1 Repro B and
  G2 were reproduced independently by the main session with a scratch test
  (observed logs match below, both ending in two `ended`, state `ended`). G3
  was confirmed by reading `TimelineEngine.test.ts:974` (real timers, no
  `dispose()`). All scratch files were deleted.
- Verdict: **changes_requested**. E1, E2, and E3 are fixed and re-verified,
  and no round 1–4 fix regressed. Three findings remain: G1 and G2 are **low**
  (the E2 class: a duplicate `ended` that needs two synchronous past-end pauses
  plus a synchronous `stop`, third-party `PlaybackTransport` only; deferring
  them with the "known limitation of synchronous transports" line is
  defensible). G3 is **medium** and is not a product bug: the new
  `vi.getTimerCount() === 0` assertions are flaky under the full core suite
  because a pre-existing real-timer test leaks a playing Engine, and the RC1E
  coverage gate runs that suite on every PR. G3 should be fixed before commit.

Harness (G1, G2): the test file's `ManualTransport` with synchronous `play`,
`seek`, `stop` (position 0) and a `pause` that reports
`positionMs + pauseOffsetMs` (the file's `LiveClockTransport`). bpm 60,
`lookaheadMs: 10`. "Tick at X" sets `snapshot.positionMs = X` then
`vi.advanceTimersByTimeAsync(10)`. Log format `type:previousState->state@positionMs`
and `cue:id@transportPositionMs`. Project "ZAB" = 2 beats with `z@0`, `a@1.5`,
`b@1.8`. `count(id)` is the per-id dispatch count in the cue listener.

#### G1 (low) — `finishLocalEndPause` announces `ended` again after a nested batch inside its own dispatch already announced it

- Where: `packages/core/src/timeline/TimelineEngine.ts:639-647`
  (`finishLocalEndPause`: `emitDueCues(durationMs)` then "announce if still
  `ended`"). The E2 fix at `:618-622` clears `pausedGeneration` of the holder
  that is *active in `runDispatch`*, but a `finishLocalEndPause` that is
  already past its holder check and is dispatching the remainder has no
  holder to clear, so a nested batch that starts inside that dispatch and is
  itself paused past end announces `ended`, and the caller announces a second
  time for a transition that `stop` superseded.
- Repro A (depth 3, the focus-2 case: an inner `finishLocalEndPause`
  dispatch whose listener starts another nested batch): project 2 beats with
  `z@0`, `m@0.5`, `a@1.5`, `b@1.8`. Cue listener: on `m` set
  `pauseOffsetMs = 2500` and `pause()` (the tick batch is paused past end);
  on `a` with `count === 1` call `stop(); play();` (this runs inside the
  batch's `finishLocalEndPause` dispatch and nests a batch); on `z` with
  `count === 2` set `pauseOffsetMs = 2500` and `pause()` (the nested batch is
  paused past end). `play()`; tick at 1000.
  - Observed: `["play:stopped->playing@0", "cue:z@0", "cue:m@1000",
    "pause:playing->ended@2000", "cue:a@2000", "stop:ended->stopped@0",
    "play:stopped->playing@0", "cue:z@0", "pause:playing->ended@2000",
    "cue:m@2000", "pause:ended->ended@2000", "cue:a@2000", "cue:b@2000",
    "ended:playing->ended@2000", "ended:playing->ended@2000"]`, state
    `ended`, 0 timers. Two `ended` for one transition.
  - Expected: one `ended` (the nested one). (The `pause:ended->ended` is the
    replayed `m` listener pausing again and is correct.)
- Repro B (depth 2, no tick batch involved): project ZAB. Cue listener: on
  `a` with `count === 1` call `stop(); play();`; on `z` with `count === 2`
  set `pauseOffsetMs = 2500` and `pause()`. `play()`; tick at 1000; then set
  `pauseOffsetMs = 1500` and `await engine.pause()` outside any batch (the
  pause branch at `:424-444` calls `finishLocalEndPause(true)` directly).
  - Observed: `["play", "cue:z@0", "pause:playing->ended@2000",
    "cue:a@2000", "stop:ended->stopped@0", "play:stopped->playing@0",
    "cue:z@0", "pause:playing->ended@2000", "cue:a@2000", "cue:b@2000",
    "ended:playing->ended@2000", "ended:playing->ended@2000"]`.
  - Control (replayed `z` does not pause): `[..., "play:stopped->playing@0",
    "cue:z@0"]`, state `playing`, one timer, no `ended`. Correct: the replay
    took over.
- Rule: §3.3 "then emits `ended`" and PB-EN-030 "then one ended"; §3.3 "a
  listener that ... stops ... takes over, and `ended` is not emitted".
- Regression: no (round 4 had the same shape). Reachability: third-party
  synchronous transport only; the built-in clock transport queues commands on
  `operationQueue`, so the replay never nests.
- Cause: the "owe an announcement" test is "the Engine is `ended` now", which
  cannot distinguish "still ended since my pause" from "left `ended` and
  ended again inside a nested batch that already announced".
- Fix shape (covers G2 as well): count batches instead of clearing holders.
  `private batchCount = 0;` incremented at the top of `runDispatch`. The
  pause branch captures `const batchCountAtPause = this.batchCount` next to
  `generation` (before `emitPlayback("pause")`), stores it in the holder
  (`{ pausedGeneration, pausedBatchCount }`) or passes it to
  `finishLocalEndPause(dispatchRemaining, batchCountAtPause)`, and
  `finishLocalEndPause` announces only when
  `this.batchCount === batchCountAtPause && !this.disposed && this.playbackState === "ended"`.
  The E2 `outerDispatch.pausedGeneration = null` line becomes redundant and can
  go. Checked by reading against D1 (shorter hot-swap runs no batch, so it
  still announces), E1 Repro B (the nested batch runs before the pause is
  captured, so it announces), E2 (outer count stale, inner current), and
  both G1 repros and G2.

#### G2 (low) — the pause branch marks the outer holder *after* the pause listeners run, undoing the E2 clear

- Where: `TimelineEngine.ts:431-438` (`generation` captured, then
  `emitPlayback("pause")`, then `this.activeDispatch.pausedGeneration = generation`).
- Repro: project ZAB. A `playback` listener on the **first** `pause` calls
  `stop(); play();`. Cue listener: on `a` with `count === 1` set
  `pauseOffsetMs = 1500` and `pause()`; on `z` with `count === 2` set
  `pauseOffsetMs = 2500` and `pause()`. `play()`; tick at 1600.
  - Observed: `["play", "cue:z@0", "cue:a@1600", "pause:playing->ended@2000",
    "stop:ended->stopped@0", "play:stopped->playing@0", "cue:z@0",
    "pause:playing->ended@2000", "cue:a@2000", "cue:b@2000",
    "ended:playing->ended@2000", "ended:playing->ended@2000"]`.
  - Control (replayed `z` does not pause): `[..., "play:stopped->playing@0",
    "cue:z@0"]`, state `playing`, no `ended`. Correct.
- Cause: the nested batch started by the `pause` listener runs inside
  `emitPlayback("pause")`, clears `outer.pausedGeneration` (E2 fix), returns,
  and then `:437` sets `outer.pausedGeneration = generation` (the stale
  generation). The outer `runDispatch` then calls
  `finishLocalEndPause(false)`, sees `ended`, and announces again.
- Regression: no. Reachability: third-party synchronous transport only.
- Fix shape: G1's batch count fixes this without reordering (the outer
  holder's `pausedBatchCount` is stale by one). The minimal alternative for
  G2 alone is to mark the holder before `emitPlayback("pause")` so the nested
  batch's clear wins, but that leaves G1.

#### G3 (medium, test flakiness) — the new `vi.getTimerCount() === 0` assertions fail intermittently under the full core suite

- Where: `packages/core/src/timeline/TimelineEngine.test.ts:974`
  ("stops delivering events to an unsubscribed listener", pre-existing at
  `dffec0d`, RC1D block) is the cause; the failing assertion observed was
  `:1546` (E1 test, `expect(vi.getTimerCount()).toBe(0)`), with `:916`,
  `:1387`, `:1458`, `:1598`, `:1635` equally exposed.
- Observed: `pnpm --filter @vixeq/core exec vitest run` failed 1 of 11 runs
  and `vitest run --coverage` failed 3 of 13 runs, always the same assertion:
  `AssertionError: expected 1 to be +0` at `:1546` (the cue log and
  `ended` state assertions before it pass). Running the Timeline file alone
  passed 8 of 8, so it depends on wall-clock load.
- Cause: the test at `:974` runs with real timers, calls `engine.play()` on a
  `createClockTransport(new FakeClock())`, and never disposes the Engine. The
  Engine's tick uses global `setTimeout` (`TimelineEngine.ts:570`, default
  `lookaheadMs` 25), the FakeClock never advances, so the Engine stays
  `playing` and re-arms a real 25 ms timer forever. Whenever that real timer
  fires inside a later test that has `vi.useFakeTimers()` installed (during
  any `await`), `tick()` re-schedules through the faked `setTimeout` and the
  fake clock gains one timer the test did not create. Mechanism reproduced in
  isolation: a two-test scratch file (A1 = play on a FakeClock transport with
  real timers, no dispose; A2 = fake timers, wait 120 ms real) reports
  `getTimerCount() === 1` in A2; the control with `engine.dispose()` in A1
  reports 0.
- Regression: the leak is pre-existing, but the `getTimerCount` assertions
  are new (rounds 3–5), so the suite is newly non-deterministic. With the
  RC1E coverage gate on PRs this will fail CI at random.
- Fix shape: `engine.dispose()` at the end of the `:974` test (or
  `vi.useFakeTimers()` there). The other real-timer tests in the file
  (`:506`, `:525`, `:655`, `:722`, `:735`, `:751`, `:830`) were read and
  leave no playing Engine. Optionally harden with an `afterEach` that
  disposes Engines created by the test, but the one-line fix suffices.

#### E1, E2, E3 and round 1–4 regressions

- E1: fixed. The seek-then-pause and `stop()`+`play()`-then-pause repros are
  the new test's two halves; both pass with the expected logs
  (`[..., "seek", "pause", "cue:r@4000", "ended"]` and
  `[..., "stop", "play", "cue:z@0", "pause", "cue:a@2000", "cue:b@2000", "ended"]`).
- E2: fixed for the reported shape (nested batch started from a *cue*
  listener of a paused tick batch): one `ended`. G1/G2 are the two
  neighbouring shapes the holder clear does not reach.
- E3: fixed; `:466` is wrapped and the new test passes with
  `["play", "cue:a0@0", "pause", "cue:b0@0", "cue:m@1000", "ended"]`.
- F1–F4, F5–F7, R1, R2/PB-EN-030, C1, D1–D3: all their tests pass (Timeline
  62/62, core 425/425 on passing runs). Arrangement and Sequencer sources are
  unchanged since round 3 (confirmed with `git diff --stat`).

#### Per-focus verdicts (round 5)

1. `pausedGeneration` predicate: **holds** in all three cases.
   - Completed batch: D3 test (`[..., "cue:p@3000", "pause", "cue:q@3000", "cue:r@4000", "ended"]`).
   - Re-anchor before the pause: E1 tests (above).
   - Re-anchor after the pause: scratch P1, cue `p` listener calls
     `pause()` (offset 2500, lands at 4500) then `seekPositionMs(3000)`:
     `["play", "cue:p@2000", "pause:playing->ended@4000", "seek:ended->paused@3000"]`,
     state `paused`, nothing dispatched, no `ended`, 0 timers. Correct: the
     seek took over.
   - D1 shorter hot-swap from a `pause` listener inside a batch: scratch P2,
     cue `x@1.5` pauses (offset 2500), `pause` listener calls
     `setProject(2 beats)`: `["play", "cue:x@2000", "pause:playing->ended@4000", "ended:playing->ended@2000"]`,
     exactly one `ended`, 0 timers. Correct.
2. Clearing the outer holder after a nested batch: **holds** for a nested
   batch that does not pause (G1 control and G2 control: the replay takes
   over, state `playing`, one legitimate timer, no `ended`) and for E2's
   shape. **Does not hold** when the nested batch starts from inside
   `finishLocalEndPause`'s own dispatch (G1, depth 2 or 3) or from the
   `pause` listener itself (G2): the duplicate `ended` returns.
3. §3.3 wording: accurate for the built-in transports and consistent with
   PB-EN-030 and the CHANGELOG, with one nit. "When a listener pauses during
   a dispatch, that dispatch finishes first (from where an earlier command in
   the same listener re-anchored it)" is not literally what happens in the
   E1 case: the batch is *abandoned* at the re-anchor and the local-end
   remainder is then dispatched from the re-anchored cursor. Suggested:
   "When a listener pauses during a dispatch, the local end is finished after
   that dispatch returns, from the cursor as an earlier command in the same
   listener left it, and nothing is dispatched twice." The "a command that
   the transport applies only later ... follows `ended` instead" sentence is
   correct (verified by reading `createClockTransport`'s `operationQueue`;
   this applies to `stop()` and seeks as well as replays, and "such as"
   leaves room for that). The CHANGELOG "each once" clause now holds for E1;
   in G1/G2 every cue is still dispatched once per playback, only `ended` is
   duplicated, so no CHANGELOG change is needed beyond whatever G1/G2's fix
   implies.

#### Candidates discarded after falsification (round 5)

- Re-anchor after the pause via `stop()`, `setLoop(true)`, `setProject(longer)`,
  or `dispose()` in the same cue listener: all bump the generation and leave
  the Engine non-`ended` (or disposed), so `finishLocalEndPause` neither
  dispatches nor announces. Reading plus the round 4 takeover table; P1 run.
- `pausedGeneration` captured before `emitPlayback("pause")` being stale
  when the `pause` listener re-anchors: that is the intended D1 path (skip
  the dispatch, announce if still `ended`); P2 confirms one `ended`.
- A completed batch whose `finishLocalEndPause` dispatch re-dispatches the
  batch: the cursor is moved at batch end before the remainder runs
  (`emitDueCues` sets `lastDispatchedRawPositionMs = toRawPositionMs`); D3's
  log shows `q@3000` once.
- `runDispatch` returning `false` on the pause path in a normal tick leaving
  the Engine without a timer when a nested replay set it `playing`: the
  tick's trailing `scheduleNextTick()` re-arms (clears and sets one timer);
  G1/G2 controls show exactly one timer and state `playing`.
- `activeDispatch` not restored on a throw: unchanged from round 4
  (`emit()` catches listener errors); not re-run.
- A second `pause()` from a cue listener in the remainder dispatch:
  `previousState === "ended"`, ignored (`pause:ended->ended` in G1 Repro A).
- The E3 nested variant (N4) was not separately re-run; the `:466` wrap puts
  it under the E1 predicate, and the E3 test passes.

#### Not run in round 5

`pnpm typecheck`, `pnpm build`, `pnpm api:check`, `pnpm behavior:check`, the
root `pnpm test` (react, player-react, playground, examples), and browser
E2E; the author's gate results were relied on. The reviewer did not restore
the round 4 logic to confirm the fail-before claim for the three new tests
(that would mean editing a tracked file). The three Engine rows of the core
coverage report were not individually re-read this round (summary line
`All files 96.41 | 95.74 | 97.66 | 96.41` on passing runs); round 4 verified
them, and only `TimelineEngine.ts` changed.

### Round 6 fix (G1, G2, G3, §3.3 nit)

Implemented on 2026-10-10. All findings were fixed at the user's request
(the reviewer's batch-count shape for G1 and G2). Uncommitted. Only
`TimelineEngine.ts`, its tests, and `playback-v2.md` §3.3 changed.

- `TimelineEngine.ts`:
  - New `batchCount`, incremented at the top of every `runDispatch()`. The
    pause branch captures a `LocalEndPause` (`{ generation, batchCount }`)
    **before** `emitPlayback("pause")`, and stores it in the holder
    (`{ pause: LocalEndPause | null }`) or passes it to
    `finishLocalEndPause(pause)` directly.
  - `finishLocalEndPause(pause)` dispatches the rest when the generation is
    unchanged (as in round 5), and announces `ended` only when the Engine is
    still `ended`, not disposed, **and no batch started since the pause**. A
    batch that started since then left `ended` and announces its own local
    end. This fixes G1 (a nested batch inside the remainder dispatch) and G2
    (a nested batch from the `pause` listener) without reordering.
  - The E2 `outerDispatch.pausedGeneration = null` clear is removed; the
    count covers it (the outer pause's count is stale after the nested batch).
- Tests (Timeline "RC1G re-entrancy" block):
  - "announces local end once when a replay during a local-end pause's
    dispatch is itself paused past local end" (G1 Repro B, then Repro A with
    the tick batch paused first).
  - "announces local end once when a pause listener's replay is itself paused
    past local end" (G2).
  - G3: "stops delivering events to an unsubscribed listener" now disposes
    its Engine at the end.
- Docs: `playback-v2.md` §3.3 takes the reviewer's wording (local end is
  finished after the dispatch returns, from the cursor as an earlier command
  left it) and adds that a replay that starts after the pause and reaches
  local end again announces `ended` once, for itself.

Fail-before: the announcement check without the batch count, with the E2
clear restored, was put back temporarily. Both new tests fail there
(2 failed / 62 passed). With the fix, 64 of 64 pass. The file was then
restored and confirmed identical (`cmp`).

G3: `vitest run --coverage` in `packages/core` passed 15 of 15 runs after
the fix (the reviewer saw 3 of 13 fail before it). The flake was not
reproduced locally before the fix, so this shows the absence of failures,
not a before/after pair.

Gates (repository root): `pnpm typecheck`, `pnpm build`, `pnpm test` (core
427, react 36, player-react 8, playground 11, cycling-workout example 5),
`pnpm test:coverage` (exit 0; the three Engines at 100% statements, branches,
functions, and lines), `pnpm api:check`, and `pnpm behavior:check` (192
covered) all pass. Not run: browser E2E and pack smoke (no packaging or
browser-facing change).

Review focus for round 6:

1. The batch-count announcement rule against every earlier `ended` case
   (PB-EN-030, C1, D1 shorter hot-swap, D2 dispose, D3, E1 Repro A/B, E2,
   E3) and the two new tests.
2. A batch that starts since the pause but does **not** leave `ended` (if
   any path can do that), which would now suppress a still-owed `ended`.
3. The new §3.3 sentences.

### Round 6 review

- Date: 2026-10-10
- Reviewer: `critic` (Fable), adversarial review of the round 6 tree
  (`git diff dffec0d -- packages/core docs/behavior CHANGELOG.md`; since round
  5 only `TimelineEngine.ts`, its tests, and `playback-v2.md` §3.3 changed).
  The fix shape for H1 was validated on a scratch *copy* of the Engine with a
  copy of the full test file pointed at it. H1 (the out-of-batch variant) was
  reproduced independently by the main session with a scratch test (observed
  `pause`, `seek`, `ended` (from `paused`), `ended` (from `playing`), state
  `ended`). No tracked file was edited; all scratch files were deleted.
- Verdict: **changes_requested (low)**. G1, G2, and G3 are fixed and
  re-verified, and no round 1–5 fix regressed (Timeline 64/64, core 427/427
  on 11 of 11 runs, 7 of them with `--coverage`). One finding, H1, remains. It
  is the focus-2 "reverse" case: a listener leaves `ended` and re-enters it
  without a batch, through a path that announces `ended` itself. Its class and
  reachability are the same as G1/G2: two synchronous re-anchoring commands
  from one listener, on a third-party synchronous `PlaybackTransport` only.
  Deferring it with the "known limitation of synchronous transports" line is
  defensible. Fixing it is a one-counter change that also removes
  `batchCount`.

Log format: `type:previousState->state@positionMs`,
`cue:id@transportPositionMs`. bpm 60, `lookaheadMs: 10`. "Tick at X" = set
`snapshot.positionMs = X`, `advanceTimersByTimeAsync(10)`. Harness: the test
file's `ManualTransport`/`LiveClockTransport` (synchronous `play`/`seek`/`stop`,
`pause` reports `positionMs + pauseOffsetMs`).

#### H1 (low) — a pause listener that seeks away and then shortens the Project announces `ended` twice

- Where: `packages/core/src/timeline/TimelineEngine.ts:656-660`
  (`finishLocalEndPause`: the announce predicate
  `!disposed && playbackState === "ended" && batchCount === pause.batchCount`).
  `batchCount` detects "left `ended` via a batch". It does not detect "left
  `ended` via a command and re-entered it via a command that already announced
  `ended`" (`setProject` shorter from `paused`, `:322-326`).
- Repro: project 4 beats with `a@3.5`; `shorter` = 2 beats, no cues. A
  `playback` listener on the **first** `pause` runs
  `void engine.seekPositionMs(3000); engine.setProject(shorter);`. `play()`;
  tick at 3000; `pauseOffsetMs = 1500`; `await engine.pause()` (lands at 4500,
  past end, outside any batch).
  - Observed: `["play:stopped->playing@0", "pause:playing->ended@4000",
    "seek:ended->paused@3000", "ended:paused->ended@2000",
    "ended:playing->ended@2000"]`, state `ended`, 0 timers.
  - Expected: `[..., "seek:ended->paused@3000", "ended:paused->ended@2000"]`.
    The seek took over the pause's local end (§3.3: "A listener that seeks ...
    takes over, and `ended` is not emitted"). The shorter hot-swap from
    `paused` announces its own `ended` (§3.3 "shortened below current position
    ... enter `ended`"). The trailing `ended:playing->ended` is a stale
    announcement of a transition that the seek superseded.
  - The same happens when a cue listener inside the local-end tick takes the
    pause (project 4 beats, `a@3.2`, tick at 4500, cue `a` pauses with offset
    0): `["play", "cue:a@4000", "pause:playing->ended@4000",
    "seek:ended->paused@3000", "ended:paused->ended@2000",
    "ended:playing->ended@2000"]`.
  - Control (D1: the pause listener calls only `setProject(shorter)`):
    `["play", "pause:playing->ended@4000", "ended:playing->ended@2000"]`. One
    `ended`, correct.
- Cause: the pause's `generation` is stale after the seek, so the remainder
  dispatch is correctly skipped. The announce predicate checks only state and
  batch count. No batch ran and the Engine is `ended` again, so it announces.
  The same shape with `setLoop(true); setLoop(false)` yields exactly one
  `ended` today only because `setLoop(false)` from `paused` is silent (`:276`,
  `previousState === "playing"` guard).
- Regression: no. Rounds 4 and 5 had the same shape, and round 5's holder
  clear would also have announced. Reachability: third-party synchronous
  transport only. On the built-in clock transport the seek is queued, so
  `setProject(shorter)` runs while the Engine is still `ended` (no
  announcement of its own). `finishLocalEndPause` announces once, and the
  later seek lands at 3000 ≥ 2000 as a silent `seek:ended->ended`: one `ended`
  in total.
- Fix shape (validated on the scratch copy: Timeline 64/64 pass, both H1
  variants become one `ended`, all G1/G2 tests still pass): replace the batch
  count with an "exited `ended`" counter.
  - Wrap `applyTransportSnapshot`:
    `const wasEnded = this.playbackState === "ended"; <existing body>; if (wasEnded && this.playbackState !== "ended") this.endedExits += 1;`.
    Every exit from `ended` (seek, stop, play/replay, seek-as-play,
    `setLoop(true)`, `setProject(longer)`) goes through it.
  - `LocalEndPause` carries `endedExits`, captured next to `generation`.
    `finishLocalEndPause` announces when
    `!disposed && playbackState === "ended" && endedExits === pause.endedExits`.
  - `batchCount` and the `batchCount` field of `LocalEndPause` become
    redundant: a nested replay batch always leaves `ended` (play path
    `:426-432`, seek-as-play `:474-480`), which is what the count was standing
    in for.
  - Checked against PB-EN-030, C1, D1 (a shorter hot-swap never leaves
    `ended`: announces), D2, D3, E1 A/B (the re-anchor runs before the pause is
    captured: announces), E2, E3, G1 A/B, and G2 (all leave `ended` through the
    replay: the outer announcement is suppressed, and the nested batch
    announces its own).
  - One behavioral consequence to decide on: a pause listener that does
    `setLoop(true); setLoop(false)` (leaves `ended`, re-enters it silently)
    goes from one `ended` today to zero. That matches the existing rule that
    `setLoop(false)` from `paused` is silent, but it is a change. If it is
    unwanted, the narrower alternative is to keep `batchCount` and add a
    counter bumped at every `emitPlayback("ended", ...)` call site, announcing
    only when neither changed.
  - Add H1 as a test next to the G2 test.

#### Per-focus verdicts (round 6)

1. Batch-count rule against the earlier `ended` cases: **holds** for every
   listed case. Read against the code and confirmed by the existing tests
   passing: PB-EN-030 (three tests), C1, D1 (both halves, scratch control
   above), D2 (`disposed` short-circuits), D3, E1 Repro A/B (the seek /
   `stop(); play()` run before the pause is captured, so `pause.batchCount`
   already includes the nested batch), E2, E3, G1 Repro A (depth 3) and B, G2.
   Also run: the depth-2 variant where the *remainder* dispatch's cue listener
   does `stop(); play();` and then pauses past end in the same listener (the
   nested batch completes, and the second pause lands with
   `activeDispatch === null` and finishes directly). One `ended`, state
   `ended`, 0 timers. Correct.
2. A batch after the pause that does not leave `ended`: **none found**. Every
   `runDispatch` caller leaves `ended` first:
   - the play path reaches the batch only after the
     `playbackState === "ended"` early return at `:418-423`;
   - seek-as-play applies a position-0 playing snapshot with `projectAnchor`
     cleared;
   - both tick batches require `playing`;
   - nothing else calls it.
   A nested batch that re-enters `ended` *silently* (the replayed `z` listener
   seeks to exactly `durationMs`) yields `[..., "stop", "play", "cue:z@0",
   "seek:playing->ended@2000"]` with no `ended`. That matches the pre-existing
   rule (control: a playing Engine seeking to exactly `durationMs` logs only
   `seek:playing->ended`; state table "ended | seek to end | ended"). The
   reverse (leave `ended` and re-enter it without a batch) is **H1** above.
3. §3.3: accurate to the implementation for the built-in transports, and
   consistent with PB-EN-030 in the matrix and with the CHANGELOG. "When a
   listener pauses during a dispatch, local end is finished after that
   dispatch returns, from the cursor as an earlier command in the same
   listener left it, and nothing is dispatched twice" matches
   `runDispatch`/`finishLocalEndPause` (the batch is not cut short, the
   remainder dispatch is skipped on a stale generation, and the cursor moves at
   batch end). "A replay that starts after the pause and reaches local end
   again announces `ended` once, for itself" matches G1/G2. "A listener that
   seeks ... takes over, and `ended` is not emitted" is what H1 violates on a
   synchronous transport: the doc is right and the code is not. One wording
   nuance, not a finding: a pause listener that seeks to exactly the local end
   (`seek:ended->ended@4000`) does get `ended:playing->ended` afterwards,
   because the Engine never left `ended`. "Seeks" in that sentence implicitly
   means a seek that leaves `ended`. No CHANGELOG change is needed for H1
   beyond the existing text (cues are still each-once; only `ended` is
   duplicated).
4. G3: **closed**. Core suite 4/4 green (427). Core coverage 6/6 green with
   the reviewer's `--exclude` flag and 1/1 without (summary
   `All files 96.4 | 95.74 | 97.66 | 96.4`, matching round 5). Leak audit:
   - Timeline's real-timer tests: `:506` (disposes), `:525`/`:655` (transport
     disposed, no play), `:536`/`:830` (no play), `:722` (seek only), `:735`
     (Engine disposed inside the play event), `:751` (ends in `ended`, no
     timer), `:974` (now disposed). None leaves a playing Engine.
   - Every `describe` in `ArrangementEngine.test.ts` (`:142`, `:555`, `:979`)
     and `SequencerEngine.test.ts` (`:159`, `:692`, `:945`) installs fake
     timers in `beforeEach` and restores them in `afterEach`, and no `it` sits
     outside a `describe`. No other core test file constructs an Engine.
   - The built-in clock transport schedules through `clock.setTimer`
     (`playbackTransport.ts:193`), not the global `setTimeout`, so it cannot
     inject a timer either.

#### G1, G2, G3 and round 1–5 regressions

- G1: fixed. Both repros are the new test's two iterations. Repro A observed
  `[..., "cue:a@2000", "stop", "play", "cue:z@0", "pause", "cue:m@2000", "pause", "cue:a@2000", "cue:b@2000", "ended"]`.
- G2: fixed. The new test passes with one `ended`: the stale outer
  `batchCount` suppresses the outer announcement even though the holder is
  marked after the listeners ran.
- G3: fixed (above). F1–F7, R1, R2/PB-EN-030, C1, D1–D3, and E1–E3: all their
  tests pass on every run. The Arrangement and Sequencer sources are unchanged
  since round 3.

#### Candidates discarded after falsification (round 6)

- A nested replay whose cue listener seeks to exactly `durationMs` (silent
  re-entry into `ended`; the batch count changed, so there is no announcement
  at all): consistent with the pre-existing silent seek-to-end rule. Control
  run above.
- A pause listener that seeks to exactly `durationMs` (`seek:ended->ended`,
  then `ended:playing->ended`): the Engine never left `ended`, so the pause's
  transition stands. A doc nuance only (focus 3).
- A pause listener that calls `transport.play()` directly with the position
  still past end: `["pause:playing->ended", "ended:ended->ended",
  "ended:playing->ended"]`, two `ended`. The built-in async path also yields
  two (`ended:playing->ended`, then the pre-existing "resume past end
  re-announces `ended`" of test `:751`), so RC1G does not change the count.
- A pause listener that disposes the *transport* (not the Engine):
  `["pause", "error:ended->ended", "ended:playing->ended"]`. The Engine stays
  `ended` at the local end and nothing took over, so one `ended` is right.
- A pause listener that runs `setLoop(true); setLoop(false)`: one `ended`
  (`setLoop(false)` from `paused` is silent, then `finishLocalEndPause`
  announces). Correct today; see the note in H1's fix shape.
- Two pauses in one batch overwriting `activeDispatch.pause`: the second has
  `previousState === "ended"`, so `reachedLocalEnd` is false and it never
  writes the holder.
- `activeDispatch` not restored on a throw: unchanged since round 4 (`emit()`
  catches listener errors). Not re-run.
- `batchCount` wrap-around / overflow: not reachable.

#### Not run in round 6

`pnpm typecheck`, `pnpm build`, `pnpm api:check`, `pnpm behavior:check`, the
root `pnpm test` (react, player-react, playground, examples), and browser E2E;
the author's gate results were relied on. The three Engine rows of the
coverage report were not re-read individually (only the `All files`
summary); only `TimelineEngine.ts` changed, and the summary matches round 5.
The Arrangement side of §3.3's generic "When a listener pauses during a
dispatch ..." wording was not re-verified this round (Arrangement is
unchanged since round 3, where it was reviewed). The fail-before claim for
the two new tests was not reproduced, because that would mean editing a
tracked file; the H1 fix shape was validated on a scratch copy instead.

### Round 7 fix (H1)

Implemented on 2026-10-11. H1 was fixed at the user's request, in the
reviewer's "exited `ended`" shape. Uncommitted. Only `TimelineEngine.ts`, its
tests, and `playback-v2.md` §3.3 changed.

- `TimelineEngine.ts`:
  - `batchCount` is replaced by `endedExits`. `applyTransportSnapshot()` now
    wraps the old body (moved to `applySnapshotState()`) and counts each
    transition out of `ended`. Every state change other than the tick's
    local end and the playing → paused assignment goes through it, so every
    exit from `ended` is counted (seek, stop, play/replay, seek-as-play,
    `setLoop(true)`, `setProject(longer)`).
  - `LocalEndPause` is `{ generation, endedExits }`, still captured before
    the `pause` listeners run. `finishLocalEndPause` announces only when the
    Engine is still `ended`, not disposed, and has not left `ended` since the
    pause. `runDispatch` no longer counts anything.
  - Behavior change the reviewer flagged: a pause listener that runs
    `setLoop(true); setLoop(false)` now gets no `ended` (was one). Enabling
    loop took over, as §3.3 already says, and disabling it from `paused` is
    silent.
- Test: "does not announce a pause's local end after a pause listener moved
  the Engine out of ended and back". It covers H1 outside a batch, H1 with
  the pause taken by a cue listener in the local-end tick, and the
  `setLoop(true); setLoop(false)` case.
- Docs: §3.3 replaces the replay-only sentence with a general one: a
  listener that takes over and then returns the Engine to `ended` gets only
  what that later command emits on its own. A replay that reaches local end
  again, or a shorter hot-swap, announces `ended` once, and disabling loop
  again from `paused` stays silent.

Fail-before: the round 6 rule was restored in place temporarily (the counter
bumped per `runDispatch` instead of per exit from `ended`). The new test
fails there (1 failed / 64 passed), and the G1/G2/E2 tests still pass. With
the fix, 65 of 65 pass. The file was restored and confirmed identical
(`cmp`).

Gates (repository root): `pnpm typecheck`, `pnpm build`, `pnpm test` (core
428, react 36, player-react 8, playground 11, cycling-workout example 5),
`pnpm test:coverage` (exit 0; the three Engines at 100% statements, branches,
functions, and lines), `pnpm api:check`, and `pnpm behavior:check` (192
covered) all pass. `vitest run --coverage` in `packages/core`: 10 of 10
green. Not run: browser E2E and pack smoke (no packaging or browser-facing
change).

Review focus for round 7:

1. The exit counter against every earlier `ended` case (PB-EN-030, C1,
   D1–D3, E1–E3, G1, G2) and H1.
2. Any exit from `ended` that bypasses `applyTransportSnapshot()`, and any
   `applyTransportSnapshot()` call that leaves `ended` only transiently
   inside one call path, which would suppress a still-owed `ended`.
3. The new §3.3 sentence.

### Round 7 review

- Date: 2026-10-11
- Reviewer: `critic` (Fable). Regression-only review of the round 7 change
  (the `endedExits` counter replacing `batchCount`), scoped by the user as
  the final round. New shapes in the third-party synchronous transport class
  (D3/E/G/H) were explicitly out of scope. Scratch repros ran on the built-in
  `createClockTransport` with a `FakeClock`, both against the working tree
  and against a scratch *copy* of the Engine with the round 6 rule restored,
  so the round 6 baseline was measured rather than read. No tracked file was
  edited, and all scratch files were deleted.
- Verdict: **approve**. No regression was found. The only built-in-transport
  sequences that differ from round 6 are the ones the round 7 fix declares
  and §3.3 documents. `setLoop` and `setProject` are synchronous Engine
  commands, so these differences are reachable on every transport. They are
  therefore recorded in the CHANGELOG as well.

Log format: `type:previousState->state@positionMs`. bpm 60, `lookaheadMs: 10`,
project 4 beats with `a@3.2`, `createClockTransport(new FakeClock())`. Steps:
`play()`; clock to 3000 and one tick; clock to 4500; `await engine.pause()`;
then `advanceTimersByTimeAsync(50)` to drain queued commands.

#### Findings

None.

#### Built-in transport: round 7 vs the round 6 baseline

Unchanged: S1 plain pause past end (`pause`, `cue:a`, `ended`); S4 a pause
listener's queued `play()` follows `ended`; S5 the H1 shape (the seek is
queued, so there is one `ended` on both rounds); S6 `setProject(longer)`
(no `ended`); S7 transport `durationMs` equal to the project duration (the
transport's own `ended` wins); S8 a queued `pause()` from a cue listener in
the local-end tick; S9 `setLoop(true)` only.

Changed, as documented:

- S2: a pause listener's `setLoop(true); setLoop(false)` emitted one `ended`
  in round 6 and emits none in round 7. The state is `ended` on both rounds.
- S3: a pause listener's `setProject(longer); setProject(shorter)` emitted
  two `ended` in round 6 and emits one in round 7. This is an H1-shaped
  improvement that was reachable on the built-in transport in round 6.
- S10: S2 followed by a queued `play()` is consistent with S2.
- S11: the same `setLoop` pair from a cue listener inside the remainder
  dispatch is consistent with S2.

The pre-existing rule that `setLoop(false)` into `ended` from `paused` emits
no `ended` (the `previousState === "playing"` guard) now covers the pause
case as well. The reviewer considers this an accepted, documented trade, not
a regression.

#### Per-focus verdicts (round 7)

1. Built-in transports: **no regression**. Every exit from `ended` goes
   through `applyTransportSnapshot()`. The only other `playbackState` writes
   are `handleTransportDispose` (playing → paused) and the local-end tick
   (→ ended), and neither leaves `ended`. Each command or event path applies
   the snapshot exactly once. The built-in transports (clock, media element,
   AudioBuffer) all apply their commands through `enqueue`, so they never
   re-enter the Engine synchronously. The pause capture is never off by one:
   on the `reachedLocalEnd` path, the pause's own snapshot can only be
   playing → ended.
2. Earlier cases: **all hold**. PB-EN-030, C1, D1–D3, E1–E3, G1, G2, and H1
   were checked by their tests (Timeline 65/65 within core 428/428) and by
   reading them against the new predicate.
3. §3.3: **accurate for the built-in transports**. The instances reachable on
   the built-ins are S2/S11 (loop-off stays silent) and S3 (a shorter
   hot-swap announces once).
4. Core `vitest run` passed 3/3 and core coverage 2/2, with the three Engines
   at 100%. `tsc --noEmit -p packages/core` is clean.

#### Out of scope (known-limitation class)

Nothing new was observed. The class is closed by the "Known limitation" item
added to `playback-v2.md` §3.3.

#### Not run in round 7

The root gates other than core tests, coverage, and `tsc`; browser E2E; and
pack smoke. The author's gate results were relied on for those. Arrangement
and Sequencer were not re-read (unchanged since round 3).

### Closure

RC1G is `done` (2026-10-11). The user decided that round 7 would be the final
review, limited to regressions. The remaining third-party synchronous
transport class is documented as a known limitation in `playback-v2.md` §3.3.
Next: RC1H.
