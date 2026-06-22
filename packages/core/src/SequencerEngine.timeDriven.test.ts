import { describe, expect, it } from "vitest";
import { SequencerEngine } from "./SequencerEngine";
import { createProject, setStepValue } from "./project";
import { easeOutQuad } from "./easing";
import type { SequencerClock, StepEvent } from "./types";

class FakeClock implements SequencerClock {
  currentTime = 0;
  timers: Array<{ id: number; callback: () => void; dueAt: number }> = [];
  private nextId = 1;

  now(): number {
    return this.currentTime;
  }

  setTimer(callback: () => void, delayMs: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.push({ id, callback, dueAt: this.currentTime + delayMs });
    return id;
  }

  clearTimer(timerId: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== timerId);
  }

  advance(ms: number): void {
    const target = this.currentTime + ms;

    while (true) {
      this.timers.sort((a, b) => a.dueAt - b.dueAt);
      const nextTimer = this.timers[0];
      if (!nextTimer || nextTimer.dueAt > target) {
        break;
      }

      this.timers.shift();
      this.currentTime = nextTimer.dueAt;
      nextTimer.callback();
    }

    this.currentTime = target;
  }

  jumpTo(ms: number): void {
    this.currentTime = ms;
  }
}

// 120 BPM, 4 stepsPerBeat → stepDuration = 60000/120/4 = 125ms
const STEP_MS = 125;

describe("SequencerEngine — time-driven mode", () => {
  it("emits step 0 immediately on start", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const events: StepEvent[] = [];

    const engine = new SequencerEngine(project, { clock, timeDriven: true, lookaheadMs: 10 });
    engine.on("step", (e) => events.push(e));
    engine.start();

    // After start, tick fires immediately and should emit step 0
    clock.advance(1);
    expect(events.length).toBe(1);
    expect(events[0].stepIndex).toBe(0);
  });

  it("emits each step at the correct boundary", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const events: StepEvent[] = [];

    const engine = new SequencerEngine(project, { clock, timeDriven: true, lookaheadMs: 10 });
    engine.on("step", (e) => events.push(e));
    engine.start();
    clock.advance(STEP_MS * 4);

    expect(events.map((e) => e.stepIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it("wraps stepIndex correctly at stepCount boundary", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    const events: StepEvent[] = [];

    const engine = new SequencerEngine(project, { clock, timeDriven: true, lookaheadMs: 10 });
    engine.on("step", (e) => events.push(e));
    engine.start();
    clock.advance(STEP_MS * 8);

    // steps: 0,1,2,3,0,1,2,3,0
    const indices = events.map((e) => e.stepIndex);
    expect(indices[0]).toBe(0);
    expect(indices[4]).toBe(0);
    expect(indices[8]).toBe(0);
  });

  it("does not re-emit the same step on polling within the same step window", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const events: StepEvent[] = [];

    const engine = new SequencerEngine(project, { clock, timeDriven: true, lookaheadMs: 10 });
    engine.on("step", (e) => events.push(e));
    engine.start();
    // Move to mid-step, then advance tiny amounts
    clock.advance(10);
    clock.advance(10);
    clock.advance(10);

    // Still within step 0: should be exactly 1 event
    expect(events.length).toBe(1);
    expect(events[0].stepIndex).toBe(0);
  });

  it("emits only the landing step on forward seek (no replay of skipped steps)", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const events: StepEvent[] = [];

    const engine = new SequencerEngine(project, { clock, timeDriven: true, lookaheadMs: 10 });
    engine.on("step", (e) => events.push(e));
    engine.start();
    clock.advance(1); // emit step 0

    const before = events.length;
    // Jump forward 10 steps (1250ms)
    clock.jumpTo(STEP_MS * 10 + 5);
    clock.timers.shift()?.callback(); // fire pending timer

    const after = events.length;
    // Should emit exactly 1 more event (the landing step), not 10
    expect(after - before).toBe(1);
    expect(events[events.length - 1].stepIndex).toBe(10);
  });

  it("emits the landing step on backward seek", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const events: StepEvent[] = [];

    const engine = new SequencerEngine(project, { clock, timeDriven: true, lookaheadMs: 10 });
    engine.on("step", (e) => events.push(e));
    engine.start();
    clock.advance(STEP_MS * 5); // get to step 5

    // Seek back to step 2
    clock.jumpTo(STEP_MS * 2 + 5);
    clock.timers.shift()?.callback();

    expect(events[events.length - 1].stepIndex).toBe(2);
  });

  it("reset() re-anchors origin so the next step after reset is 0", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const events: StepEvent[] = [];

    const engine = new SequencerEngine(project, { clock, timeDriven: true, lookaheadMs: 10 });
    engine.on("step", (e) => events.push(e));
    engine.start();
    clock.advance(STEP_MS * 3); // runs through steps 0-3

    const countBefore = events.length;
    engine.reset(0); // re-anchor: originMs = now - 0*stepDur = 375

    // Advance past the next pending timer (lookaheadMs=10, so timer fires within 10ms)
    clock.advance(15);
    // The next emitted step after reset should be step 0
    const firstAfterReset = events[countBefore];
    expect(firstAfterReset.stepIndex).toBe(0);
  });

  it("respects originMs option — step 0 fires at originMs, not 0", () => {
    const clock = new FakeClock();
    clock.jumpTo(1000);
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const events: StepEvent[] = [];

    const engine = new SequencerEngine(project, {
      clock,
      timeDriven: true,
      originMs: 1000,
      lookaheadMs: 10,
    });
    engine.on("step", (e) => events.push(e));
    engine.start();
    clock.advance(1);

    expect(events[0].stepIndex).toBe(0);
    clock.advance(STEP_MS);
    expect(events[events.length - 1].stepIndex).toBe(1);
  });

  it("existing increment mode still works with default options", () => {
    const clock = new FakeClock();
    let project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    project = setStepValue(project, project.tracks[0].id, 0, 1);

    const events: StepEvent[] = [];
    const engine = new SequencerEngine(project, { clock, lookaheadMs: 10 });
    engine.on("step", (e) => events.push(e));
    engine.start();
    clock.advance(375);

    expect(events.map((e) => e.stepIndex)).toEqual([0, 1, 2, 3]);
  });
});

