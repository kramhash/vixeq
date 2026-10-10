import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClockTransport,
  type PlaybackSnapshot,
  type PlaybackTransport,
  type PlaybackTransportEvent,
} from "../playbackTransport";
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

// A hand-driven PlaybackTransport for exercising Engine reactions to events a
// third-party transport implementation may emit (the PlaybackTransport type is
// public, so the Engine cannot assume only the built-in transports).
class ManualTransport implements PlaybackTransport {
  snapshot: PlaybackSnapshot = {
    state: "stopped",
    positionMs: 0,
    durationMs: null,
    playbackRate: 1,
    loop: false,
    buffering: false,
  };
  private listeners = new Set<(event: PlaybackTransportEvent) => void>();

  emitEvent(event: PlaybackTransportEvent): void {
    this.snapshot = { ...event.snapshot };
    for (const listener of [...this.listeners]) listener(event);
  }

  getSnapshot(): PlaybackSnapshot {
    return { ...this.snapshot };
  }
  getPlaybackState(): PlaybackSnapshot["state"] {
    return this.snapshot.state;
  }
  getPositionMs(): number {
    return this.snapshot.positionMs;
  }
  getDurationMs(): number | null {
    return this.snapshot.durationMs;
  }
  getPlaybackRate(): number {
    return this.snapshot.playbackRate;
  }
  getLoop(): boolean {
    return this.snapshot.loop;
  }
  async play(): Promise<void> {
    this.emitEvent({ type: "play", snapshot: { ...this.snapshot, state: "playing" } });
  }
  async pause(): Promise<void> {}
  async stop(): Promise<void> {}
  async seekMs(positionMs: number): Promise<void> {
    const state = this.snapshot.state === "playing" ? "playing" : "paused";
    this.emitEvent({
      type: "seek",
      previousPositionMs: this.snapshot.positionMs,
      snapshot: { ...this.snapshot, state, positionMs },
    });
  }
  async setPlaybackRate(): Promise<void> {}
  async setLoop(): Promise<void> {}
  subscribe(listener: (event: PlaybackTransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispose(): void {}
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

describe("ArrangementEngine — RC1C branch coverage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("falls back to reportError when onListenerError itself throws", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const engine = new ArrangementEngine(buildArrangement(), {
      transport: buildTransport().transport,
      onListenerError: () => {
        throw new Error("reporter failed");
      },
    });
    engine.on("section", () => {
      throw new Error("section listener failed");
    });

    await engine.play();

    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "reporter failed" }));
  });

  it("reports listener failures through console.error when reportError is unavailable", async () => {
    const engine = new ArrangementEngine(buildArrangement(), { transport: buildTransport().transport });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    engine.on("section", () => {
      throw new Error("section listener failed");
    });
    vi.stubGlobal("reportError", undefined);

    try {
      await engine.play();

      expect(consoleError).toHaveBeenCalledWith(expect.any(Error));
    } finally {
      consoleError.mockRestore();
    }
  });

  it("drops listener failures when neither reportError nor console exists", async () => {
    const originalConsole = console;
    const engine = new ArrangementEngine(buildArrangement(), { transport: buildTransport().transport });
    const healthy = vi.fn();
    engine.on("section", () => {
      throw new Error("section listener failed");
    });
    engine.on("section", healthy);
    vi.stubGlobal("reportError", undefined);
    vi.stubGlobal("console", undefined);

    try {
      await expect(engine.play()).resolves.toBeUndefined();
    } finally {
      vi.stubGlobal("console", originalConsole);
    }

    expect(healthy).toHaveBeenCalledOnce();
  });

  it("disposes an Engine-owned browser-clock transport with the Engine", async () => {
    const engine = new ArrangementEngine(buildArrangement());
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));
    await engine.play();
    steps.length = 0;

    engine.dispose();
    vi.advanceTimersByTime(BEAT_MS * 2);

    expect(steps).toEqual([]);
    expect(() => engine.getPlaybackState()).toThrow(/disposed/);
  });

  it("starts in a section gap with no current section and adopts an already-playing transport", async () => {
    const { clock, transport } = buildTransport();
    await transport.seekMs(BEAT_MS * 3);
    await transport.play();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const sections: ArrangementSectionEvent[] = [];
    engine.on("section", (event) => sections.push(event));

    expect(engine.getCurrentSection()).toBeNull();
    expect(engine.getPlaybackState()).toBe("playing");

    clock.advance(BEAT_MS);
    vi.advanceTimersByTime(25);

    expect(sections).toMatchObject([{ section: { id: "s2" }, cause: "tick" }]);
  });

  it("rejects pause, stop, and seeks once the transport is disposed", async () => {
    const { transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    transport.dispose();

    await expect(engine.pause()).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
    await expect(engine.stop()).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
    await expect(engine.seekBeat(1)).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
    await expect(engine.seekPositionMs(0)).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
  });

  it("validates setLoop and stays at local end when looping is enabled after the end", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    expect(() => engine.setLoop("yes" as unknown as boolean)).toThrow(TypeError);
    await engine.play();
    clock.advance(BEAT_MS * 6);
    vi.advanceTimersByTime(25);
    expect(engine.getPlaybackState()).toBe("ended");
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    engine.setLoop(true);

    expect(engine.getPlaybackState()).toBe("ended");
    expect(playback).toMatchObject([
      {
        type: "loopchange",
        cause: "command",
        previousState: "ended",
        snapshot: { state: "ended", projectLoop: true },
      },
    ]);
  });

  it("ignores setArrangement with the already-loaded arrangement", () => {
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { transport: buildTransport().transport });
    const projects: ArrangementProjectEvent[] = [];
    engine.on("project", (event) => projects.push(event));

    engine.setArrangement(arrangement);

    expect(projects).toEqual([]);
  });

  it("does not let no-op commands leave stale command markers", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    await engine.pause();
    await engine.play();
    clock.advance(20);
    await engine.pause();
    // stop() emits and is consumed first; the queued pause() is then a no-op
    // because the transport is already stopped.
    await Promise.all([engine.stop(), engine.pause()]);
    playback.length = 0;
    await transport.play();
    await transport.pause();

    expect(playback).toMatchObject([
      { type: "play", cause: "transport" },
      { type: "pause", cause: "transport" },
    ]);
  });

  it("clears the command marker when the transport rejects a seek synchronously", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: BEAT_MS * 2 });
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    expect(() => engine.seekBeat(4)).toThrow(RangeError);
    await transport.seekMs(BEAT_MS);

    expect(playback).toMatchObject([{ type: "seek", cause: "transport" }]);
  });

  it("ignores transport events that arrive after disposal within the same dispatch", async () => {
    const { transport } = buildTransport();
    let engine: ArrangementEngine | undefined;
    transport.subscribe((event) => {
      if (event.type === "play") engine?.dispose();
    });
    engine = new ArrangementEngine(buildArrangement(), { transport });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));

    await transport.play();

    expect(steps).toEqual([]);
    expect(() => engine?.getPlaybackState()).toThrow(/disposed/);
  });

  it("reports local end instead of play when the transport resumes past the arrangement", async () => {
    const { transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    await transport.seekMs(BEAT_MS * 7);
    await transport.play();

    expect(engine.getPlaybackState()).toBe("ended");
    expect(playback.at(-1)).toMatchObject({ type: "ended", cause: "local-end", previousState: "ended" });
  });

  it("freezes position and steps while a transport reports buffering", async () => {
    const transport = new ManualTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    const steps: StepEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("step", (event) => steps.push(event));
    await engine.play();
    steps.length = 0;

    transport.emitEvent({
      type: "bufferingchange",
      previousBuffering: false,
      snapshot: { ...transport.snapshot, buffering: true },
    });
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS };
    vi.advanceTimersByTime(100);

    expect(playback.at(-1)).toMatchObject({ type: "bufferingchange", snapshot: { buffering: true } });
    expect(engine.getPosition().positionMs).toBe(0);
    expect(steps).toEqual([]);

    transport.emitEvent({
      type: "bufferingchange",
      previousBuffering: true,
      snapshot: { ...transport.snapshot, buffering: false },
    });
    vi.advanceTimersByTime(25);

    expect(steps.map((event) => event.stepIndex)).toEqual([1]);
  });

  it("forwards transport errors and other transport events with cause transport", () => {
    const transport = new ManualTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    const error = new Error("decoder failed");

    transport.emitEvent({ type: "error", error, snapshot: transport.snapshot });
    transport.emitEvent({
      type: "durationchange",
      previousDurationMs: null,
      snapshot: { ...transport.snapshot, durationMs: BEAT_MS * 20 },
    });

    expect(playback).toMatchObject([
      { type: "error", cause: "transport", error },
      { type: "durationchange", cause: "transport" },
    ]);
  });

  it("stops ticking when a transport event leaves the transport not playing", async () => {
    const transport = new ManualTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));
    await engine.play();
    steps.length = 0;

    transport.emitEvent({
      type: "error",
      error: new Error("decoder failed"),
      snapshot: { ...transport.snapshot, state: "paused" },
    });
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS };
    vi.advanceTimersByTime(BEAT_MS);

    expect(engine.getPlaybackState()).toBe("paused");
    expect(steps).toEqual([]);
  });

  it("pauses at the cached position when the transport is disposed during playback", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    const playback: EnginePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    await engine.play();
    clock.advance(100);

    transport.dispose();

    expect(engine.getPlaybackState()).toBe("paused");
    expect(engine.getPosition().positionMs).toBe(100);
    expect(playback.at(-1)).toMatchObject({ type: "error", cause: "transport", previousState: "playing" });
  });

  it("stops scheduling when a step listener disposes the shared transport mid-tick", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    engine.on("step", (event) => {
      if (event.cause === "tick") transport.dispose();
    });
    await engine.play();

    clock.advance(BEAT_MS);
    vi.advanceTimersByTime(25);

    expect(engine.getPlaybackState()).toBe("paused");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops replaying missed steps once a step listener replaces the arrangement", async () => {
    const { clock, transport } = buildTransport();
    const intro = createProject({ stepCount: 2, stepsPerBeat: 1, trackCount: 1 });
    const chorus = createProject({ stepCount: 2, stepsPerBeat: 1, trackCount: 1 });
    const arrangement = createArrangement({
      timing: { bpm: 120 },
      durationBeats: 4,
      patterns: { intro, chorus },
      sections: [
        { id: "a", patternId: "intro", startBeat: 0, endBeat: 2 },
        { id: "b", patternId: "chorus", startBeat: 2, endBeat: 4 },
      ],
    });
    const replacement = createArrangement({
      timing: { bpm: 120 },
      durationBeats: 4,
      patterns: { other: intro },
      sections: [{ id: "x", patternId: "other", startBeat: 0, endBeat: 4 }],
    });
    const engine = new ArrangementEngine(arrangement, { transport });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => {
      steps.push(event);
      if (event.cause === "tick" && engine.getArrangement() === arrangement) {
        engine.setArrangement(replacement);
      }
    });
    await engine.play();
    steps.length = 0;

    clock.advance(BEAT_MS * 2.2);
    expect(() => vi.advanceTimersByTime(25)).not.toThrow();

    expect(steps.map((event) => event.cause)).toEqual(["tick", "project-change"]);
    expect(engine.getCurrentSection()?.id).toBe("x");
  });

  it("emits only the latest step under the skip policy and nothing new within the same step", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport, missedStepPolicy: "skip" });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));
    await engine.play();

    clock.advance(100);
    vi.advanceTimersByTime(25);
    expect(steps).toHaveLength(1);

    clock.advance(BEAT_MS * 5);
    vi.advanceTimersByTime(25);

    expect(steps.slice(1)).toMatchObject([{ stepIndex: 1, scheduledPositionMs: BEAT_MS * 5, cause: "tick" }]);
  });

  it("emits the first step again after a local loop wraps past the last emitted step", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport, loop: true });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));
    await engine.play();

    clock.advance(BEAT_MS * 5.2);
    vi.advanceTimersByTime(25);
    steps.length = 0;
    clock.advance(BEAT_MS);
    vi.advanceTimersByTime(25);

    expect(steps).toMatchObject([{ stepIndex: 0, scheduledPositionMs: 0, cause: "tick" }]);
  });

  it("stops delivering events to an unsubscribed listener", async () => {
    const engine = new ArrangementEngine(buildArrangement(), { transport: buildTransport().transport });
    const listener = vi.fn();
    const unsubscribe = engine.on("playback", listener);

    unsubscribe();
    await engine.play();

    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects a replay from local end when the transport is disposed before it runs", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(buildArrangement(), { transport });
    await engine.play();
    clock.advance(BEAT_MS * 6);
    vi.advanceTimersByTime(25);
    expect(engine.getPlaybackState()).toBe("ended");

    const replay = engine.play();
    transport.dispose();

    await expect(replay).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
    expect(engine.getPlaybackState()).toBe("ended");
  });

  it("hot-swaps and toggles loop at the cached position after the transport is disposed", async () => {
    const { clock, transport } = buildTransport();
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { transport });
    await engine.play();
    clock.advance(BEAT_MS);
    transport.dispose();

    engine.setArrangement({ ...arrangement, timing: { ...arrangement.timing, tempos: [{ beat: 0, bpm: 60 }] } });

    expect(engine.getPosition()).toEqual({ positionMs: BEAT_MS * 2, beat: 1 });

    engine.setLoop(true);

    expect(engine.getPlaybackState()).toBe("paused");
    expect(engine.getPosition()).toEqual({ positionMs: BEAT_MS * 2, beat: 1 });
  });
});

