import { describe, expect, it } from "vitest";
import { SequencerEngine } from "./SequencerEngine";
import { createProject, setStepValue } from "./project";
import type { PlaybackClock, StepEvent } from "./types";

class FakeClock implements PlaybackClock {
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
}

describe("SequencerEngine", () => {
  it("emits every sixteenth step at the configured BPM", () => {
    const clock = new FakeClock();
    let project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    project = setStepValue(project, project.tracks[0].id, 0, 1);
    project = setStepValue(project, project.tracks[0].id, 1, 0.5);

    const events: StepEvent[] = [];
    const engine = new SequencerEngine(project, { clock, lookaheadMs: 10 });
    engine.on("step", (event) => events.push(event));

    engine.start();
    clock.advance(375);

    expect(events.map((event) => event.stepIndex)).toEqual([0, 1, 2, 3]);
    expect(events.map((event) => event.timestamp)).toEqual([0, 125, 250, 375]);
    expect(events[0].tracks[0].value).toBe(1);
    expect(events[1].tracks[0].value).toBe(0.5);
  });

  it("applies BPM changes from the next scheduled step", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const events: StepEvent[] = [];
    const engine = new SequencerEngine(project, { clock, lookaheadMs: 10 });
    engine.on("step", (event) => events.push(event));

    engine.start();
    clock.advance(125);
    engine.setBpm(60);
    clock.advance(250);

    expect(events.map((event) => event.stepIndex)).toEqual([0, 1, 2]);
    expect(events.map((event) => event.timestamp)).toEqual([0, 125, 375]);
    expect(events[1].bpm).toBe(120);
    expect(events[2].bpm).toBe(60);
  });

  it("emits missed steps by default", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const events: StepEvent[] = [];
    const engine = new SequencerEngine(project, { clock, lookaheadMs: 500 });
    engine.on("step", (event) => events.push(event));

    engine.start();
    clock.currentTime = 500;
    clock.timers.shift()?.callback();

    expect(events.map((event) => event.stepIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it("can skip missed steps", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const events: StepEvent[] = [];
    const engine = new SequencerEngine(project, {
      clock,
      lookaheadMs: 500,
      missedStepPolicy: "skip",
    });
    engine.on("step", (event) => events.push(event));

    engine.start();
    clock.currentTime = 500;
    clock.timers.shift()?.callback();

    expect(events.map((event) => event.stepIndex)).toEqual([0, 4]);
  });

  it("keeps the current step within range when project changes", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const engine = new SequencerEngine(project, { clock, lookaheadMs: 10 });

    engine.reset(15);
    engine.setProject(createProject({ bpm: 90, stepCount: 8, trackCount: 1 }));

    expect(engine.getCurrentStepIndex()).toBe(7);
    expect(engine.getProject().bpm).toBe(90);
  });

  it("uses stepsPerBeat=2 to produce 250ms steps at 120BPM", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 4, stepsPerBeat: 2, trackCount: 1 });
    const events: StepEvent[] = [];
    const engine = new SequencerEngine(project, { clock, lookaheadMs: 10 });
    engine.on("step", (event) => events.push(event));

    engine.start();
    clock.advance(750);

    expect(events.map((e) => e.timestamp)).toEqual([0, 250, 500, 750]);
    expect(events[0].durationMs).toBeCloseTo(250);
  });

  it("defaults stepsPerBeat to 4 (125ms at 120BPM)", () => {
    const clock = new FakeClock();
    const project = createProject({ bpm: 120, stepCount: 2, trackCount: 1 });
    const events: StepEvent[] = [];
    const engine = new SequencerEngine(project, { clock, lookaheadMs: 10 });
    engine.on("step", (event) => events.push(event));

    engine.start();
    clock.advance(125);

    expect(events[0].durationMs).toBeCloseTo(125);
  });

  it("populates nextValue with the next step value (wrapping at end)", () => {
    const clock = new FakeClock();
    let project = createProject({ bpm: 120, stepCount: 3, trackCount: 1 });
    const trackId = project.tracks[0].id;
    project = setStepValue(project, trackId, 0, 0.1);
    project = setStepValue(project, trackId, 1, 0.5);
    project = setStepValue(project, trackId, 2, 0.9);

    const events: StepEvent[] = [];
    const engine = new SequencerEngine(project, { clock, lookaheadMs: 10 });
    engine.on("step", (event) => events.push(event));

    engine.start();
    clock.advance(374);

    // step 0 → nextValue should be step 1; step 2 → nextValue should wrap to step 0
    expect(events[0].tracks[0].value).toBeCloseTo(0.1);
    expect(events[0].tracks[0].nextValue).toBeCloseTo(0.5);
    expect(events[1].tracks[0].nextValue).toBeCloseTo(0.9);
    expect(events[2].tracks[0].nextValue).toBeCloseTo(0.1);
  });

  it("sets nextValue to 0 for disabled tracks", () => {
    const clock = new FakeClock();
    let project = createProject({ bpm: 120, stepCount: 2, trackCount: 1 });
    const trackId = project.tracks[0].id;
    project = setStepValue(project, trackId, 0, 1);
    project = setStepValue(project, trackId, 1, 1);
    project = { ...project, tracks: project.tracks.map((t) => ({ ...t, enabled: false })) };

    const events: StepEvent[] = [];
    const engine = new SequencerEngine(project, { clock, lookaheadMs: 10 });
    engine.on("step", (event) => events.push(event));

    engine.start();
    clock.advance(125);

    expect(events[0].tracks[0].value).toBe(0);
    expect(events[0].tracks[0].nextValue).toBe(0);
  });
});
