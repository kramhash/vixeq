import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClockTransport,
  type PlaybackSnapshot,
  type PlaybackTransport,
  type PlaybackTransportEvent,
} from "../playbackTransport";
import type { PlaybackClock } from "../types";
import { TimelineEngine } from "./TimelineEngine";
import { addTimelineEvent, createTimelineProject } from "./index";
import type { TimelineCueEvent, TimelineEvent, TimelinePlaybackEvent, TimelineProject } from "./types";

class FakeClock implements PlaybackClock {
  currentTime = 0;
  private nextTimerId = 1;
  private timers: Array<{ id: number; dueAt: number; callback: () => void }> = [];

  now(): number {
    return this.currentTime;
  }

  setTimer(callback: () => void, delayMs: number): unknown {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.push({ id, dueAt: this.currentTime + delayMs, callback });
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
  playError: Error | null = null;
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
    if (this.playError) throw this.playError;
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

const projectWithEvents = (
  durationBeats: number,
  events: Array<Pick<TimelineEvent, "id" | "beat" | "type">>,
): TimelineProject =>
  createTimelineProject({
    timing: { bpm: 60 },
    durationBeats,
    events: events.map((event) => ({ ...event, trackId: null })),
  });

const tickEngine = async (clock: FakeClock, ms: number, lookaheadMs = 10): Promise<void> => {
  clock.advance(ms);
  await vi.advanceTimersByTimeAsync(lookaheadMs);
};

afterEach(() => {
  vi.useRealTimers();
});

describe("TimelineEngine", () => {
  it("validates constructor options and registers the onCue convenience handler", async () => {
    vi.useFakeTimers();
    const project = projectWithEvents(1, [{ id: "zero", beat: 0, type: "cue" }]);
    const onCue = vi.fn();

    expect(() => new TimelineEngine(project, null as unknown as Record<string, never>)).toThrow(TypeError);
    expect(() => new TimelineEngine(project, { lookaheadMs: -1 })).toThrow(RangeError);
    expect(() => new TimelineEngine(project, { loop: "yes" as unknown as boolean })).toThrow(TypeError);
    expect(() => new TimelineEngine(project, { missedCuePolicy: "drop" as unknown as "emit" })).toThrow(TypeError);
    expect(() => new TimelineEngine(project, {
      eventValidator: () => {
        throw new Error("domain invalid");
      },
    })).toThrow(TypeError);

    const engine = new TimelineEngine(project, {
      transport: createClockTransport(new FakeClock()),
      onCue,
    });

    await engine.play();

    expect(onCue).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ id: "zero" }) }));
  });

  it("TL-EN-004 TL-EN-008 dispatches cue events from play and natural ticks", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const project = projectWithEvents(4, [
      { id: "zero", beat: 0, type: "cue" },
      { id: "one", beat: 1, type: "cue" },
    ]);
    const cues: TimelineCueEvent[] = [];
    const engine = new TimelineEngine(project, { transport, lookaheadMs: 10 });
    engine.on("cue", (event) => cues.push(event));

    await engine.play();
    await tickEngine(clock, 1_000);

    expect(cues.map((cue) => cue.event.id)).toEqual(["zero", "one"]);
    expect(cues[0]).toMatchObject({
      iteration: 0,
      scheduledPositionMs: 0,
      transportPositionMs: 0,
      lateByMs: 0,
    });
  });

  it("TL-EN-002 TL-EN-003 TL-EN-006 seekBeat emits playback seek without cue events and validates the beat range", async () => {
    vi.useFakeTimers();
    const transport = createClockTransport(new FakeClock());
    const engine = new TimelineEngine(projectWithEvents(4, [{ id: "one", beat: 1, type: "cue" }]), {
      transport,
    });
    const cues: TimelineCueEvent[] = [];
    const playbackTypes: string[] = [];
    engine.on("cue", (event) => cues.push(event));
    engine.on("playback", (event) => playbackTypes.push(event.type));

    await engine.seekBeat(1);

    expect(cues).toEqual([]);
    expect(playbackTypes).toEqual(["seek"]);
    expect(engine.getPosition()).toEqual({ positionMs: 1_000, beat: 1 });
    expect(() => engine.seekBeat(5)).toThrow(RangeError);
  });

  it("TL-EN-011 reaches local ended without stopping a shared transport", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const engine = new TimelineEngine(projectWithEvents(2, [{ id: "one", beat: 1, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
    });
    const playbackTypes: string[] = [];
    engine.on("playback", (event) => playbackTypes.push(event.type));

    await engine.play();
    await tickEngine(clock, 2_000);

    expect(engine.getPlaybackState()).toBe("ended");
    expect(transport.getPlaybackState()).toBe("playing");
    expect(playbackTypes).toContain("ended");
  });

  it("replays from local ended while the shared transport keeps running", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const engine = new TimelineEngine(projectWithEvents(1, [{ id: "zero", beat: 0, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
    });
    const playback: string[] = [];
    const cues: string[] = [];
    engine.on("playback", (event) => playback.push(`${event.type}:${event.previousState}`));
    engine.on("cue", (event) => cues.push(`${event.event.id}:${event.scheduledPositionMs}`));

    await engine.play();
    await tickEngine(clock, 1_000);
    playback.length = 0;
    cues.length = 0;

    await engine.play();

    expect(transport.getPlaybackState()).toBe("playing");
    expect(playback).toEqual(["play:ended"]);
    expect(cues).toEqual(["zero:0"]);
  });

  it("seeks then plays when replaying from ended after the transport stopped", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: 1_000 });
    const engine = new TimelineEngine(projectWithEvents(1, [{ id: "zero", beat: 0, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
    });
    const playback: string[] = [];
    const cues: string[] = [];
    engine.on("playback", (event) => playback.push(`${event.type}:${event.previousState}`));
    engine.on("cue", (event) => cues.push(event.event.id));

    await engine.play();
    clock.advance(1_000);
    playback.length = 0;
    cues.length = 0;

    await engine.play();

    expect(transport.getPlaybackState()).toBe("playing");
    expect(playback).toEqual(["play:ended"]);
    expect(cues).toEqual(["zero"]);
  });

  it("TL-EN-007 dispatches local loop boundaries in time order and includes beat-0 cues each iteration", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const engine = new TimelineEngine(
      projectWithEvents(2, [
        { id: "zero", beat: 0, type: "cue" },
        { id: "one", beat: 1, type: "cue" },
      ]),
      { transport, loop: true, lookaheadMs: 10 },
    );
    const cues: string[] = [];
    engine.on("cue", (event) => cues.push(`${event.event.id}:${event.iteration}`));

    await engine.play();
    await tickEngine(clock, 2_500);

    expect(cues).toEqual(["zero:0", "one:0", "zero:1"]);
    expect(engine.getPlaybackState()).toBe("playing");
    expect(engine.getPosition()).toEqual({ positionMs: 500, beat: 0.5 });
  });

  it("does not emit historical or current cues when attached to an already-playing transport", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    await transport.play();
    clock.advance(1_000);

    const engine = new TimelineEngine(
      projectWithEvents(4, [
        { id: "one", beat: 1, type: "cue" },
        { id: "two", beat: 2, type: "cue" },
      ]),
      { transport, lookaheadMs: 10 },
    );
    const cues: string[] = [];
    engine.on("cue", (event) => cues.push(event.event.id));

    await tickEngine(clock, 1_000);

    expect(cues).toEqual(["two"]);
  });

  it("TL-EN-009 TL-EN-010 atomically hot-swaps projects, preserves beat position, and avoids retroactive cues", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const engine = new TimelineEngine(projectWithEvents(4, [{ id: "old", beat: 3, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
    });
    const nextProject = projectWithEvents(4, [
      { id: "retro", beat: 0.5, type: "cue" },
      { id: "future", beat: 1.5, type: "cue" },
    ]);
    const cues: string[] = [];
    engine.on("cue", (event) => cues.push(event.event.id));

    await engine.seekBeat(1);
    engine.setProject(nextProject);
    await engine.play();
    await tickEngine(clock, 500);

    expect(engine.getPosition()).toEqual({ positionMs: 1_500, beat: 1.5 });
    expect(cues).toEqual(["future"]);
  });

  it("setProject no-ops for the same reference and transitions to ended when the next project is shorter", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const project = projectWithEvents(4, [{ id: "future", beat: 3, type: "cue" }]);
    const engine = new TimelineEngine(project, { transport });
    const projectEvents: unknown[] = [];
    const playback: string[] = [];
    engine.on("project", (event) => projectEvents.push(event));
    engine.on("playback", (event) => playback.push(`${event.type}:${event.snapshot.state}`));

    await engine.play();
    clock.advance(3_000);
    engine.setProject(project);
    engine.setProject(projectWithEvents(2, [{ id: "short", beat: 1, type: "cue" }]));

    expect(projectEvents).toHaveLength(1);
    expect(engine.getPlaybackState()).toBe("ended");
    expect(playback.at(-1)).toBe("ended:ended");
  });

  it("missedCuePolicy skip discards late cues but keeps on-time cues", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const engine = new TimelineEngine(
      projectWithEvents(4, [
        { id: "late", beat: 0.1, type: "cue" },
        { id: "current", beat: 1, type: "cue" },
      ]),
      { transport, lookaheadMs: 10, missedCuePolicy: "skip" },
    );
    const cues: string[] = [];
    engine.on("cue", (event) => cues.push(event.event.id));

    await engine.play();
    await tickEngine(clock, 1_000);

    expect(cues).toEqual(["current"]);
  });

  it("TL-EN-005 missedCuePolicy skip keeps only the most-advanced due event when several are due in one tick", async () => {
    // Regression: an earlier implementation filtered each due event
    // independently against lookaheadMs instead of keeping only the last
    // one, so two events closer together than lookaheadMs both fired.
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const engine = new TimelineEngine(
      projectWithEvents(4, [
        { id: "earlier", beat: 0.1, type: "cue" },
        { id: "later", beat: 0.2, type: "cue" },
      ]),
      { transport, lookaheadMs: 200, missedCuePolicy: "skip" },
    );
    const cues: string[] = [];
    engine.on("cue", (event) => cues.push(event.event.id));

    await engine.play();
    await tickEngine(clock, 250, 200);

    expect(cues).toEqual(["later"]);
  });

  it("missedCuePolicy skip still dispatches the sole due event after a stall longer than lookaheadMs", async () => {
    // Regression: an earlier implementation dropped a due event entirely
    // once its lateness exceeded lookaheadMs, even though "skip" guarantees
    // the most-advanced due event always fires exactly once.
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const engine = new TimelineEngine(projectWithEvents(10, [{ id: "stale", beat: 0.1, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
      missedCuePolicy: "skip",
    });
    const cues: string[] = [];
    engine.on("cue", (event) => cues.push(event.event.id));

    await engine.play();
    await tickEngine(clock, 5_000, 10);

    expect(cues).toEqual(["stale"]);
  });

  it("missedCuePolicy emit reports a nonzero lateByMs for a stalled cue", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const engine = new TimelineEngine(projectWithEvents(10, [{ id: "stale", beat: 0.1, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
    });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => cues.push(event));

    await engine.play();
    await tickEngine(clock, 5_000, 10);

    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ scheduledPositionMs: 100, transportPositionMs: 5_000 });
    expect(cues[0].lateByMs).toBeGreaterThan(0);
  });

  it("setLoop off while past the local duration transitions to ended", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const engine = new TimelineEngine(projectWithEvents(1, [{ id: "zero", beat: 0, type: "cue" }]), {
      transport,
      loop: true,
      lookaheadMs: 10,
    });
    const playback: string[] = [];
    engine.on("playback", (event) => playback.push(`${event.type}:${event.snapshot.state}`));

    await engine.play();
    clock.advance(1_500);
    engine.setLoop(false);

    expect(engine.getPlaybackState()).toBe("ended");
    expect(playback.at(-2)).toBe("loopchange:ended");
    expect(playback.at(-1)).toBe("ended:ended");
  });

  it("maps external transport state changes and disposal to playback snapshots", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: 2_000 });
    const engine = new TimelineEngine(projectWithEvents(2, [{ id: "one", beat: 1, type: "cue" }]), {
      transport,
    });
    const playback: string[] = [];
    engine.on("playback", (event) => playback.push(`${event.type}:${event.cause}:${event.snapshot.state}`));

    await transport.seekMs(500);
    await transport.setPlaybackRate(2);
    transport.dispose();

    expect(playback).toEqual([
      "seek:transport:paused",
      "ratechange:transport:paused",
      "error:transport:paused",
    ]);
    await expect(engine.play()).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
  });

  it("preserves paused and ended state when the transport is disposed", async () => {
    vi.useFakeTimers();
    const pausedClock = new FakeClock();
    const pausedTransport = createClockTransport(pausedClock);
    const pausedEngine = new TimelineEngine(projectWithEvents(2, []), { transport: pausedTransport });
    await pausedEngine.play();
    pausedClock.advance(400);
    await pausedEngine.pause();
    pausedTransport.dispose();

    expect(pausedEngine.getPlaybackState()).toBe("paused");
    expect(pausedEngine.getPosition().positionMs).toBe(400);

    const endedClock = new FakeClock();
    const endedTransport = createClockTransport(endedClock, { durationMs: 1_000 });
    const endedEngine = new TimelineEngine(projectWithEvents(1, []), { transport: endedTransport });
    await endedEngine.play();
    endedClock.advance(1_000);
    endedTransport.dispose();

    expect(endedEngine.getPlaybackState()).toBe("ended");
    expect(endedEngine.getPosition().positionMs).toBe(1_000);
  });

  it("validates seekPositionMs and public APIs after disposal", async () => {
    const transport = createClockTransport(new FakeClock());
    const engine = new TimelineEngine(projectWithEvents(2, []), { transport });

    await engine.seekPositionMs(500);
    expect(engine.getPosition()).toEqual({ positionMs: 500, beat: 0.5 });
    expect(() => engine.seekPositionMs(-1)).toThrow(RangeError);
    expect(() => engine.seekPositionMs(2_001)).toThrow(RangeError);

    engine.dispose();
    engine.dispose();

    expect(transport.getPlaybackState()).toBe("paused");
    expect(() => engine.getProject()).toThrowError(expect.objectContaining({ code: "TRANSPORT_DISPOSED" }));
    expect(() => engine.on("cue", () => undefined)).toThrowError(expect.objectContaining({ code: "TRANSPORT_DISPOSED" }));
    expect(() => engine.setProject(projectWithEvents(2, []))).toThrowError(expect.objectContaining({ code: "TRANSPORT_DISPOSED" }));
    expect(() => engine.play()).toThrowError(expect.objectContaining({ code: "TRANSPORT_DISPOSED" }));
  });

  it("rejects controls after transport disposal", async () => {
    const transport = createClockTransport(new FakeClock());
    const engine = new TimelineEngine(projectWithEvents(2, []), { transport });
    transport.dispose();

    await expect(engine.pause()).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
    await expect(engine.stop()).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
    await expect(engine.seekBeat(1)).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
    await expect(engine.seekPositionMs(500)).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
  });

  it("TL-EN-001 does not implement ChannelSource (no sampleChannels methods)", () => {
    const engine = new TimelineEngine(createTimelineProject({ durationBeats: 4 }), {
      transport: createClockTransport(new FakeClock()),
    });

    expect((engine as unknown as { sampleChannels?: unknown }).sampleChannels).toBeUndefined();
    expect((engine as unknown as { sampleChannelsAt?: unknown }).sampleChannelsAt).toBeUndefined();
  });

  it("TL-EN-012 TL-EN-013 dispatches only the due slice from a 100,000 event fixture", async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const events: TimelineEvent[] = Array.from({ length: 100_000 }, (_, index) => ({
      id: `event-${index}`,
      trackId: null,
      beat: index / 100,
      type: "cue",
    }));
    const engine = new TimelineEngine(
      createTimelineProject({
        timing: { bpm: 60 },
        durationBeats: 1_001,
        events,
      }),
      { transport, lookaheadMs: 10 },
    );
    const cues: string[] = [];
    engine.on("cue", (event) => cues.push(event.event.id));

    await engine.seekBeat(500);
    await engine.play();
    await tickEngine(clock, 50);

    expect(cues).toEqual(["event-50001", "event-50002", "event-50003", "event-50004", "event-50005"]);
  });
});