describe("SequencerEngine — sampleChannels", () => {
  it("returns 0 for disabled tracks", () => {
    const clock = new FakeClock();
    let project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    project = { ...project, tracks: project.tracks.map((t) => ({ ...t, enabled: false })) };

    const engine = new SequencerEngine(project, { clock });
    const result = engine.sampleChannels(0);
    expect(Object.values(result).every((v) => v === 0)).toBe(true);
  });

  it("interpolates between value and nextValue at mid-step", () => {
    const clock = new FakeClock();
    let project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    const trackId = project.tracks[0].id;
    // step 0 = 0, step 1 = 1
    project = setStepValue(project, trackId, 0, 0);
    project = setStepValue(project, trackId, 1, 1);

    const engine = new SequencerEngine(project, { clock });
    // At t=0 (start of step 0): should be lerp(0, 1, 0) = 0
    expect(engine.sampleChannels(0)[trackId]).toBeCloseTo(0);
    // At t=62.5ms (half of 125ms step 0): lerp(0,1,0.5) = 0.5
    expect(engine.sampleChannels(STEP_MS / 2)[trackId]).toBeCloseTo(0.5);
    // At t=125ms (start of step 1): lerp(1, step2=0, 0) = 1
    expect(engine.sampleChannels(STEP_MS)[trackId]).toBeCloseTo(1);
  });

  it("accepts a custom easing function", () => {
    const clock = new FakeClock();
    let project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    const trackId = project.tracks[0].id;
    project = setStepValue(project, trackId, 0, 0);
    project = setStepValue(project, trackId, 1, 1);

    const engine = new SequencerEngine(project, { clock });
    const linear = engine.sampleChannels(STEP_MS / 2)[trackId];
    const eased = engine.sampleChannels(STEP_MS / 2, easeOutQuad)[trackId];
    // easeOutQuad(0.5) = 0.75, linear = 0.5
    expect(eased).toBeGreaterThan(linear);
    expect(eased).toBeCloseTo(0.75);
  });

  it("wraps correctly beyond stepCount", () => {
    const clock = new FakeClock();
    let project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    const trackId = project.tracks[0].id;
    project = setStepValue(project, trackId, 0, 1);

    const engine = new SequencerEngine(project, { clock });
    // t = 4 * STEP_MS = one full loop, should be back at step 0
    expect(engine.sampleChannels(STEP_MS * 4)[trackId]).toBeCloseTo(1);
  });

  it("works with a custom originMs", () => {
    const clock = new FakeClock();
    let project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    const trackId = project.tracks[0].id;
    project = setStepValue(project, trackId, 0, 1);

    const engine = new SequencerEngine(project, { clock, originMs: 1000 });
    // t=1000 is step 0 start
    expect(engine.sampleChannels(1000)[trackId]).toBeCloseTo(1);
    // t<1000 returns step 0 (clamped)
    expect(engine.sampleChannels(500)[trackId]).toBeCloseTo(1);
  });
});