describe("ArrangementEngine — RC1G re-entrancy", () => {
  const singleSection = (durationBeats: number, sections: Array<{ id: string; startBeat: number; endBeat: number }>): ArrangementProject =>
    createArrangement({
      timing: { bpm: 120 },
      durationBeats,
      patterns: { p: createProject({ stepCount: 4, stepsPerBeat: 1, trackCount: 1 }) },
      sections: sections.map((section) => ({ ...section, patternId: "p" })),
    });
  const stepLabel = (event: StepEvent): string => `${event.cause}:${event.stepIndex}@${event.scheduledPositionMs}`;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not dispatch the steps a step listener seeks over synchronously", async () => {
    const transport = new ManualTransport();
    const engine = new ArrangementEngine(singleSection(8, [{ id: "s", startBeat: 0, endBeat: 8 }]), {
      transport,
      lookaheadMs: 10,
    });
    const steps: string[] = [];
    engine.on("step", (event) => {
      steps.push(stepLabel(event));
      if (event.cause === "tick" && event.stepIndex === 1) void engine.seekPositionMs(BEAT_MS * 5.5);
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.5 };
    await vi.advanceTimersByTimeAsync(10);

    expect(steps).toEqual(["play:0@0", `tick:1@${BEAT_MS}`, `seek:1@${BEAT_MS * 5.5}`]);

    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 6.1 };
    await vi.advanceTimersByTimeAsync(10);

    expect(steps.slice(3)).toEqual([`tick:2@${BEAT_MS * 6}`]);
  });

  it("does not dispatch a stale tick step after a section listener seeks synchronously", async () => {
    const transport = new ManualTransport();
    const engine = new ArrangementEngine(
      singleSection(8, [
        { id: "a", startBeat: 0, endBeat: 2 },
        { id: "b", startBeat: 2, endBeat: 8 },
      ]),
      { transport, lookaheadMs: 10 },
    );
    const steps: string[] = [];
    engine.on("step", (event) => steps.push(stepLabel(event)));
    engine.on("section", (event) => {
      if (event.cause === "tick" && event.section?.id === "b") void engine.seekPositionMs(BEAT_MS * 5.5);
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.5 };
    await vi.advanceTimersByTimeAsync(10);

    expect(steps).toEqual(["play:0@0", `seek:3@${BEAT_MS * 5.5}`]);
  });

  it("emits no step after local end when a step listener disables loop mid catch-up", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(singleSection(4, [{ id: "s", startBeat: 0, endBeat: 4 }]), {
      transport,
      lookaheadMs: 10,
      loop: true,
    });
    const log: string[] = [];
    engine.on("playback", (event) => log.push(`playback:${event.type}`));
    engine.on("step", (event) => {
      log.push(`step:${stepLabel(event)}`);
      if (event.cause === "tick" && event.stepIndex === 1) engine.setLoop(false);
    });

    await engine.play();
    clock.advance(BEAT_MS * 4.2);
    await vi.advanceTimersByTimeAsync(10);
    clock.advance(BEAT_MS * 2.3);
    await vi.advanceTimersByTimeAsync(10);

    expect(log.slice(-3)).toEqual([`step:tick:1@${BEAT_MS}`, "playback:loopchange", "playback:ended"]);
    expect(engine.getPlaybackState()).toBe("ended");
  });

  it("does not announce local end after a section listener loads a longer arrangement there", async () => {
    const { clock, transport } = buildTransport();
    const shorter = singleSection(2, [{ id: "s", startBeat: 0, endBeat: 2 }]);
    const longer = singleSection(8, [{ id: "s", startBeat: 0, endBeat: 8 }]);
    const engine = new ArrangementEngine(shorter, { transport, lookaheadMs: 10 });
    const playback: string[] = [];
    engine.on("playback", (event) => playback.push(`${event.type}:${event.snapshot.state}`));
    engine.on("section", (event) => {
      if (event.cause === "tick" && engine.getArrangement() === shorter) engine.setArrangement(longer);
    });

    await engine.play();
    clock.advance(BEAT_MS * 2.2);
    await vi.advanceTimersByTimeAsync(10);

    expect(playback).toEqual(["play:playing"]);
    expect(engine.getPlaybackState()).toBe("playing");
    expect(engine.getPosition()).toEqual({ positionMs: BEAT_MS * 2, beat: 2 });
  });

  // A third-party transport may emit "pause" synchronously inside pause().
  class PausingTransport extends ManualTransport {
    override async pause(): Promise<void> {
      this.emitEvent({ type: "pause", snapshot: { ...this.snapshot, state: "paused" } });
    }
  }

  it("finishes a catch-up batch that a step listener pauses, without replaying it after resume", async () => {
    const transport = new PausingTransport();
    const engine = new ArrangementEngine(singleSection(8, [{ id: "s", startBeat: 0, endBeat: 8 }]), {
      transport,
      lookaheadMs: 10,
    });
    const log: string[] = [];
    engine.on("playback", (event) => log.push(`playback:${event.type}`));
    engine.on("step", (event) => {
      log.push(`step:${stepLabel(event)}`);
      if (event.cause === "tick" && event.stepIndex === 1) void engine.pause();
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 3.5 };
    await vi.advanceTimersByTimeAsync(10);

    expect(log).toEqual([
      "playback:play",
      "step:play:0@0",
      `step:tick:1@${BEAT_MS}`,
      "playback:pause",
      `step:tick:2@${BEAT_MS * 2}`,
      `step:tick:3@${BEAT_MS * 3}`,
    ]);

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 4.1 };
    await vi.advanceTimersByTimeAsync(10);

    expect(log.slice(6)).toEqual(["playback:play", `step:tick:0@${BEAT_MS * 4}`]);
  });

  it("PB-EN-030 announces local end when a pause lands past local end before the tick", async () => {
    const { clock, transport } = buildTransport();
    const engine = new ArrangementEngine(singleSection(2, [{ id: "s", startBeat: 0, endBeat: 2 }]), {
      transport,
      lookaheadMs: 10,
    });
    const playback: string[] = [];
    engine.on("playback", (event) => playback.push(`${event.type}:${event.cause}:${event.previousState}`));

    await engine.play();
    clock.currentTime = BEAT_MS * 2.2;
    await engine.pause();
    await vi.advanceTimersByTimeAsync(50);

    expect(playback).toEqual(["play:command:stopped", "pause:command:playing", "ended:local-end:playing"]);
    expect(engine.getPlaybackState()).toBe("ended");
  });

  it("PB-EN-030 announces local end once when a section listener pauses at local end", async () => {
    const transport = new PausingTransport();
    const engine = new ArrangementEngine(singleSection(2, [{ id: "s", startBeat: 0, endBeat: 2 }]), {
      transport,
      lookaheadMs: 10,
    });
    const playback: string[] = [];
    engine.on("playback", (event) => playback.push(`${event.type}:${event.cause}`));
    engine.on("section", (event) => {
      if (event.cause === "tick") void engine.pause();
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.2 };
    await vi.advanceTimersByTimeAsync(10);

    expect(playback).toEqual(["play:command", "pause:command", "ended:local-end"]);
    expect(engine.getPlaybackState()).toBe("ended");
  });
});
