import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SequencerEngine } from "./SequencerEngine";
import { createClockTransport, type PlaybackTransport } from "./playbackTransport";
import { createProject, setProjectBpm, setStepValue } from "./project";
import { easeOutQuad } from "./easing";
import type { EnginePlaybackEvent, PlaybackClock, ProjectEvent, StepEvent } from "./types";

class FakeClock implements PlaybackClock {
  currentTime = 0;
  private nextTimerId = 1;
  private timers: Array<{ id: number; callback: () => void; dueAt: number }> = [];

  now(): number {
    return this.currentTime;
  }

  setTimer(callback: () => void, delayMs: number): unknown {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.push({ id, callback, dueAt: this.currentTime + delayMs });
    return id;
  }

  clearTimer(timerId: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== timerId);
  }

  advance(ms: number): void {
    const target = this.currentTime + ms;
    while (true) {
      this.timers.sort((left, right) => left.dueAt - right.dueAt);
      const timer = this.timers[0];
      if (!timer || timer.dueAt > target) break;
      this.timers.shift();
      this.currentTime = timer.dueAt;
      timer.callback();
    }
    this.currentTime = target;
  }

  jumpWithoutRunningTimers(ms: number): void {
    this.currentTime += ms;
  }
}

const STEP_MS = 125;

const buildTransport = (durationMs?: number): { clock: FakeClock; transport: PlaybackTransport } => {
  const clock = new FakeClock();
  const transport = createClockTransport(clock, durationMs === undefined ? undefined : { durationMs });
  return { clock, transport };
};

