import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClockTransport, type PlaybackTransport } from "../playbackTransport";
import { createProject, setStepValue } from "../project";
import type { ChannelSource, EnginePlaybackEvent, PlaybackClock, StepEvent } from "../types";
import { ArrangementEngine } from "./ArrangementEngine";
import { createArrangement } from "./project";
import type {
  ArrangementProject,
  ArrangementProjectEvent,
  ArrangementSectionEvent,
} from "./types";

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
}

const BEAT_MS = 500;

const buildTransport = (): { clock: FakeClock; transport: PlaybackTransport } => {
  const clock = new FakeClock();
  return { clock, transport: createClockTransport(clock) };
};

const buildArrangement = (): ArrangementProject => {
  let intro = createProject({ bpm: 999, stepCount: 2, stepsPerBeat: 1, trackCount: 1, trackNames: ["intro"] });
  const introTrackId = intro.tracks[0].id;
  intro = setStepValue(intro, introTrackId, 0, 0);
  intro = setStepValue(intro, introTrackId, 1, 1);

  let chorus = createProject({ bpm: 999, stepCount: 2, stepsPerBeat: 1, trackCount: 1, trackNames: ["chorus"] });
  const chorusTrackId = chorus.tracks[0].id;
  chorus = setStepValue(chorus, chorusTrackId, 0, 1);
  chorus = setStepValue(chorus, chorusTrackId, 1, 1);

  return createArrangement({
    timing: { bpm: 120 },
    durationBeats: 6,
    patterns: { intro, chorus },
    sections: [
      { id: "s1", patternId: "intro", startBeat: 0, endBeat: 2 },
      { id: "s2", patternId: "chorus", startBeat: 4, endBeat: 6 },
    ],
  });
};

