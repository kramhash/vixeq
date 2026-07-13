import { describe, expect, it, vi } from "vitest";
import {
  createClockTransport,
  type PlaybackTransportEvent,
} from "./playbackTransport";
import type { PlaybackClock } from "./types";

class FakeClock implements PlaybackClock {
  currentTime = 0;
  ignoreClears = false;
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
    if (this.ignoreClears) return;
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

  runNextTimer(): void {
    this.timers.sort((left, right) => left.dueAt - right.dueAt);
    this.timers.shift()?.callback();
  }
}

const eventTypes = (events: PlaybackTransportEvent[]): string[] =>
  events.map((event) => event.type);

describe("createClockTransport", () => {
  it("PB-TR-001 PB-TR-001A creates a stopped unbounded transport", () => {
    const transport = createClockTransport(new FakeClock());

    expect(transport.getSnapshot()).toEqual({
      state: "stopped",
      positionMs: 0,
      durationMs: null,
      playbackRate: 1,
      loop: false,
      buffering: false,
    });
  });

  it("PB-TR-002 emits play before resolving and advances position", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const order: string[] = [];
    transport.subscribe((event) => order.push(event.type));

    await transport.play().then(() => order.push("resolved"));
    clock.advance(25);

    expect(order).toEqual(["play", "resolved"]);
    expect(transport.getPositionMs()).toBe(25);
  });

  it("PB-TR-003 PB-TR-004 pauses and resumes from the frozen position", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.play();
    clock.advance(40);
    await transport.pause();
    clock.advance(50);
    expect(transport.getPositionMs()).toBe(40);

    await transport.play();
    clock.advance(10);
    expect(transport.getPositionMs()).toBe(50);
    expect(eventTypes(events)).toEqual(["play", "pause", "play"]);
  });

  it("PB-TR-005 PB-TR-007 PB-TR-007A stops at zero and suppresses no-op events", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.pause();
    await transport.stop();
    await transport.play();
    await transport.play();
    clock.advance(20);
    await transport.stop();
    await transport.stop();

    expect(transport.getSnapshot()).toMatchObject({ state: "stopped", positionMs: 0 });
    expect(eventTypes(events)).toEqual(["play", "stop"]);
  });

  it("PB-TR-008 PB-TR-009 emits explicit same-position seeks with the previous position", async () => {
    const transport = createClockTransport(new FakeClock());
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.seekMs(0);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "seek",
      previousPositionMs: 0,
      snapshot: { state: "stopped", positionMs: 0 },
    });
  });

  it("PB-TR-009A preserves playing and paused state across seeks", async () => {
    const transport = createClockTransport(new FakeClock(), { durationMs: 100 });

    await transport.play();
    await transport.seekMs(40);
    expect(transport.getPlaybackState()).toBe("playing");
    await transport.pause();
    await transport.seekMs(60);
    expect(transport.getPlaybackState()).toBe("paused");
  });

  it("PB-TR-009B transitions stopped seeks above zero to paused", async () => {
    const transport = createClockTransport(new FakeClock(), { durationMs: 100 });

    await transport.seekMs(0);
    expect(transport.getPlaybackState()).toBe("stopped");
    await transport.seekMs(25);
    expect(transport.getPlaybackState()).toBe("paused");
  });

  it("PB-TR-009C preserves ended only when seeking to the end", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: 100 });

    await transport.play();
    clock.advance(100);
    expect(transport.getPlaybackState()).toBe("ended");
    await transport.seekMs(100);
    expect(transport.getPlaybackState()).toBe("ended");
    await transport.seekMs(50);
    expect(transport.getPlaybackState()).toBe("paused");
  });

  it("PB-TR-010 rejects invalid seek arguments synchronously", () => {
    const transport = createClockTransport(new FakeClock(), { durationMs: 100 });

    expect(() => transport.seekMs(-1)).toThrow(RangeError);
    expect(() => transport.seekMs(Number.NaN)).toThrow(RangeError);
    expect(() => transport.seekMs(101)).toThrow(RangeError);
  });

  it("PB-TR-011 adjusts finite scheduling when playback rate changes", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: 100 });
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.play();
    clock.advance(25);
    await transport.setPlaybackRate(2);
    expect(transport.getPositionMs()).toBe(25);
    clock.advance(37.5);

    expect(eventTypes(events)).toEqual(["play", "ratechange", "ended"]);
    expect(transport.getSnapshot()).toMatchObject({
      state: "ended",
      positionMs: 100,
      playbackRate: 2,
    });
  });

  it("PB-TR-012 rejects invalid rates and suppresses unchanged rates", async () => {
    const transport = createClockTransport(new FakeClock());
    const listener = vi.fn();
    transport.subscribe(listener);

    expect(() => transport.setPlaybackRate(0)).toThrow(RangeError);
    expect(() => transport.setPlaybackRate(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    await transport.setPlaybackRate(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("PB-TR-013 enables finite looping and emits loopchange", async () => {
    const transport = createClockTransport(new FakeClock(), { durationMs: 100 });
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.setLoop(true);
    await transport.setLoop(true);

    expect(eventTypes(events)).toEqual(["loopchange"]);
    expect(transport.getLoop()).toBe(true);
  });

  it("PB-TR-013A validates loop input synchronously", () => {
    const transport = createClockTransport(new FakeClock(), { durationMs: 100 });
    const setLoop = transport.setLoop as unknown as (loop: unknown) => Promise<void>;

    expect(() => setLoop("yes")).toThrow(TypeError);
  });

  it("PB-TR-014 PB-TR-022 rejects looping without duration and continues the queue", async () => {
    const transport = createClockTransport(new FakeClock());
    const loopPromise = transport.setLoop(true);
    const playPromise = transport.play();

    await expect(loopPromise).rejects.toMatchObject({
      code: "DURATION_UNAVAILABLE",
    });
    await expect(playPromise).resolves.toBeUndefined();
    expect(transport.getPlaybackState()).toBe("playing");
  });

  it("PB-TR-015 emits every natural finite loop with increasing iteration", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: 100, loop: true });
    const iterations: number[] = [];
    transport.subscribe((event) => {
      if (event.type === "loop") iterations.push(event.iteration);
    });

    await transport.play();
    clock.advance(250);

    expect(iterations).toEqual([1, 2]);
    expect(transport.getPositionMs()).toBe(50);
  });

  it("PB-TR-015 catches up multiple loops from one delayed timer", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: 100, loop: true });
    const iterations: number[] = [];
    transport.subscribe((event) => {
      if (event.type === "loop") iterations.push(event.iteration);
    });

    await transport.play();
    clock.jumpWithoutRunningTimers(250);
    clock.runNextTimer();

    expect(iterations).toEqual([1, 2]);
    expect(transport.getPositionMs()).toBe(50);
  });

  it("PB-TR-006 PB-TR-007B PB-TR-016 handles ended replay and stop", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: 100 });
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.play();
    clock.advance(100);
    await transport.pause();
    await transport.play();
    expect(transport.getSnapshot()).toMatchObject({ state: "playing", positionMs: 0 });
    clock.advance(100);
    await transport.stop();

    expect(eventTypes(events)).toEqual(["play", "ended", "play", "ended", "stop"]);
    expect(transport.getSnapshot()).toMatchObject({ state: "stopped", positionMs: 0 });
  });

  it("PB-TR-021 serializes play and pause in invocation order", async () => {
    const transport = createClockTransport(new FakeClock());
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    const playPromise = transport.play();
    const pausePromise = transport.pause();
    await Promise.all([playPromise, pausePromise]);

    expect(eventTypes(events)).toEqual(["play", "pause"]);
    expect(transport.getPlaybackState()).toBe("paused");
  });

  it("PB-TR-023 queues listener-triggered operations after the current operation", async () => {
    const transport = createClockTransport(new FakeClock());
    let pausePromise: Promise<void> | undefined;
    transport.subscribe((event) => {
      if (event.type === "play") pausePromise = transport.pause();
    });

    await transport.play();
    await pausePromise;

    expect(transport.getPlaybackState()).toBe("paused");
  });

  it("PB-TR-024 isolates listener failures", async () => {
    const onListenerError = vi.fn();
    const transport = createClockTransport(new FakeClock(), { onListenerError });
    const healthyListener = vi.fn();
    transport.subscribe(() => {
      throw new Error("listener failed");
    });
    transport.subscribe(healthyListener);

    await expect(transport.play()).resolves.toBeUndefined();

    expect(healthyListener).toHaveBeenCalledOnce();
    expect(onListenerError).toHaveBeenCalledWith(expect.any(Error), {
      source: "transport",
      eventName: "play",
    });
  });

  it("reports listener failures through global reportError when no handler is configured", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const transport = createClockTransport(new FakeClock());
    transport.subscribe(() => {
      throw new Error("listener failed");
    });

    await transport.play();

    expect(reportError).toHaveBeenCalledWith(expect.any(Error));
    vi.unstubAllGlobals();
  });

  it("falls back to reportError when onListenerError itself throws", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const transport = createClockTransport(new FakeClock(), {
      onListenerError: () => {
        throw new Error("reporting failed");
      },
    });
    transport.subscribe(() => {
      throw new Error("listener failed");
    });

    await transport.play();

    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "reporting failed" }));
    vi.unstubAllGlobals();
  });

  it("PB-TR-025 supports multiple independent subscribers", async () => {
    const transport = createClockTransport(new FakeClock());
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = transport.subscribe(first);
    transport.subscribe(second);

    await transport.play();
    offFirst();
    await transport.pause();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("PB-TR-028 PB-TR-029 PB-TR-030 makes disposal observable, idempotent, and terminal", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.play();
    clock.advance(20);

    transport.dispose();
    transport.dispose();

    expect(events.at(-1)).toMatchObject({
      type: "dispose",
      snapshot: { state: "playing", positionMs: 20 },
    });
    expect(() => transport.getSnapshot()).toThrowError(
      expect.objectContaining({ code: "TRANSPORT_DISPOSED" }),
    );
    expect(() => transport.subscribe(() => {})).toThrowError(
      expect.objectContaining({ code: "TRANSPORT_DISPOSED" }),
    );
    expect(() => transport.play()).toThrowError(
      expect.objectContaining({ code: "TRANSPORT_DISPOSED" }),
    );
  });

  it("ignores stale boundary timers after pause and disposal", async () => {
    const clock = new FakeClock();
    clock.ignoreClears = true;
    const transport = createClockTransport(clock, { durationMs: 100 });
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.play();
    await transport.pause();
    clock.runNextTimer();
    await transport.play();
    transport.dispose();
    clock.runNextTimer();

    expect(eventTypes(events)).toEqual(["play", "pause", "play", "dispose"]);
  });

  it("pause is a no-op if settling playback reaches the end first", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: 100 });
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.play();
    clock.jumpWithoutRunningTimers(150);
    await transport.pause();

    expect(transport.getPlaybackState()).toBe("ended");
    expect(eventTypes(events)).toEqual(["play", "ended"]);
  });

  it("rejects an operation queued before disposal", async () => {
    const transport = createClockTransport(new FakeClock());
    const playPromise = transport.play();

    transport.dispose();

    await expect(playPromise).rejects.toMatchObject({ code: "TRANSPORT_DISPOSED" });
  });

  it("PB-TR-014A validates clock transport construction", () => {
    expect(() => createClockTransport(new FakeClock(), { durationMs: 0 })).toThrow(RangeError);
    expect(() => createClockTransport(new FakeClock(), { loop: true })).toThrowError(
      expect.objectContaining({ code: "DURATION_UNAVAILABLE" }),
    );
  });
});