describe("SequencerEngine — Playback v2", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("PB-EN-001 plays through a PlaybackTransport and emits step 0 with cause play", async () => {
    const { transport } = buildTransport();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const engine = new SequencerEngine(project, { transport });
    const playback: EnginePlaybackEvent[] = [];
    const steps: StepEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("step", (event) => steps.push(event));

    await engine.play();

    expect(playback).toMatchObject([
      { type: "play", cause: "command", previousState: "stopped" },
    ]);
    expect(steps).toMatchObject([
      {
        stepIndex: 0,
        cause: "play",
        scheduledPositionMs: 0,
        transportPositionMs: 0,
        lateByMs: 0,
      },
    ]);
    expect(engine.getPlaybackState()).toBe("playing");
  });

  it("PB-EN-002 emits natural tick steps from transport position", async () => {
    const { clock, transport } = buildTransport();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const engine = new SequencerEngine(project, { transport, lookaheadMs: 1000 });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    await engine.play();
    clock.advance(STEP_MS * 3);
    await vi.advanceTimersByTimeAsync(STEP_MS * 3);

    expect(steps.map((event) => event.stepIndex)).toEqual([0, 1, 2, 3]);
    expect(steps.map((event) => event.scheduledPositionMs)).toEqual([0, 125, 250, 375]);
    expect(steps.slice(1).every((event) => event.cause === "tick")).toBe(true);
  });

  it("PB-EN-029 resumes step emission across a transport loop boundary (regression: effects freeze while audio loops)", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: STEP_MS * 4, loop: true });
    const project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    const engine = new SequencerEngine(project, { transport, lookaheadMs: 1000 });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    await engine.play();
    // Advance in lockstep, one step at a time, across two full loops (8 steps)
    // so the transport's loop boundary and the engine's own tick timer interleave
    // the way they would in real playback.
    for (let index = 0; index < 8; index += 1) {
      clock.advance(STEP_MS);
      await vi.advanceTimersByTimeAsync(STEP_MS);
    }

    expect(steps.map((event) => event.stepIndex)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]);
    expect(steps.map((event) => event.cause)).toEqual([
      "play",
      "tick",
      "tick",
      "tick",
      "loop",
      "tick",
      "tick",
      "tick",
      "loop",
    ]);
  });

  it("PB-EN-002 pauses and resumes without duplicating the current step", async () => {
    const { clock, transport } = buildTransport();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const engine = new SequencerEngine(project, { transport, lookaheadMs: 1000 });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    await engine.play();
    clock.advance(60);
    await engine.pause();
    clock.advance(500);
    await vi.advanceTimersByTimeAsync(500);

    expect(engine.getPosition().positionMs).toBe(60);
    expect(steps.map((event) => event.stepIndex)).toEqual([0]);

    await engine.play();
    clock.advance(65);
    await vi.advanceTimersByTimeAsync(65);

    expect(steps.map((event) => event.stepIndex)).toEqual([0, 1]);
  });

  it("PB-EN-008 delayed callback with emit catches up every crossed step", async () => {
    const { clock, transport } = buildTransport();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const engine = new SequencerEngine(project, { transport, lookaheadMs: 1000 });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    await engine.play();
    clock.jumpWithoutRunningTimers(STEP_MS * 4);
    await vi.advanceTimersByTimeAsync(STEP_MS);

    expect(steps.map((event) => event.stepIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(steps[1]).toMatchObject({
      scheduledPositionMs: 125,
      transportPositionMs: 500,
      lateByMs: 375,
    });
  });

  it("PB-EN-009 can skip missed transport-driven steps", async () => {
    const { clock, transport } = buildTransport();
    const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    const engine = new SequencerEngine(project, {
      transport,
      lookaheadMs: 1000,
      missedStepPolicy: "skip",
    });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    await engine.play();
    clock.jumpWithoutRunningTimers(STEP_MS * 4);
    await vi.advanceTimersByTimeAsync(STEP_MS);

    expect(steps.map((event) => event.stepIndex)).toEqual([0, 4]);
    expect(steps[1].lateByMs).toBe(0);
  });

  it("PB-EN-003 stops by returning the shared transport and local position to zero", async () => {
    const { clock, transport } = buildTransport();
    const engine = new SequencerEngine(createProject(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    await engine.play();
    clock.advance(40);
    await engine.stop();

    expect(transport.getSnapshot()).toMatchObject({ state: "stopped", positionMs: 0 });
    expect(engine.getPosition()).toEqual({ positionMs: 0, beat: 0 });
    expect(playback.at(-1)).toMatchObject({ type: "stop", cause: "command" });
  });

  it("PB-EN-004 PB-EN-005 validates and seeks by step", async () => {
    const { transport } = buildTransport();
    const engine = new SequencerEngine(createProject({ bpm: 120, stepCount: 16 }), { transport });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    expect(() => engine.seekStep(-1)).toThrow(RangeError);
    expect(() => engine.seekStep(16)).toThrow(RangeError);
    await engine.seekStep(3);

    expect(transport.getPositionMs()).toBe(3 * STEP_MS);
    expect(steps).toMatchObject([
      { stepIndex: 3, cause: "seek", transportPositionMs: 375, scheduledPositionMs: 375 },
    ]);
    expect(engine.getPlaybackState()).toBe("paused");
  });

  it("PB-EN-007 seekPositionMs delegates range validation to the transport", async () => {
    const { transport } = buildTransport(500);
    const engine = new SequencerEngine(createProject({ bpm: 120 }), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    await engine.seekPositionMs(250);
    expect(engine.getCurrentStepIndex()).toBe(2);
    expect(() => engine.seekPositionMs(501)).toThrow(RangeError);
    await transport.seekMs(100);
    expect(playback.at(-1)).toMatchObject({ type: "seek", cause: "transport" });
  });

  it("PB-CH-001 PB-CH-004 samples the current logical position and pure positions separately", async () => {
    const { clock, transport } = buildTransport();
    let project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    const trackId = project.tracks[0].id;
    project = setStepValue(project, trackId, 0, 0);
    project = setStepValue(project, trackId, 1, 1);
    const engine = new SequencerEngine(project, { transport });

    expect(engine.sampleChannelsAt(STEP_MS / 2)[trackId]).toBeCloseTo(0.5);
    expect(engine.sampleChannelsAt(STEP_MS / 2, easeOutQuad)[trackId]).toBeCloseTo(0.75);

    await engine.play();
    clock.advance(STEP_MS / 2);
    expect(engine.sampleChannels()[trackId]).toBeCloseTo(0.5);
  });

  it("PB-EN-011 PB-EN-011A setProject preserves fractional beat without seeking transport", async () => {
    const { transport } = buildTransport();
    let project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    const trackId = project.tracks[0].id;
    project = setStepValue(project, trackId, 1, 1);
    const engine = new SequencerEngine(project, { transport });
    const projects: ProjectEvent[] = [];
    engine.on("project", (event) => projects.push(event));

    await engine.seekPositionMs(STEP_MS);
    const nextProject = setProjectBpm(project, 60);
    engine.setProject(nextProject);

    expect(transport.getPositionMs()).toBe(STEP_MS);
    expect(engine.getPosition()).toEqual({ positionMs: 250, beat: 0.25 });
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      project: nextProject,
      previousProject: project,
      positionMs: 250,
      beat: 0.25,
    });
  });

  it("PB-EN-012 external seek after live tempo edit discards the temporary anchor", async () => {
    const { transport } = buildTransport();
    const project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    const engine = new SequencerEngine(project, { transport });

    await engine.seekPositionMs(STEP_MS);
    engine.setProject(setProjectBpm(project, 60));
    expect(engine.getPosition()).toEqual({ positionMs: 250, beat: 0.25 });

    await transport.seekMs(0);

    expect(engine.getPosition()).toEqual({ positionMs: 0, beat: 0 });
  });

  it("PB-EN-027 adopts an already-playing transport without synthetic step events", async () => {
    const { clock, transport } = buildTransport();
    await transport.play();
    clock.advance(STEP_MS * 2);
    const engine = new SequencerEngine(createProject({ bpm: 120, stepCount: 16 }), {
      transport,
      lookaheadMs: 1000,
    });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    expect(steps).toEqual([]);
    clock.advance(STEP_MS);
    await vi.advanceTimersByTimeAsync(STEP_MS);

    expect(steps.map((event) => event.stepIndex)).toEqual([3]);
  });

  it("PB-EN-013A rejects invalid constructor and hot-swap projects", () => {
    const project = createProject();
    expect(() => new SequencerEngine({ ...project, bpm: 0 })).toThrow(TypeError);
    expect(() => new SequencerEngine(project, { lookaheadMs: -1 })).toThrow(RangeError);

    const engine = new SequencerEngine(project);
    expect(() => engine.setProject({ ...project, tracks: [] })).toThrow(TypeError);
    expect(engine.getProject()).toBe(project);
  });

  it("PB-EN-017 forwards transport ended and replay starts from zero", async () => {
    const { clock, transport } = buildTransport(100);
    const project = createProject({ bpm: 120 });
    const first = new SequencerEngine(project, { transport });
    const second = new SequencerEngine(project, { transport });
    const firstPlayback: EnginePlaybackEvent[] = [];
    const secondPlayback: EnginePlaybackEvent[] = [];
    first.on("playback", (event) => firstPlayback.push(event));
    second.on("playback", (event) => secondPlayback.push(event));

    await first.play();
    clock.advance(100);
    expect(first.getPlaybackState()).toBe("ended");
    expect(second.getPlaybackState()).toBe("ended");
    await first.play();

    expect(firstPlayback.map((event) => event.type)).toEqual(["play", "ended", "play"]);
    expect(secondPlayback.map((event) => event.type)).toEqual(["play", "ended", "play"]);
    expect(transport.getPositionMs()).toBe(0);
    expect(first.getCurrentStepIndex()).toBe(0);
  });

  it("PB-EN-011 PB-EN-017 setProject while ended does not leave a stale anchor after replay", async () => {
    const { clock, transport } = buildTransport(1000);
    const project = createProject({ bpm: 120 });
    const engine = new SequencerEngine(project, { transport });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    await engine.play();
    clock.advance(1000);
    expect(engine.getPlaybackState()).toBe("ended");

    engine.setProject(setProjectBpm(project, 60));
    expect(engine.getPosition().positionMs).toBe(2000);

    await engine.play();

    expect(transport.getPositionMs()).toBe(0);
    expect(engine.getPosition().positionMs).toBe(0);
    expect(engine.getCurrentStepIndex()).toBe(0);
    expect(steps.at(-1)).toMatchObject({ stepIndex: 0, scheduledPositionMs: 0 });
  });

  it("PB-EN-019 PB-EN-026 one Engine disposal leaves a borrowed shared transport usable", async () => {
    const { transport } = buildTransport();
    const project = createProject();
    const first = new SequencerEngine(project, { transport });
    const second = new SequencerEngine(project, { transport });
    const firstPlayback: EnginePlaybackEvent[] = [];
    const secondPlayback: EnginePlaybackEvent[] = [];
    first.on("playback", (event) => firstPlayback.push(event));
    second.on("playback", (event) => secondPlayback.push(event));

    first.dispose();
    first.dispose();
    await second.play();

    expect(transport.getPlaybackState()).toBe("playing");
    expect(second.getPlaybackState()).toBe("playing");
    expect(firstPlayback).toEqual([]);
    expect(secondPlayback).toMatchObject([{ type: "play", cause: "command" }]);
  });

  it("PB-EN-020 Engine APIs throw after Engine disposal", () => {
    const { transport } = buildTransport();
    const engine = new SequencerEngine(createProject(), { transport });
    engine.dispose();

    expect(() => engine.getProject()).toThrowError(expect.objectContaining({ code: "TRANSPORT_DISPOSED" }));
    expect(() => engine.sampleChannels()).toThrowError(expect.objectContaining({ code: "TRANSPORT_DISPOSED" }));
    expect(() => engine.on("step", () => {})).toThrowError(expect.objectContaining({ code: "TRANSPORT_DISPOSED" }));
    expect(() => engine.play()).toThrowError(expect.objectContaining({ code: "TRANSPORT_DISPOSED" }));
    expect(transport.getPlaybackState()).toBe("stopped");
  });

  it("PB-EN-021 isolates Engine listener failures", async () => {
    const onListenerError = vi.fn();
    const { transport } = buildTransport();
    const healthy = vi.fn();
    const engine = new SequencerEngine(createProject(), { transport, onListenerError });
    engine.on("playback", () => {
      throw new Error("listener failed");
    });
    engine.on("playback", healthy);

    await engine.play();

    expect(healthy).toHaveBeenCalledOnce();
    expect(onListenerError).toHaveBeenCalledWith(expect.any(Error), {
      source: "engine",
      eventName: "playback",
    });
  });

  it("PB-EN-018 transport disposal detaches the Engine at the cached position", async () => {
    const { clock, transport } = buildTransport();
    const engine = new SequencerEngine(createProject(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    await engine.play();
    clock.advance(20);
    transport.dispose();

    expect(engine.getPlaybackState()).toBe("paused");
    expect(engine.getPosition().positionMs).toBe(20);
    expect(playback.at(-1)).toMatchObject({ type: "error", cause: "transport" });
    await expect(engine.play()).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
  });

  it("PB-EN-028 maps external transport events to playback cause transport", async () => {
    const { transport } = buildTransport(1000);
    const engine = new SequencerEngine(createProject(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    await transport.seekMs(250);
    await transport.setPlaybackRate(2);

    expect(playback).toMatchObject([
      { type: "seek", cause: "transport" },
      { type: "ratechange", cause: "transport" },
    ]);
  });
});