describe("TimelineEngine — RC1D branch coverage", () => {
  const BEAT_MS = 1_000;
  const threeCues = (): TimelineProject =>
    projectWithEvents(4, [
      { id: "one", beat: 1, type: "cue" },
      { id: "two", beat: 2, type: "cue" },
      { id: "three", beat: 3, type: "cue" },
    ]);
  const buildTransport = (): { clock: FakeClock; transport: PlaybackTransport } => {
    const clock = new FakeClock();
    return { clock, transport: createClockTransport(clock) };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isolates listener failures through onListenerError and its fallbacks", async () => {
    vi.useFakeTimers();
    const project = projectWithEvents(4, [{ id: "zero", beat: 0, type: "cue" }]);
    const throwing = (): void => {
      throw new Error("cue listener failed");
    };

    const onListenerError = vi.fn();
    const reported = new TimelineEngine(project, { transport: buildTransport().transport, onListenerError });
    reported.on("cue", throwing);
    await reported.play();
    expect(onListenerError).toHaveBeenCalledWith(expect.any(Error), { source: "engine", eventName: "cue" });

    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const fallback = new TimelineEngine(project, {
      transport: buildTransport().transport,
      onListenerError: () => {
        throw new Error("reporter failed");
      },
    });
    fallback.on("cue", throwing);
    await fallback.play();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "reporter failed" }));

    vi.stubGlobal("reportError", undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logged = new TimelineEngine(project, { transport: buildTransport().transport });
    logged.on("cue", throwing);
    try {
      await logged.play();
      expect(consoleError).toHaveBeenCalledWith(expect.any(Error));
    } finally {
      consoleError.mockRestore();
    }

    const originalConsole = console;
    const silent = new TimelineEngine(project, { transport: buildTransport().transport });
    const healthy = vi.fn();
    silent.on("cue", throwing);
    silent.on("cue", healthy);
    vi.stubGlobal("console", undefined);
    try {
      await expect(silent.play()).resolves.toBeUndefined();
    } finally {
      vi.stubGlobal("console", originalConsole);
    }
    expect(healthy).toHaveBeenCalledOnce();
  });

  it("disposes an Engine-owned browser-clock transport with the Engine", async () => {
    vi.useFakeTimers();
    const engine = new TimelineEngine(threeCues());
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => cues.push(event));
    await engine.play();

    engine.dispose();
    await vi.advanceTimersByTimeAsync(BEAT_MS * 2);

    expect(cues).toEqual([]);
    expect(() => engine.getPlaybackState()).toThrow(/disposed/);
  });

  it("rejects stop once the transport is disposed", async () => {
    const { transport } = buildTransport();
    const engine = new TimelineEngine(threeCues(), { transport });
    transport.dispose();

    await expect(engine.stop()).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
  });

  it("validates setLoop, ignores unchanged values, and keeps playing when loop is enabled", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(threeCues(), { transport, lookaheadMs: 10 });
    const playback: TimelinePlaybackEvent[] = [];
    const cues: TimelineCueEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("cue", (event) => cues.push(event));

    expect(() => engine.setLoop(1 as unknown as boolean)).toThrow(TypeError);
    engine.setLoop(false);
    expect(playback).toEqual([]);

    await engine.play();
    engine.setLoop(true);
    await tickEngine(clock, BEAT_MS);

    expect(engine.getPlaybackState()).toBe("playing");
    expect(playback.at(-1)).toMatchObject({ type: "loopchange", snapshot: { projectLoop: true } });
    expect(cues.map((cue) => cue.event.id)).toEqual(["one"]);
  });

  it("wraps the preserved beat into a shorter looping project on hot-swap", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(threeCues(), { transport, loop: true, lookaheadMs: 10 });
    await engine.play();
    await tickEngine(clock, BEAT_MS * 3.5);

    engine.setProject(projectWithEvents(2, [{ id: "late", beat: 1.75, type: "cue" }]));

    expect(engine.getPosition()).toEqual({ positionMs: BEAT_MS * 1.5, beat: 1.5 });
    expect(engine.getPlaybackState()).toBe("playing");
  });

  it("does not let no-op commands leave stale command markers", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(threeCues(), { transport });
    const playback: TimelinePlaybackEvent[] = [];
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
    const transport = createClockTransport(clock, { durationMs: BEAT_MS });
    const engine = new TimelineEngine(threeCues(), { transport });
    const playback: TimelinePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    expect(() => engine.seekBeat(2)).toThrow(RangeError);
    await transport.seekMs(BEAT_MS / 2);

    expect(playback).toMatchObject([{ type: "seek", cause: "transport" }]);
  });

  it("ignores transport events that arrive after disposal within the same dispatch", async () => {
    const { transport } = buildTransport();
    let engine: TimelineEngine | undefined;
    transport.subscribe((event) => {
      if (event.type === "play") engine?.dispose();
    });
    engine = new TimelineEngine(projectWithEvents(4, [{ id: "zero", beat: 0, type: "cue" }]), { transport });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => cues.push(event));

    await transport.play();

    expect(cues).toEqual([]);
    expect(() => engine?.getPlaybackState()).toThrow(/disposed/);
  });

  it("reports local end instead of play when the transport resumes past the timeline", async () => {
    const { transport } = buildTransport();
    const engine = new TimelineEngine(threeCues(), { transport });
    const playback: TimelinePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    await transport.seekMs(BEAT_MS * 5);
    await transport.play();

    expect(engine.getPlaybackState()).toBe("ended");
    expect(playback.at(-1)).toMatchObject({ type: "ended", cause: "local-end", previousState: "ended" });
  });

  it("stops to zero and dispatches beat-0 cues again on the next play", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(projectWithEvents(4, [{ id: "zero", beat: 0, type: "cue" }]), { transport });
    const playback: TimelinePlaybackEvent[] = [];
    const cues: TimelineCueEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("cue", (event) => cues.push(event));
    await engine.play();
    clock.advance(BEAT_MS);

    await engine.stop();

    expect(playback.at(-1)).toMatchObject({ type: "stop", cause: "command", snapshot: { positionMs: 0 } });
    await engine.play();
    expect(cues.map((cue) => cue.event.id)).toEqual(["zero", "zero"]);
  });

  it("does not re-dispatch when a tick finds the transport has not advanced", async () => {
    vi.useFakeTimers();
    const { transport } = buildTransport();
    const engine = new TimelineEngine(projectWithEvents(4, [{ id: "zero", beat: 0, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
    });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => cues.push(event));
    await engine.play();

    await vi.advanceTimersByTimeAsync(30);

    expect(cues.map((cue) => cue.event.id)).toEqual(["zero"]);
  });

  it("freezes position and cues while a transport reports buffering", async () => {
    vi.useFakeTimers();
    const transport = new ManualTransport();
    const engine = new TimelineEngine(threeCues(), { transport, lookaheadMs: 10 });
    const playback: TimelinePlaybackEvent[] = [];
    const cues: TimelineCueEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("cue", (event) => cues.push(event));
    await engine.play();

    transport.emitEvent({
      type: "bufferingchange",
      previousBuffering: false,
      snapshot: { ...transport.snapshot, buffering: true },
    });
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 1.5 };
    await vi.advanceTimersByTimeAsync(50);

    expect(playback.at(-1)).toMatchObject({ type: "bufferingchange", snapshot: { buffering: true } });
    expect(engine.getPosition().positionMs).toBe(0);
    expect(cues).toEqual([]);

    transport.emitEvent({
      type: "bufferingchange",
      previousBuffering: true,
      snapshot: { ...transport.snapshot, buffering: false },
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(cues.map((cue) => cue.event.id)).toEqual(["one"]);
  });

  it("forwards transport errors and other transport events with cause transport", () => {
    const transport = new ManualTransport();
    const engine = new TimelineEngine(threeCues(), { transport });
    const playback: TimelinePlaybackEvent[] = [];
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
    vi.useFakeTimers();
    const transport = new ManualTransport();
    const engine = new TimelineEngine(threeCues(), { transport, lookaheadMs: 10 });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => cues.push(event));
    await engine.play();

    transport.emitEvent({
      type: "error",
      error: new Error("decoder failed"),
      snapshot: { ...transport.snapshot, state: "paused" },
    });
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2 };
    await vi.advanceTimersByTimeAsync(50);

    expect(engine.getPlaybackState()).toBe("paused");
    expect(cues).toEqual([]);
  });

  it("dispatches cues at the resume position after a rejected replay is resumed externally", async () => {
    vi.useFakeTimers();
    const transport = new ManualTransport();
    const engine = new TimelineEngine(projectWithEvents(4, [{ id: "zero", beat: 0, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
    });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => cues.push(event));
    transport.emitEvent({ type: "ended", snapshot: { ...transport.snapshot, state: "ended", positionMs: BEAT_MS * 4 } });
    transport.playError = new Error("NotAllowedError");

    await expect(engine.play()).rejects.toThrow("NotAllowedError");
    transport.playError = null;
    await transport.play();
    await vi.advanceTimersByTimeAsync(10);

    expect(cues.map((cue) => cue.event.id)).toEqual(["zero"]);
  });

  it("pauses at the cached position when the transport is disposed during playback", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(threeCues(), { transport });
    const playback: TimelinePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    await engine.play();
    clock.advance(100);

    transport.dispose();

    expect(engine.getPlaybackState()).toBe("paused");
    expect(engine.getPosition().positionMs).toBe(100);
    expect(playback.at(-1)).toMatchObject({ type: "error", cause: "transport", previousState: "playing" });
  });

  it("stops scheduling when a cue listener disposes the shared transport mid-tick", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(threeCues(), { transport, lookaheadMs: 10 });
    engine.on("cue", () => transport.dispose());
    await engine.play();

    await tickEngine(clock, BEAT_MS);

    expect(engine.getPlaybackState()).toBe("paused");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops replaying missed cues once a cue listener replaces the project", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const original = threeCues();
    const replacement = projectWithEvents(4, [
      { id: "new-early", beat: 1.5, type: "cue" },
      { id: "new-late", beat: 3.75, type: "cue" },
    ]);
    const engine = new TimelineEngine(original, { transport, lookaheadMs: 10 });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => {
      cues.push(event);
      if (event.event.id === "one") engine.setProject(replacement);
    });
    await engine.play();

    await tickEngine(clock, BEAT_MS * 3.5);
    await tickEngine(clock, BEAT_MS * 0.5);

    expect(cues.map((cue) => cue.event.id)).toEqual(["one", "new-late"]);
  });

  it("stops replaying missed loop iterations once a cue listener turns loop off", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(threeCues(), { transport, loop: true, lookaheadMs: 10 });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => {
      cues.push(event);
      if (event.event.id === "one") engine.setLoop(false);
    });
    await engine.play();

    await tickEngine(clock, BEAT_MS * 5.5);

    expect(cues.map((cue) => cue.event.id)).toEqual(["one"]);
    expect(engine.getPlaybackState()).toBe("ended");
  });

  it("stops replaying missed cues once a cue listener disposes the Engine", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(threeCues(), { transport, loop: true, lookaheadMs: 10 });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => {
      cues.push(event);
      engine.dispose();
    });
    await engine.play();

    await tickEngine(clock, BEAT_MS * 3.5);

    expect(cues.map((cue) => cue.event.id)).toEqual(["one"]);
  });

  it("stops delivering events to an unsubscribed listener", async () => {
    const engine = new TimelineEngine(threeCues(), { transport: buildTransport().transport });
    const listener = vi.fn();
    const unsubscribe = engine.on("playback", listener);

    unsubscribe();
    await engine.play();

    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects a replay from local end when the transport is disposed before it runs", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(threeCues(), { transport, lookaheadMs: 10 });
    await engine.play();
    await tickEngine(clock, BEAT_MS * 4);
    expect(engine.getPlaybackState()).toBe("ended");

    const replay = engine.play();
    transport.dispose();

    await expect(replay).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
    expect(engine.getPlaybackState()).toBe("ended");
  });

  it("hot-swaps and toggles loop at the cached position after the transport is disposed", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const project = threeCues();
    const engine = new TimelineEngine(project, { transport });
    await engine.play();
    clock.advance(BEAT_MS);
    transport.dispose();

    engine.setProject({ ...project, timing: { ...project.timing, tempos: [{ beat: 0, bpm: 30 }] } });

    expect(engine.getPosition()).toEqual({ positionMs: BEAT_MS * 2, beat: 1 });

    engine.setLoop(true);

    expect(engine.getPlaybackState()).toBe("paused");
    expect(engine.getPosition()).toEqual({ positionMs: BEAT_MS * 2, beat: 1 });
  });
});