describe("ArrangementEngine — Playback v2", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("PB-EN-001 plays through a PlaybackTransport and emits section + step 0", async () => {
    const { transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    const sections: ArrangementSectionEvent[] = [];
    const steps: StepEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("section", (event) => sections.push(event));
    engine.on("step", (event) => steps.push(event));

    await engine.play();

    expect(playback).toMatchObject([
      { type: "play", cause: "command", previousState: "stopped" },
    ]);
    expect(sections).toMatchObject([{ section: { id: "s1" }, beat: 0, cause: "play" }]);
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

  it("validates constructor options and registers onStep/onSection convenience handlers", async () => {
    const { transport } = buildTransport();
    const onStep = vi.fn();
    const onSection = vi.fn();

    expect(() => new ArrangementEngine(buildArrangement(), null as unknown as Record<string, never>)).toThrow(TypeError);
    expect(() => new ArrangementEngine(buildArrangement(), { lookaheadMs: -1 })).toThrow(RangeError);
    expect(() => new ArrangementEngine(buildArrangement(), { loop: "yes" as unknown as boolean })).toThrow(TypeError);

    const engine = new ArrangementEngine(buildArrangement(), {
      transport,
      onStep,
      onSection,
    });

    await engine.play();

    expect(onStep).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 0, cause: "play" }));
    expect(onSection).toHaveBeenCalledWith(expect.objectContaining({ section: expect.objectContaining({ id: "s1" }) }));
  });

  it("PB-CH-003 pauses and samples the frozen logical position", async () => {
    const { clock, transport } = buildTransport();
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { transport });
    const introId = arrangement.patterns.intro.tracks[0].id;

    await engine.play();
    clock.advance(BEAT_MS / 2);
    await engine.pause();
    const pausedValue = engine.sampleChannels()[introId];
    clock.advance(BEAT_MS * 10);

    expect(engine.getPlaybackState()).toBe("paused");
    expect(engine.sampleChannels()[introId]).toBeCloseTo(pausedValue);
  });

  it("PB-EN-006 PB-EN-010 PB-CH-010 seekBeat maps beat to transport position and emits only destination steps", async () => {
    const { transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    const sections: ArrangementSectionEvent[] = [];
    const steps: StepEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("section", (event) => sections.push(event));
    engine.on("step", (event) => steps.push(event));

    await engine.play();
    await engine.seekBeat(4);
    await engine.seekBeat(1);

    expect(transport.getPositionMs()).toBe(BEAT_MS);
    expect(playback.at(-1)).toMatchObject({ type: "seek", cause: "command" });
    expect(sections.at(-1)).toMatchObject({ section: { id: "s1" }, beat: 1, cause: "seek" });
    expect(steps.map((event) => `${event.cause}:${event.stepIndex}`)).toEqual(["play:0", "seek:0", "seek:1"]);
  });

  it("PB-EN-005 rejects invalid beat seeks synchronously", () => {
    const { transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });

    expect(() => engine.seekBeat(-1)).toThrow(RangeError);
    expect(() => engine.seekBeat(Number.NaN)).toThrow(RangeError);
    expect(() => engine.seekBeat(7)).toThrow(RangeError);
  });

  it("seekPositionMs maps transport-relative milliseconds through Arrangement playback", async () => {
    const { transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    await engine.seekPositionMs(BEAT_MS * 2);

    expect(transport.getPositionMs()).toBe(BEAT_MS * 2);
    expect(engine.getPosition()).toMatchObject({ positionMs: BEAT_MS * 2, beat: 2 });
    expect(playback.at(-1)).toMatchObject({ type: "seek", cause: "command" });
    expect(() => engine.seekPositionMs(-1)).toThrow(RangeError);
    expect(() => engine.seekPositionMs(BEAT_MS * 7)).toThrow(RangeError);
  });

  it("AR-007 AR-008 uses Arrangement TimingMap for seek and step scheduling, ignoring pattern bpm", async () => {
    const { clock, transport } = buildTransport();
    const pattern = createProject({ bpm: 999, stepCount: 4, stepsPerBeat: 1, trackCount: 1 });
    const arrangement = createArrangement({
      timing: { tempos: [{ beat: 0, bpm: 60 }, { beat: 1, bpm: 120 }] },
      durationBeats: 3,
      patterns: { pattern },
      sections: [{ id: "s1", patternId: "pattern", startBeat: 0, endBeat: 3 }],
    });
    const engine = new ArrangementEngine(arrangement, { transport, lookaheadMs: 10 });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    await engine.seekBeat(2);
    expect(transport.getPositionMs()).toBe(1500);

    await engine.stop();
    steps.length = 0;
    await engine.play();
    clock.advance(1500);
    await vi.advanceTimersByTimeAsync(10);

    expect(steps.map((event) => `${event.stepIndex}:${event.scheduledPositionMs}:${event.bpm}`)).toEqual([
      "0:0:60",
      "1:1000:120",
      "2:1500:120",
    ]);
  });

  it("PB-CH-004 sampleChannelsAt evaluates project-relative milliseconds", () => {
    const { transport } = buildTransport();
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { transport });
    const introId = arrangement.patterns.intro.tracks[0].id;
    const chorusId = arrangement.patterns.chorus.tracks[0].id;

    const start = engine.sampleChannelsAt(0);
    const gap = engine.sampleChannelsAt(BEAT_MS * 3);
    const interpolated = engine.sampleChannelsAt(BEAT_MS / 2);

    expect(Object.keys(start).sort()).toEqual([introId, chorusId].sort());
    expect(start[chorusId]).toBe(0);
    expect(Object.values(gap).every((value) => value === 0)).toBe(true);
    expect(interpolated[introId]).toBeCloseTo(0.5);
  });

  it("PB-EN-016 reaches local ended without stopping a shared transport", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport, lookaheadMs: 1000 });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    await engine.play();
    clock.advance(BEAT_MS * 6);
    await vi.advanceTimersByTimeAsync(1000);

    expect(engine.getPlaybackState()).toBe("ended");
    expect(transport.getPlaybackState()).toBe("playing");
    expect(playback.at(-1)).toMatchObject({ type: "ended", cause: "local-end" });
  });

  it("PB-TR-006 replays from local ended with play metadata while transport keeps running", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport, lookaheadMs: 1000 });
    const playback: EnginePlaybackEvent[] = [];
    const steps: StepEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("step", (event) => steps.push(event));

    await engine.play();
    clock.advance(BEAT_MS * 6);
    await vi.advanceTimersByTimeAsync(1000);
    playback.length = 0;
    steps.length = 0;

    await engine.play();

    expect(transport.getPlaybackState()).toBe("playing");
    expect(playback).toMatchObject([
      { type: "play", cause: "command", previousState: "ended" },
    ]);
    expect(steps).toMatchObject([
      { stepIndex: 0, cause: "play", scheduledPositionMs: 0, transportPositionMs: 0 },
    ]);
  });

  it("replays from local ended after the transport itself reached ended", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: BEAT_MS * 6 });
    const engine = new ArrangementEngine(buildArrangement(), { transport, lookaheadMs: 1000 });
    const playback: string[] = [];
    const steps: string[] = [];
    engine.on("playback", (event) => playback.push(`${event.type}:${event.previousState}`));
    engine.on("step", (event) => steps.push(`${event.cause}:${event.stepIndex}`));

    await engine.play();
    clock.advance(BEAT_MS * 6);
    playback.length = 0;
    steps.length = 0;

    await engine.play();

    expect(transport.getPlaybackState()).toBe("playing");
    expect(playback).toEqual(["play:ended"]);
    expect(steps).toEqual(["play:0"]);
  });

  it("PB-EN-022 PB-EN-023 PB-EN-024 changes local loop without mutating transport loop", () => {
    const { transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    const setLoop = engine.setLoop as unknown as (loop: unknown) => void;

    expect(() => setLoop("yes")).toThrow(TypeError);
    engine.setLoop(true);
    engine.setLoop(true);

    expect(playback).toMatchObject([
      { type: "loopchange", cause: "command", snapshot: { projectLoop: true, transportLoop: false } },
    ]);
    expect(transport.getLoop()).toBe(false);
  });

  it("setLoop off while past the local duration transitions to ended and emits the terminal section", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport, loop: true, lookaheadMs: 1000 });
    const playback: string[] = [];
    const sections: ArrangementSectionEvent[] = [];
    engine.on("playback", (event) => playback.push(`${event.type}:${event.snapshot.state}`));
    engine.on("section", (event) => sections.push(event));

    await engine.play();
    clock.advance(BEAT_MS * 7);
    engine.setLoop(false);

    expect(engine.getPlaybackState()).toBe("ended");
    expect(playback.at(-2)).toBe("loopchange:ended");
    expect(playback.at(-1)).toBe("ended:ended");
    expect(sections.at(-1)).toMatchObject({ section: null, cause: "tick" });
  });

  it("PB-EN-011 PB-EN-025 setArrangement preserves fractional beat without seeking transport", async () => {
    const { clock, transport } = buildTransport();
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { transport });
    const projects: ArrangementProjectEvent[] = [];
    engine.on("project", (event) => projects.push(event));

    await engine.play();
    clock.advance(BEAT_MS * 1.5);
    const nextArrangement = createArrangement({
      timing: { bpm: 60 },
      durationBeats: arrangement.durationBeats,
      patterns: arrangement.patterns,
      sections: arrangement.sections,
    });
    engine.setArrangement(nextArrangement);

    expect(transport.getPositionMs()).toBe(BEAT_MS * 1.5);
    expect(engine.getPosition()).toMatchObject({ beat: 1.5, positionMs: 1500 });
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ beat: 1.5, positionMs: 1500 });
  });

  it("PB-EN-014 AR-009 shortens a non-looping project to local ended", async () => {
    const { clock, transport } = buildTransport();
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { transport });

    await engine.play();
    clock.advance(BEAT_MS * 5);
    engine.setArrangement(createArrangement({
      timing: { bpm: 120 },
      durationBeats: 2,
      patterns: arrangement.patterns,
      sections: [{ id: "short", patternId: "intro", startBeat: 0, endBeat: 2 }],
    }));

    expect(engine.getPlaybackState()).toBe("ended");
    expect(engine.getPosition()).toMatchObject({ beat: 2, positionMs: BEAT_MS * 2 });
  });

  it("PB-EN-015 PB-CH-008 AR-010 AR-011 shortens a looping project by modulo, emits the destination step, and keeps playing", async () => {
    const { clock, transport } = buildTransport();
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { transport, loop: true });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    await engine.play();
    clock.advance(BEAT_MS * 5);
    engine.setArrangement(createArrangement({
      timing: { bpm: 120 },
      durationBeats: 2,
      patterns: arrangement.patterns,
      sections: [{ id: "short", patternId: "intro", startBeat: 0, endBeat: 2 }],
    }));

    expect(engine.getPlaybackState()).toBe("playing");
    expect(engine.getPosition()).toMatchObject({ beat: 1, positionMs: BEAT_MS });
    expect(steps.map((event) => `${event.cause}:${event.stepIndex}`)).toEqual([
      "play:0",
      "project-change:1",
    ]);
  });

  it("PB-EN-013 PB-EN-013A validates constructor and preserves state on invalid hot-swap", async () => {
    const { clock, transport } = buildTransport();

    expect(() => new ArrangementEngine({ ...buildArrangement(), sections: [{ id: "bad", patternId: "missing", startBeat: 0, endBeat: 1 }] }, { transport })).toThrow(TypeError);

    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { transport });
    await engine.play();
    clock.advance(BEAT_MS);
    const previousPosition = engine.getPosition();
    const previousState = engine.getPlaybackState();

    expect(() => engine.setArrangement({
      ...buildArrangement(),
      timing: { tempos: [{ beat: 1, bpm: 120 }], startPositionMs: 0 },
    })).toThrow(TypeError);
    expect(engine.getArrangement()).toBe(arrangement);
    expect(engine.getPlaybackState()).toBe(previousState);
    expect(engine.getPosition()).toEqual(previousPosition);
  });

  it("PB-EN-019 PB-EN-020 dispose is idempotent and borrowed transport survives", async () => {
    const { transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    await engine.play();

    engine.dispose();
    engine.dispose();

    expect(transport.getPlaybackState()).toBe("playing");
    expect(() => engine.sampleChannels()).toThrow();
    expect(() => engine.on("step", () => undefined)).toThrow();
  });

  it("maps external transport changes, errors, and disposal to playback events", async () => {
    const { transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: string[] = [];
    engine.on("playback", (event) => playback.push(`${event.type}:${event.cause}:${event.snapshot.state}`));

    await transport.seekMs(BEAT_MS);
    await transport.setPlaybackRate(2);
    transport.dispose();

    expect(playback).toEqual([
      "seek:transport:paused",
      "ratechange:transport:paused",
      "error:transport:paused",
    ]);
    await expect(engine.play()).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
  });

  it("isolates Arrangement listener failures", async () => {
    const { transport } = buildTransport();
    const onListenerError = vi.fn();
    const healthy = vi.fn();
    const engine = new ArrangementEngine(buildArrangement(), { transport, onListenerError });
    engine.on("section", () => {
      throw new Error("section listener failed");
    });
    engine.on("section", healthy);

    await engine.play();

    expect(healthy).toHaveBeenCalledOnce();
    expect(onListenerError).toHaveBeenCalledWith(expect.any(Error), {
      source: "engine",
      eventName: "section",
    });
  });

  it("validates pure sampling positions", () => {
    const { transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });

    expect(() => engine.sampleChannelsAt(-1)).toThrow(RangeError);
    expect(() => engine.sampleChannelsAt(Number.NaN)).toThrow(RangeError);
  });

  it("exposes ArrangementEngine through the generic ChannelSource surface", () => {
    const { transport } = buildTransport();
    const source: ChannelSource = new ArrangementEngine(buildArrangement(), { transport });

    source.on("playback", (event) => event.snapshot.positionMs);
    source.on("project", (event) => event.changedChannelIds);
  });
});
