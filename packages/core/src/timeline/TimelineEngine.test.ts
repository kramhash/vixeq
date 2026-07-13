import { afterEach, describe, expect, it, vi } from "vitest";
import { createClockTransport } from "../playbackTransport";
import type { PlaybackClock } from "../types";
import { TimelineEngine } from "./TimelineEngine";
import { addTimelineEvent, createTimelineProject } from "./index";
import type { TimelineCueEvent, TimelineEvent, TimelineProject } from "./types";

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
