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

  describe("TL-EN-014 delayed tick across local loop wraps", () => {
    const loopingCues = (missedCuePolicy: "emit" | "skip") => {
      const clock = new FakeClock();
      const transport = createClockTransport(clock);
      const engine = new TimelineEngine(
        projectWithEvents(4, [
          { id: "e1", beat: 1, type: "cue" },
          { id: "e3", beat: 3, type: "cue" },
        ]),
        { transport, loop: true, lookaheadMs: 10, missedCuePolicy },
      );
      const cues: string[] = [];
      engine.on("cue", (event) =>
        cues.push(`${event.event.id}#${event.iteration}@${event.scheduledPositionMs}+${event.lateByMs}`),
      );
      return { clock, engine, cues };
    };

    it("missedCuePolicy skip dispatches only the most-advanced due cue of a tick that crosses two wraps", async () => {
      vi.useFakeTimers();
      const { clock, engine, cues } = loopingCues("skip");

      await engine.play();
      await tickEngine(clock, 1_500);
      await tickEngine(clock, 8_000);

      expect(cues).toEqual(["e1#0@1000+500", "e1#2@9000+500"]);
      engine.dispose();
    });

    it("missedCuePolicy skip discards the previous iteration's missed cue when the landing iteration has a due cue", async () => {
      vi.useFakeTimers();
      const { clock, engine, cues } = loopingCues("skip");

      await engine.play();
      await tickEngine(clock, 1_500);
      await tickEngine(clock, 4_000);

      expect(cues).toEqual(["e1#0@1000+500", "e1#1@5000+500"]);
      engine.dispose();
    });

    it("missedCuePolicy skip keeps the last cue of the previous iteration when the tick lands before the first cue of the new one", async () => {
      vi.useFakeTimers();
      const { clock, engine, cues } = loopingCues("skip");

      await engine.play();
      await tickEngine(clock, 1_500);
      await tickEngine(clock, 3_000);

      expect(cues).toEqual(["e1#0@1000+500", "e3#0@3000+1500"]);
      engine.dispose();
    });

    it("missedCuePolicy skip dispatches nothing when a tick crosses a wrap with no due cue", async () => {
      vi.useFakeTimers();
      const { clock, engine, cues } = loopingCues("skip");

      await engine.play();
      await tickEngine(clock, 3_500);
      cues.length = 0;
      await tickEngine(clock, 1_300);

      expect(cues).toEqual([]);
      await tickEngine(clock, 400);
      expect(cues).toEqual(["e1#1@5000+200"]);
      engine.dispose();
    });

    it("missedCuePolicy emit dispatches every cue of every crossed iteration in order", async () => {
      vi.useFakeTimers();
      const { clock, engine, cues } = loopingCues("emit");

      await engine.play();
      await tickEngine(clock, 1_500);
      await tickEngine(clock, 8_000);

      expect(cues).toEqual([
        "e1#0@1000+500",
        "e3#0@3000+6500",
        "e1#1@5000+4500",
        "e3#1@7000+2500",
        "e1#2@9000+500",
      ]);
      engine.dispose();
    });
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
    // Real timers: a playing Engine left behind would re-arm its tick inside later fake-timer tests.
    engine.dispose();
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

describe("TimelineEngine — RC1G re-entrancy", () => {
  const BEAT_MS = 1_000;
  const buildTransport = (): { clock: FakeClock; transport: PlaybackTransport } => {
    const clock = new FakeClock();
    return { clock, transport: createClockTransport(clock) };
  };

  it("keeps playing a longer project loaded by a cue listener during the local-end tick", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const shorter = projectWithEvents(2, [{ id: "last", beat: 1.5, type: "cue" }]);
    const longer = projectWithEvents(8, [{ id: "next", beat: 3, type: "cue" }]);
    const engine = new TimelineEngine(shorter, { transport, lookaheadMs: 10 });
    const playback: TimelinePlaybackEvent[] = [];
    const cues: TimelineCueEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("cue", (event) => {
      cues.push(event);
      if (event.event.id === "last") engine.setProject(longer);
    });

    await engine.play();
    await tickEngine(clock, BEAT_MS * 2.2);

    // The hot-swap preserves the logical beat, which the shorter project had
    // clamped to its end.
    expect(engine.getPlaybackState()).toBe("playing");
    expect(engine.getPosition()).toEqual({ positionMs: BEAT_MS * 2, beat: 2 });
    expect(playback.map((event) => event.type)).toEqual(["play"]);

    await tickEngine(clock, BEAT_MS);

    expect(cues.map((cue) => cue.event.id)).toEqual(["last", "next"]);
    expect(engine.getPlaybackState()).toBe("playing");
  });

  it("keeps looping when a cue listener enables loop during the local-end tick", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const project = projectWithEvents(2, [
      { id: "first", beat: 0.5, type: "cue" },
      { id: "last", beat: 1.5, type: "cue" },
    ]);
    const engine = new TimelineEngine(project, { transport, lookaheadMs: 10 });
    const playback: TimelinePlaybackEvent[] = [];
    const cues: TimelineCueEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("cue", (event) => {
      cues.push(event);
      if (event.event.id === "last" && event.iteration === 0) engine.setLoop(true);
    });

    await engine.play();
    clock.advance(BEAT_MS * 0.6);
    await vi.advanceTimersByTimeAsync(10);
    await tickEngine(clock, BEAT_MS * 1.6);

    expect(engine.getPlaybackState()).toBe("playing");
    expect(engine.getPosition()).toEqual({ positionMs: BEAT_MS * 0.2, beat: 0.2 });
    expect(playback.map((event) => event.type)).toEqual(["play", "loopchange"]);

    await tickEngine(clock, BEAT_MS * 0.4);

    expect(cues.map((cue) => `${cue.event.id}:${cue.iteration}`)).toEqual(["first:0", "last:0", "first:1"]);
  });

  it("does not dispatch the cues a cue listener seeks over synchronously", async () => {
    vi.useFakeTimers();
    const transport = new ManualTransport();
    const project = projectWithEvents(6, [
      { id: "one", beat: 1, type: "cue" },
      { id: "two", beat: 2, type: "cue" },
      { id: "three", beat: 3, type: "cue" },
      { id: "four", beat: 4, type: "cue" },
    ]);
    const engine = new TimelineEngine(project, { transport, lookaheadMs: 10 });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => {
      cues.push(event);
      if (event.event.id === "one") void engine.seekPositionMs(BEAT_MS * 3.5);
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.5 };
    await vi.advanceTimersByTimeAsync(10);

    expect(cues.map((cue) => cue.event.id)).toEqual(["one"]);

    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 4.1 };
    await vi.advanceTimersByTimeAsync(10);

    expect(cues.map((cue) => `${cue.event.id}@${cue.transportPositionMs}`)).toEqual(["one@2500", "four@4100"]);
  });

  it("stops dispatching same-beat cues at play once a cue listener replaces the project", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const original = projectWithEvents(4, [
      { id: "a1", beat: 0, type: "cue" },
      { id: "a2", beat: 0, type: "cue" },
    ]);
    const replacement = projectWithEvents(4, [{ id: "b1", beat: 0, type: "cue" }]);
    const engine = new TimelineEngine(original, { transport, lookaheadMs: 10 });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => {
      cues.push(event);
      if (event.event.id === "a1") engine.setProject(replacement);
    });

    await engine.play();
    await tickEngine(clock, BEAT_MS);

    expect(engine.getProject()).toBe(replacement);
    expect(cues.map((cue) => cue.event.id)).toEqual(["a1"]);
  });

  // A third-party transport may emit "pause" synchronously inside pause().
  class PausingTransport extends ManualTransport {
    override async pause(): Promise<void> {
      this.emitEvent({ type: "pause", snapshot: { ...this.snapshot, state: "paused" } });
    }
  }

  it("finishes a catch-up batch that a cue listener pauses, without replaying it after resume", async () => {
    vi.useFakeTimers();
    const transport = new PausingTransport();
    const project = projectWithEvents(6, [
      { id: "one", beat: 1, type: "cue" },
      { id: "two", beat: 2, type: "cue" },
      { id: "three", beat: 3, type: "cue" },
    ]);
    const engine = new TimelineEngine(project, { transport, lookaheadMs: 10 });
    const playback: string[] = [];
    const cues: string[] = [];
    engine.on("playback", (event) => playback.push(event.type));
    engine.on("cue", (event) => {
      cues.push(`${event.event.id}@${event.transportPositionMs}`);
      if (event.event.id === "one") void engine.pause();
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.5 };
    await vi.advanceTimersByTimeAsync(10);

    expect(playback).toEqual(["play", "pause"]);
    expect(cues).toEqual(["one@2500", "two@2500"]);

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.6 };
    await vi.advanceTimersByTimeAsync(10);
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 3.1 };
    await vi.advanceTimersByTimeAsync(10);

    expect(cues).toEqual(["one@2500", "two@2500", "three@3100"]);
  });

  it("dispatches a cue passed between the last tick and a pause on the first tick after resume", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const project = projectWithEvents(6, [{ id: "late", beat: 2.493, type: "cue" }]);
    const engine = new TimelineEngine(project, { transport, lookaheadMs: 10 });
    const cues: TimelineCueEvent[] = [];
    engine.on("cue", (event) => cues.push(event));

    await engine.play();
    await tickEngine(clock, 2_490);
    clock.advance(5);
    await engine.pause();
    await vi.advanceTimersByTimeAsync(0);
    await engine.play();
    await vi.advanceTimersByTimeAsync(0);
    await tickEngine(clock, 100);

    expect(cues.map((cue) => cue.event.id)).toEqual(["late"]);
  });

  it("PB-EN-030 announces local end once when a cue listener pauses during the local-end tick", async () => {
    vi.useFakeTimers();
    const transport = new PausingTransport();
    const engine = new TimelineEngine(projectWithEvents(2, [{ id: "last", beat: 1.5, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
    });
    const playback: TimelinePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));
    engine.on("cue", (event) => {
      if (event.event.id === "last") void engine.pause();
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.2 };
    await vi.advanceTimersByTimeAsync(10);

    expect(playback.map((event) => `${event.type}:${event.cause}`)).toEqual([
      "play:command",
      "pause:command",
      "ended:local-end",
    ]);
    expect(engine.getPlaybackState()).toBe("ended");
    expect(engine.getPosition()).toEqual({ positionMs: BEAT_MS * 2, beat: 2 });
  });

  it("PB-EN-030 announces local end when a pause lands past local end before the tick", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(projectWithEvents(2, []), { transport, lookaheadMs: 10 });
    const playback: TimelinePlaybackEvent[] = [];
    engine.on("playback", (event) => playback.push(event));

    await engine.play();
    clock.currentTime = BEAT_MS * 2.2;
    await engine.pause();
    await vi.advanceTimersByTimeAsync(50);

    expect(playback.map((event) => `${event.type}:${event.cause}:${event.previousState}`)).toEqual([
      "play:command:stopped",
      "pause:command:playing",
      "ended:local-end:playing",
    ]);
    expect(engine.getPlaybackState()).toBe("ended");
  });

  it("PB-EN-030 dispatches the cues due up to local end before ended when a pause lands past local end", async () => {
    vi.useFakeTimers();
    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(projectWithEvents(2, [{ id: "final", beat: 1.95, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
    });
    const log: string[] = [];
    engine.on("playback", (event) => log.push(`${event.type}:${event.cause}`));
    engine.on("cue", (event) => log.push(`cue:${event.event.id}@${event.transportPositionMs}`));

    await engine.play();
    await tickEngine(clock, BEAT_MS * 1.9);
    clock.advance(BEAT_MS * 0.3);
    await engine.pause();
    await vi.advanceTimersByTimeAsync(50);

    expect(log).toEqual(["play:command", "pause:command", "cue:final@2000", "ended:local-end"]);
    expect(engine.getPlaybackState()).toBe("ended");
  });

  it("stops the past-end pause dispatch when a cue listener seeks, and announces end once after a shorter hot-swap", async () => {
    vi.useFakeTimers();
    const project = projectWithEvents(4, [
      { id: "a", beat: 3.2, type: "cue" },
      { id: "b", beat: 3.6, type: "cue" },
    ]);
    const run = async (onA: (engine: TimelineEngine) => void): Promise<{ engine: TimelineEngine; log: string[] }> => {
      const transport = new PausingTransport();
      const engine = new TimelineEngine(project, { transport, lookaheadMs: 10 });
      const log: string[] = [];
      engine.on("playback", (event) => log.push(event.type));
      engine.on("cue", (event) => {
        log.push(`cue:${event.event.id}`);
        if (event.event.id === "a") onA(engine);
      });
      await engine.play();
      transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 3 };
      await vi.advanceTimersByTimeAsync(10);
      transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 4.5 };
      await engine.pause();
      return { engine, log };
    };

    const seeking = await run((engine) => void engine.seekPositionMs(BEAT_MS));
    expect(seeking.log).toEqual(["play", "pause", "cue:a", "seek"]);
    expect(seeking.engine.getPlaybackState()).toBe("paused");
    expect(seeking.engine.getPosition()).toEqual({ positionMs: BEAT_MS, beat: 1 });

    const shorter = projectWithEvents(2, []);
    const swapping = await run((engine) => engine.setProject(shorter));
    expect(swapping.log).toEqual(["play", "pause", "cue:a", "ended"]);
    expect(swapping.engine.getPlaybackState()).toBe("ended");
  });

  it("leaves a past-end pause to a pause listener that replays from the start", async () => {
    vi.useFakeTimers();
    const transport = new PausingTransport();
    const engine = new TimelineEngine(
      projectWithEvents(2, [
        { id: "zero", beat: 0, type: "cue" },
        { id: "final", beat: 1.95, type: "cue" },
      ]),
      { transport, lookaheadMs: 10 },
    );
    const log: string[] = [];
    engine.on("playback", (event) => {
      log.push(`${event.type}:${event.previousState}`);
      if (event.type === "pause") void engine.play();
    });
    engine.on("cue", (event) => log.push(`cue:${event.event.id}`));

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.2 };
    await engine.pause();
    await vi.advanceTimersByTimeAsync(0);

    expect(log).toEqual(["play:stopped", "cue:zero", "pause:playing", "play:ended", "cue:zero"]);
    expect(engine.getPlaybackState()).toBe("playing");
  });

  it("does not announce local end when a later cue listener seeks after a pausing one in the local-end tick", async () => {
    vi.useFakeTimers();
    const transport = new PausingTransport();
    const engine = new TimelineEngine(
      projectWithEvents(2, [
        { id: "a", beat: 1.5, type: "cue" },
        { id: "b", beat: 1.8, type: "cue" },
      ]),
      { transport, lookaheadMs: 10 },
    );
    const log: string[] = [];
    engine.on("playback", (event) => log.push(event.type));
    engine.on("cue", (event) => {
      log.push(`cue:${event.event.id}`);
      if (event.event.id === "a") void engine.pause();
      if (event.event.id === "b") void engine.seekPositionMs(BEAT_MS * 0.5);
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.2 };
    await vi.advanceTimersByTimeAsync(10);

    expect(log).toEqual(["play", "cue:a", "pause", "cue:b", "seek"]);
    expect(engine.getPlaybackState()).toBe("paused");
    expect(engine.getPosition()).toEqual({ positionMs: BEAT_MS * 0.5, beat: 0.5 });
  });

  it("announces local end once when a pause listener hot-swaps to a shorter project on a past-end pause", async () => {
    vi.useFakeTimers();
    const shorter = projectWithEvents(2, []);
    const lateProject = projectWithEvents(4, [{ id: "late", beat: 3.5, type: "cue" }]);
    const record = (engine: TimelineEngine): string[] => {
      const log: string[] = [];
      engine.on("playback", (event) => {
        log.push(`${event.type}:${event.previousState}`);
        if (event.type === "pause") engine.setProject(shorter);
      });
      engine.on("cue", (event) => log.push(`cue:${event.event.id}`));
      return log;
    };

    const { clock, transport } = buildTransport();
    const engine = new TimelineEngine(lateProject, { transport, lookaheadMs: 10 });
    const log = record(engine);
    await engine.play();
    await tickEngine(clock, BEAT_MS * 3);
    clock.advance(BEAT_MS * 1.5);
    await engine.pause();
    await vi.advanceTimersByTimeAsync(50);

    expect(log).toEqual(["play:stopped", "pause:playing", "ended:playing"]);
    expect(engine.getPlaybackState()).toBe("ended");

    // The same pause, taken by a cue listener inside the local-end tick.
    const pausing = new PausingTransport();
    const inTick = new TimelineEngine(lateProject, { transport: pausing, lookaheadMs: 10 });
    const inTickLog = record(inTick);
    inTick.on("cue", () => void inTick.pause());
    await inTick.play();
    pausing.snapshot = { ...pausing.snapshot, positionMs: BEAT_MS * 4.5 };
    await vi.advanceTimersByTimeAsync(10);

    expect(inTickLog).toEqual(["play:stopped", "cue:late", "pause:playing", "ended:playing"]);
    expect(inTick.getPlaybackState()).toBe("ended");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not announce local end after a cue listener disposes the Engine during a past-end pause", async () => {
    vi.useFakeTimers();
    class DisposableTransport extends PausingTransport {
      private transportDisposed = false;
      override getSnapshot(): PlaybackSnapshot {
        if (this.transportDisposed) throw new Error("transport disposed");
        return super.getSnapshot();
      }
      override dispose(): void {
        this.transportDisposed = true;
      }
    }
    const transport = new DisposableTransport();
    const engine = new TimelineEngine(projectWithEvents(4, [{ id: "x", beat: 3.2, type: "cue" }]), {
      transport,
      lookaheadMs: 10,
    });
    const log: string[] = [];
    engine.on("playback", (event) => log.push(event.type));
    engine.on("cue", (event) => {
      log.push(`cue:${event.event.id}`);
      engine.dispose();
      transport.dispose();
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 3 };
    await vi.advanceTimersByTimeAsync(10);
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 4.5 };
    await expect(engine.pause()).resolves.toBeUndefined();

    expect(log).toEqual(["play", "pause", "cue:x"]);
  });

  it("finishes a normal tick batch before local end when a cue listener's pause lands past local end", async () => {
    vi.useFakeTimers();
    // A transport that reads a live clock: the position advances between the
    // tick's read and the pause snapshot.
    class LatePausingTransport extends ManualTransport {
      override async pause(): Promise<void> {
        this.emitEvent({
          type: "pause",
          snapshot: { ...this.snapshot, state: "paused", positionMs: this.snapshot.positionMs + BEAT_MS * 1.5 },
        });
      }
    }
    const transport = new LatePausingTransport();
    const engine = new TimelineEngine(
      projectWithEvents(4, [
        { id: "p", beat: 1.5, type: "cue" },
        { id: "q", beat: 2.5, type: "cue" },
        { id: "r", beat: 3.8, type: "cue" },
      ]),
      { transport, lookaheadMs: 10 },
    );
    const log: string[] = [];
    engine.on("playback", (event) => log.push(event.type));
    engine.on("cue", (event) => {
      log.push(`cue:${event.event.id}@${event.transportPositionMs}`);
      if (event.event.id === "p") void engine.pause();
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 3 };
    await vi.advanceTimersByTimeAsync(10);

    expect(log).toEqual(["play", "cue:p@3000", "pause", "cue:q@3000", "cue:r@4000", "ended"]);
    expect(engine.getPlaybackState()).toBe("ended");
    expect(vi.getTimerCount()).toBe(0);
  });

  // A synchronous transport that reads a live clock: the pause snapshot lands
  // pauseOffsetMs past the position the tick read.
  class LiveClockTransport extends ManualTransport {
    pauseOffsetMs = 0;
    override async pause(): Promise<void> {
      this.emitEvent({
        type: "pause",
        snapshot: { ...this.snapshot, state: "paused", positionMs: this.snapshot.positionMs + this.pauseOffsetMs },
      });
    }
    override async stop(): Promise<void> {
      this.emitEvent({ type: "stop", snapshot: { ...this.snapshot, state: "stopped", positionMs: 0 } });
    }
  }

  it("dispatches up to local end from where a cue listener re-anchored before its pause lands past local end", async () => {
    vi.useFakeTimers();
    const transport = new LiveClockTransport();
    transport.pauseOffsetMs = BEAT_MS * 1.5;
    const engine = new TimelineEngine(
      projectWithEvents(4, [
        { id: "p", beat: 1.5, type: "cue" },
        { id: "q", beat: 2.5, type: "cue" },
        { id: "r", beat: 3.8, type: "cue" },
      ]),
      { transport, lookaheadMs: 10 },
    );
    const log: string[] = [];
    engine.on("playback", (event) => log.push(event.type));
    engine.on("cue", (event) => {
      log.push(`cue:${event.event.id}@${event.transportPositionMs}`);
      if (event.event.id === "p") {
        void engine.seekPositionMs(BEAT_MS * 3);
        void engine.pause();
      }
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2 };
    await vi.advanceTimersByTimeAsync(10);

    expect(log).toEqual(["play", "cue:p@2000", "seek", "pause", "cue:r@4000", "ended"]);
    expect(engine.getPlaybackState()).toBe("ended");

    // The same, re-anchored by stop() + play() (a nested batch) instead.
    const replaying = new LiveClockTransport();
    const replayEngine = new TimelineEngine(
      projectWithEvents(2, [
        { id: "z", beat: 0, type: "cue" },
        { id: "a", beat: 1.5, type: "cue" },
        { id: "b", beat: 1.8, type: "cue" },
      ]),
      { transport: replaying, lookaheadMs: 10 },
    );
    const replayLog: string[] = [];
    let replayed = false;
    replayEngine.on("playback", (event) => replayLog.push(event.type));
    replayEngine.on("cue", (event) => {
      replayLog.push(`cue:${event.event.id}@${event.transportPositionMs}`);
      if (event.event.id === "a" && !replayed) {
        replayed = true;
        void replayEngine.stop();
        void replayEngine.play();
        replaying.pauseOffsetMs = BEAT_MS * 2.5;
        void replayEngine.pause();
      }
    });

    await replayEngine.play();
    replaying.snapshot = { ...replaying.snapshot, positionMs: BEAT_MS * 1.6 };
    await vi.advanceTimersByTimeAsync(10);

    expect(replayLog).toEqual([
      "play",
      "cue:z@0",
      "cue:a@1600",
      "stop",
      "play",
      "cue:z@0",
      "pause",
      "cue:a@2000",
      "cue:b@2000",
      "ended",
    ]);
    expect(replayEngine.getPlaybackState()).toBe("ended");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("announces local end once when a replay inside a paused batch is itself paused past local end", async () => {
    vi.useFakeTimers();
    const transport = new LiveClockTransport();
    const engine = new TimelineEngine(
      projectWithEvents(2, [
        { id: "z", beat: 0, type: "cue" },
        { id: "a", beat: 1.5, type: "cue" },
        { id: "b", beat: 1.8, type: "cue" },
      ]),
      { transport, lookaheadMs: 10 },
    );
    const log: string[] = [];
    const seen = new Map<string, number>();
    engine.on("playback", (event) => log.push(event.type));
    engine.on("cue", (event) => {
      const id = event.event.id;
      log.push(`cue:${id}@${event.transportPositionMs}`);
      const count = (seen.get(id) ?? 0) + 1;
      seen.set(id, count);
      if (id === "a" && count === 1) void engine.pause();
      if (id === "b" && count === 1) {
        void engine.stop();
        void engine.play();
      }
      if (id === "z" && count === 2) {
        transport.pauseOffsetMs = BEAT_MS * 2.5;
        void engine.pause();
      }
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 2.5 };
    await vi.advanceTimersByTimeAsync(10);

    expect(log).toEqual([
      "play",
      "cue:z@0",
      "cue:a@2000",
      "pause",
      "cue:b@2000",
      "stop",
      "play",
      "cue:z@0",
      "pause",
      "cue:a@2000",
      "cue:b@2000",
      "ended",
    ]);
    expect(engine.getPlaybackState()).toBe("ended");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finishes an ended replay's batch before local end when a cue listener's pause lands past local end", async () => {
    vi.useFakeTimers();
    const transport = new LiveClockTransport();
    transport.pauseOffsetMs = BEAT_MS * 1.5;
    const engine = new TimelineEngine(
      projectWithEvents(1, [
        { id: "a0", beat: 0, type: "cue" },
        { id: "b0", beat: 0, type: "cue" },
        { id: "m", beat: 0.5, type: "cue" },
      ]),
      { transport, lookaheadMs: 10 },
    );
    const log: string[] = [];
    let pauseOnReplay = false;
    engine.on("playback", (event) => log.push(event.type));
    engine.on("cue", (event) => {
      log.push(`cue:${event.event.id}@${event.transportPositionMs}`);
      if (event.event.id === "a0" && pauseOnReplay) void engine.pause();
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 1.2 };
    await vi.advanceTimersByTimeAsync(10);
    expect(engine.getPlaybackState()).toBe("ended");
    expect(transport.getPlaybackState()).toBe("playing");

    // Replay while the shared transport keeps playing: the seek acts as play.
    log.length = 0;
    pauseOnReplay = true;
    await engine.play();
    await vi.advanceTimersByTimeAsync(10);

    expect(log).toEqual(["play", "cue:a0@0", "pause", "cue:b0@0", "cue:m@1000", "ended"]);
    expect(engine.getPlaybackState()).toBe("ended");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("announces local end once when a replay during a local-end pause's dispatch is itself paused past local end", async () => {
    vi.useFakeTimers();
    // From a pause outside any batch, and from a cue listener's pause inside a tick batch.
    for (const pauseInBatch of [false, true]) {
      const transport = new LiveClockTransport();
      const engine = new TimelineEngine(
        projectWithEvents(2, [
          { id: "z", beat: 0, type: "cue" },
          { id: "m", beat: 0.5, type: "cue" },
          { id: "a", beat: 1.5, type: "cue" },
          { id: "b", beat: 1.8, type: "cue" },
        ]),
        { transport, lookaheadMs: 10 },
      );
      const log: string[] = [];
      const seen = new Map<string, number>();
      engine.on("playback", (event) => log.push(event.type));
      engine.on("cue", (event) => {
        const id = event.event.id;
        log.push(`cue:${id}@${event.transportPositionMs}`);
        const count = (seen.get(id) ?? 0) + 1;
        seen.set(id, count);
        if (id === "m" && pauseInBatch) {
          transport.pauseOffsetMs = BEAT_MS * 2.5;
          void engine.pause();
        }
        if (id === "a" && count === 1) {
          void engine.stop();
          void engine.play();
        }
        if (id === "z" && count === 2) {
          transport.pauseOffsetMs = BEAT_MS * 2.5;
          void engine.pause();
        }
      });

      await engine.play();
      transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS };
      await vi.advanceTimersByTimeAsync(10);
      if (!pauseInBatch) {
        transport.pauseOffsetMs = BEAT_MS * 1.5;
        await engine.pause();
      }

      const replay = ["stop", "play", "cue:z@0", "pause", "cue:m@2000", "cue:a@2000", "cue:b@2000", "ended"];
      if (pauseInBatch) replay.splice(5, 0, "pause");
      expect(log).toEqual(["play", "cue:z@0", "cue:m@1000", "pause", "cue:a@2000", ...replay]);
      expect(engine.getPlaybackState()).toBe("ended");
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("announces local end once when a pause listener's replay is itself paused past local end", async () => {
    vi.useFakeTimers();
    const transport = new LiveClockTransport();
    const engine = new TimelineEngine(
      projectWithEvents(2, [
        { id: "z", beat: 0, type: "cue" },
        { id: "a", beat: 1.5, type: "cue" },
        { id: "b", beat: 1.8, type: "cue" },
      ]),
      { transport, lookaheadMs: 10 },
    );
    const log: string[] = [];
    const seen = new Map<string, number>();
    let pauses = 0;
    engine.on("playback", (event) => {
      log.push(event.type);
      if (event.type === "pause" && ++pauses === 1) {
        void engine.stop();
        void engine.play();
      }
    });
    engine.on("cue", (event) => {
      const id = event.event.id;
      log.push(`cue:${id}@${event.transportPositionMs}`);
      const count = (seen.get(id) ?? 0) + 1;
      seen.set(id, count);
      if (id === "a" && count === 1) {
        transport.pauseOffsetMs = BEAT_MS * 1.5;
        void engine.pause();
      }
      if (id === "z" && count === 2) {
        transport.pauseOffsetMs = BEAT_MS * 2.5;
        void engine.pause();
      }
    });

    await engine.play();
    transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 1.6 };
    await vi.advanceTimersByTimeAsync(10);

    expect(log).toEqual([
      "play",
      "cue:z@0",
      "cue:a@1600",
      "pause",
      "stop",
      "play",
      "cue:z@0",
      "pause",
      "cue:a@2000",
      "cue:b@2000",
      "ended",
    ]);
    expect(engine.getPlaybackState()).toBe("ended");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not announce a pause's local end after a pause listener moved the Engine out of ended and back", async () => {
    vi.useFakeTimers();
    const shorter = projectWithEvents(2, []);
    const run = async (
      takeOver: (engine: TimelineEngine) => void,
      pauseInTick: boolean,
    ): Promise<{ log: string[]; state: string }> => {
      const transport = new LiveClockTransport();
      const engine = new TimelineEngine(projectWithEvents(4, [{ id: "a", beat: 3.2, type: "cue" }]), {
        transport,
        lookaheadMs: 10,
      });
      const log: string[] = [];
      let pauses = 0;
      engine.on("playback", (event) => {
        log.push(event.type);
        if (event.type === "pause" && ++pauses === 1) takeOver(engine);
      });
      engine.on("cue", (event) => {
        log.push(`cue:${event.event.id}`);
        if (pauseInTick) void engine.pause();
      });
      await engine.play();
      if (pauseInTick) {
        transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 4.5 };
        await vi.advanceTimersByTimeAsync(10);
      } else {
        transport.snapshot = { ...transport.snapshot, positionMs: BEAT_MS * 3 };
        await vi.advanceTimersByTimeAsync(10);
        transport.pauseOffsetMs = BEAT_MS * 1.5;
        await engine.pause();
      }
      return { log, state: engine.getPlaybackState() };
    };
    const seekThenShorten = (engine: TimelineEngine): void => {
      void engine.seekPositionMs(BEAT_MS * 3);
      engine.setProject(shorter);
    };

    // The shorter hot-swap announces its own ended; the pause's was superseded by the seek.
    expect(await run(seekThenShorten, false)).toEqual({
      log: ["play", "pause", "seek", "ended"],
      state: "ended",
    });
    expect(await run(seekThenShorten, true)).toEqual({
      log: ["play", "cue:a", "pause", "seek", "ended"],
      state: "ended",
    });
    // Enabling loop takes over, and disabling it again from paused is silent.
    expect(
      await run((engine) => {
        engine.setLoop(true);
        engine.setLoop(false);
      }, false),
    ).toEqual({ log: ["play", "pause", "loopchange", "loopchange"], state: "ended" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
