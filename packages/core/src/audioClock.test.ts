import { describe, expect, it, vi } from "vitest";
import type { PlaybackTransportEvent } from "./playbackTransport";
import {
  createAudioBufferTransport,
  createMediaElementTransport,
  type AudioBufferTransportOptions,
} from "./audioClock";

type Listener = EventListener;

class FakeMedia {
  currentTime = 0;
  duration = 2;
  paused = true;
  ended = false;
  playbackRate = 1;
  loop = false;
  error: MediaError | null = null;
  play = vi.fn(async () => {
    this.paused = false;
    this.dispatch("play");
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatch("pause");
  });
  private listeners = new Map<string, Listener[]>();

  addEventListener(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  removeEventListener(event: string, listener: Listener): void {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
    );
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  dispatch(event: string): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(new Event(event));
    }
  }
}

class FakeAudioContext {
  currentTime = 0;
  baseLatency: number | undefined = undefined;
  outputLatency: number | undefined = undefined;
  resume = vi.fn(async () => {});
  destination = {} as AudioDestinationNode;
  sources: FakeAudioBufferSource[] = [];
  failNextStart = false;

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeAudioBufferSource(this.failNextStart);
    this.failNextStart = false;
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
}

class FakeAudioBufferSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn(() => {
    if (this.failStart) {
      throw new Error("start failed");
    }
  });
  stop = vi.fn(() => this.onended?.());

  constructor(private readonly failStart = false) {}
}

class FakeAudioBuffer {
  duration = 2;
}

const eventTypes = (events: PlaybackTransportEvent[]): string[] =>
  events.map((event) => event.type);

describe("createMediaElementTransport", () => {
  it("initializes from paused nonzero, ended, and playing media state", () => {
    const paused = new FakeMedia();
    paused.currentTime = 0.25;
    const ended = new FakeMedia();
    ended.ended = true;
    ended.currentTime = 2;
    const playing = new FakeMedia();
    playing.paused = false;

    expect(createMediaElementTransport(paused as unknown as HTMLMediaElement).getPlaybackState()).toBe("paused");
    expect(createMediaElementTransport(ended as unknown as HTMLMediaElement).getPlaybackState()).toBe("ended");
    expect(createMediaElementTransport(playing as unknown as HTMLMediaElement).getPlaybackState()).toBe("playing");
  });

  it("PB-TR-002/PB-TR-020A emits one play event before resolution", async () => {
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const order: string[] = [];
    transport.subscribe((event) => order.push(event.type));

    await transport.play().then(() => order.push("resolved"));

    expect(order).toEqual(["play", "resolved"]);
    expect(transport.getPlaybackState()).toBe("playing");
  });

  it("PB-TR-020A stop suppresses pause and delayed seeked", async () => {
    const media = new FakeMedia();
    media.currentTime = 1;
    media.paused = false;
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.stop();
    media.dispatch("seeked");

    expect(eventTypes(events)).toEqual(["stop"]);
    expect(transport.getSnapshot()).toMatchObject({ state: "stopped", positionMs: 0 });
  });

  it("PB-TR-008/PB-TR-020A seek emits once even for the same position", async () => {
    const media = new FakeMedia();
    media.currentTime = 0.5;
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.seekPositionMs(500);
    media.dispatch("seeked");

    expect(eventTypes(events)).toEqual(["seek"]);
    expect(events[0]).toMatchObject({ previousPositionMs: 500 });
  });

  it("PB-TR-011/PB-TR-020A rate command suppresses its DOM ratechange", async () => {
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.setPlaybackRate(2);
    media.dispatch("ratechange");

    expect(eventTypes(events)).toEqual(["ratechange"]);
    expect(events[0]).toMatchObject({ previousPlaybackRate: 1 });
  });

  it("PB-TR-020B exposes external media state changes", () => {
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    media.paused = false;
    media.dispatch("play");
    media.paused = true;
    media.dispatch("pause");
    media.dispatch("seeking");
    media.currentTime = 0.75;
    media.dispatch("seeked");
    media.playbackRate = 1.5;
    media.dispatch("ratechange");
    media.loop = true;
    media.dispatch("timeupdate");
    media.currentTime = media.duration;
    media.ended = true;
    media.dispatch("ended");

    expect(eventTypes(events)).toEqual([
      "play",
      "pause",
      "seek",
      "ratechange",
      "loopchange",
      "ended",
    ]);
  });

  it("PB-TR-020A loop command emits only loopchange", async () => {
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.setLoop(true);
    media.dispatch("timeupdate");

    expect(eventTypes(events)).toEqual(["loopchange"]);
  });

  it("PB-TR-017 emits durationchange when duration becomes known", () => {
    const media = new FakeMedia();
    media.duration = Number.NaN;
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    media.duration = 3;
    media.dispatch("durationchange");

    expect(events[0]).toMatchObject({
      type: "durationchange",
      previousDurationMs: null,
      snapshot: { durationMs: 3000 },
    });
  });

  it("PB-TR-018/PB-TR-018A tracks buffering without leaving playing", async () => {
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.play();
    events.length = 0;

    media.dispatch("waiting");
    media.dispatch("playing");

    expect(eventTypes(events)).toEqual(["bufferingchange", "bufferingchange"]);
    expect(events.map((event) => event.snapshot.state)).toEqual(["playing", "playing"]);
    expect(events.map((event) => event.snapshot.buffering)).toEqual([true, false]);
  });

  it("suppresses buffering and unchanged media events that do not change public state", () => {
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    media.dispatch("waiting");
    media.dispatch("playing");
    media.dispatch("durationchange");
    media.dispatch("ratechange");
    media.dispatch("timeupdate");

    expect(events).toEqual([]);
  });

  it("PB-TR-019 rejects platform play failure without an error event", async () => {
    const failure = new Error("play denied");
    const media = new FakeMedia();
    media.play.mockRejectedValueOnce(failure);
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await expect(transport.play()).rejects.toBe(failure);
    expect(events).toEqual([]);
  });

  it("PB-TR-020 exposes unsolicited media errors", () => {
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    media.dispatch("error");

    expect(eventTypes(events)).toEqual(["error"]);
  });

  it("isolates listener failures from media event dispatch", () => {
    const onListenerError = vi.fn();
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement, {
      onListenerError,
    });
    const healthy = vi.fn();
    transport.subscribe(() => {
      throw new Error("listener failed");
    });
    transport.subscribe(healthy);

    media.paused = false;
    media.dispatch("play");

    expect(healthy).toHaveBeenCalledOnce();
    expect(onListenerError).toHaveBeenCalledWith(expect.any(Error), {
      source: "transport",
      eventName: "play",
    });
  });

  it("falls back when media listener error reporting throws", () => {
    const originalReportError = globalThis.reportError;
    const reportError = vi.fn();
    Object.defineProperty(globalThis, "reportError", {
      configurable: true,
      value: reportError,
    });
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement, {
      onListenerError: () => {
        throw new Error("reporting failed");
      },
    });
    transport.subscribe(() => {
      throw new Error("listener failed");
    });

    media.paused = false;
    media.dispatch("play");

    expect(reportError).toHaveBeenCalledWith(expect.any(Error));

    Object.defineProperty(globalThis, "reportError", {
      configurable: true,
      value: originalReportError,
    });
  });

  it("PB-TR-014 rejects loop when media duration is unknown", async () => {
    const media = new FakeMedia();
    media.duration = Number.NaN;
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);

    await expect(transport.setLoop(true)).rejects.toMatchObject({
      code: "DURATION_UNAVAILABLE",
    });
  });

  it("PB-TR-015 emits a loop when media position wraps", async () => {
    const media = new FakeMedia();
    media.loop = true;
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.play();
    events.length = 0;
    media.currentTime = 1.9;
    media.dispatch("timeupdate");
    media.currentTime = 0.1;
    media.dispatch("timeupdate");

    expect(events[0]).toMatchObject({ type: "loop", iteration: 1 });
  });

  it("replays ended media from the beginning", async () => {
    const media = new FakeMedia();
    media.ended = true;
    media.currentTime = 2;
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.play();

    expect(media.currentTime).toBe(0);
    expect(transport.getPlaybackState()).toBe("playing");
    expect(eventTypes(events)).toEqual(["play"]);
  });

  it("PB-TR-028 disposes listeners without changing borrowed media", () => {
    const media = new FakeMedia();
    media.currentTime = 0.5;
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    transport.dispose();

    expect(eventTypes(events)).toEqual(["dispose"]);
    expect(media.listenerCount("play")).toBe(0);
    expect(media.currentTime).toBe(0.5);
    expect(media.pause).not.toHaveBeenCalled();
    expect(() => transport.getSnapshot()).toThrowError(expect.objectContaining({ code: "TRANSPORT_DISPOSED" }));
  });
});

describe("createAudioBufferTransport", () => {
  it("validates buffer duration and loop option", () => {
    expect(() =>
      createAudioBufferTransport(
        new FakeAudioContext() as unknown as AudioContext,
        { duration: Number.NaN } as AudioBuffer,
      ),
    ).toThrow(RangeError);
    expect(() =>
      createAudioBufferTransport(
        new FakeAudioContext() as unknown as AudioContext,
        new FakeAudioBuffer() as unknown as AudioBuffer,
        { loop: "yes" as unknown as boolean },
      ),
    ).toThrow(TypeError);
  });

  it("PB-TR-002 starts a source and emits play before resolution", async () => {
    const context = new FakeAudioContext();
    const buffer = new FakeAudioBuffer();
    const transport = createAudioBufferTransport(
      context as unknown as AudioContext,
      buffer as unknown as AudioBuffer,
    );
    const order: string[] = [];
    transport.subscribe((event) => order.push(event.type));

    await transport.play().then(() => order.push("resolved"));

    expect(order).toEqual(["play", "resolved"]);
    expect(context.sources[0]?.start).toHaveBeenCalledWith(0, 0);
  });

  it("PB-TR-009 restarts a playing one-shot source at seek position", async () => {
    const context = new FakeAudioContext();
    const transport = createAudioBufferTransport(
      context as unknown as AudioContext,
      new FakeAudioBuffer() as unknown as AudioBuffer,
    );
    await transport.play();
    await transport.seekPositionMs(1250);

    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]?.disconnect).toHaveBeenCalledOnce();
    expect(context.sources[1]?.start).toHaveBeenCalledWith(0, 1.25);
  });

  it("PB-TR-003 pauses at the logical position and resumes a fresh source", async () => {
    const context = new FakeAudioContext();
    const transport = createAudioBufferTransport(
      context as unknown as AudioContext,
      new FakeAudioBuffer() as unknown as AudioBuffer,
    );
    await transport.play();
    context.currentTime = 0.75;

    await transport.pause();
    await transport.play();

    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]?.disconnect).toHaveBeenCalledOnce();
    expect(context.sources[1]?.start).toHaveBeenCalledWith(0, 0.75);
  });

  it("PB-TR-011 changes logical and source playback rate", async () => {
    const context = new FakeAudioContext();
    const transport = createAudioBufferTransport(
      context as unknown as AudioContext,
      new FakeAudioBuffer() as unknown as AudioBuffer,
    );
    await transport.play();
    await transport.setPlaybackRate(2);

    expect(transport.getPlaybackRate()).toBe(2);
    expect(context.sources[0]?.playbackRate.value).toBe(2);
  });

  it("suppresses AudioBuffer no-op controls and validates inputs", async () => {
    const context = new FakeAudioContext();
    const transport = createAudioBufferTransport(
      context as unknown as AudioContext,
      new FakeAudioBuffer() as unknown as AudioBuffer,
    );
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));

    await transport.pause();
    await transport.stop();
    await transport.setPlaybackRate(1);
    await transport.setLoop(false);
    expect(() => transport.seekPositionMs(-1)).toThrow(RangeError);
    expect(() => transport.seekPositionMs(3000)).toThrow(RangeError);
    expect(() => transport.setPlaybackRate(0)).toThrow(RangeError);
    expect(() => transport.setLoop("yes" as unknown as boolean)).toThrow(TypeError);

    expect(events).toEqual([]);
    expect(context.sources).toEqual([]);
  });

  it("PB-TR-013 changes logical and source loop", async () => {
    const context = new FakeAudioContext();
    const transport = createAudioBufferTransport(
      context as unknown as AudioContext,
      new FakeAudioBuffer() as unknown as AudioBuffer,
    );
    await transport.play();
    await transport.setLoop(true);

    expect(transport.getLoop()).toBe(true);
    expect(context.sources[0]?.loop).toBe(true);
  });

  it("PB-TR-016 reaches ended at the finite buffer boundary", async () => {
    vi.useFakeTimers();
    const context = new FakeAudioContext();
    const transport = createAudioBufferTransport(
      context as unknown as AudioContext,
      new FakeAudioBuffer() as unknown as AudioBuffer,
    );
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.play();

    context.currentTime = 2;
    await vi.advanceTimersByTimeAsync(2000);

    expect(eventTypes(events)).toEqual(["play", "ended"]);
    expect(transport.getSnapshot()).toMatchObject({ state: "ended", positionMs: 2000 });
    transport.dispose();
    vi.useRealTimers();
  });

  it("cleans up a failed AudioBuffer source start and leaves the queue usable", async () => {
    const context = new FakeAudioContext();
    context.failNextStart = true;
    const transport = createAudioBufferTransport(
      context as unknown as AudioContext,
      new FakeAudioBuffer() as unknown as AudioBuffer,
    );

    await expect(transport.play()).rejects.toThrow("start failed");
    expect(context.sources[0]?.disconnect).toHaveBeenCalledOnce();

    await transport.play();

    expect(context.sources).toHaveLength(2);
    expect(transport.getPlaybackState()).toBe("playing");
  });

  it("PB-TR-028 disposes nodes without closing the borrowed context", async () => {
    const context = new FakeAudioContext();
    const transport = createAudioBufferTransport(
      context as unknown as AudioContext,
      new FakeAudioBuffer() as unknown as AudioBuffer,
    );
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.play();

    transport.dispose();
    transport.dispose();

    expect(eventTypes(events)).toEqual(["play", "dispose"]);
    expect(context.sources[0]?.disconnect).toHaveBeenCalledOnce();
    expect("close" in context).toBe(false);
    expect(() => transport.play()).toThrowError(expect.objectContaining({ code: "TRANSPORT_DISPOSED" }));
  });
});

describe("latencyCompensation", () => {
  const bufferTransport = (
    context: FakeAudioContext,
    latencyCompensation: AudioBufferTransportOptions["latencyCompensation"],
    loop = false,
  ) =>
    createAudioBufferTransport(
      context as unknown as AudioContext,
      new FakeAudioBuffer() as unknown as AudioBuffer,
      { latencyCompensation, loop },
    );

  it("validates the option when the transport is created", () => {
    const context = new FakeAudioContext();
    expect(() => bufferTransport(context, -1)).toThrow(RangeError);
    expect(() => bufferTransport(context, Number.NaN)).toThrow(RangeError);
    expect(() => bufferTransport(context, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() =>
      bufferTransport(context, "auto" as unknown as AudioBufferTransportOptions["latencyCompensation"]),
    ).toThrow(TypeError);
    expect(() =>
      createMediaElementTransport(new FakeMedia() as unknown as HTMLMediaElement, {
        latencyCompensation: "output",
      }),
    ).toThrow(TypeError);
  });

  it("leaves the position unshifted when the option is off", async () => {
    const context = new FakeAudioContext();
    context.baseLatency = 0.005;
    context.outputLatency = 0.015;
    const transport = bufferTransport(context, undefined);
    await transport.play();
    context.currentTime = 0.01;

    expect(transport.getPositionMs()).toBe(10);
  });

  it("holds at the start for the latency, then trails the clock", async () => {
    const context = new FakeAudioContext();
    const transport = bufferTransport(context, 20);
    await transport.play();

    context.currentTime = 0.01;
    expect(transport.getPositionMs()).toBe(0);
    context.currentTime = 0.5;
    expect(transport.getPositionMs()).toBe(480);
    expect(transport.getSnapshot().positionMs).toBe(480);
  });

  it('reads "output" from the context on every query and treats missing values as 0', async () => {
    const context = new FakeAudioContext();
    const transport = bufferTransport(context, "output");
    await transport.play();
    context.currentTime = 0.5;

    expect(transport.getPositionMs()).toBe(500);
    context.baseLatency = 0.005;
    context.outputLatency = 0.015;
    expect(transport.getPositionMs()).toBe(500);
    context.currentTime = 0.6;
    expect(transport.getPositionMs()).toBeCloseTo(580);
  });

  it("holds at a seek target and reports the heard position as previousPositionMs", async () => {
    const context = new FakeAudioContext();
    const transport = bufferTransport(context, 100);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.play();
    context.currentTime = 0.5;

    await transport.seekPositionMs(1000);
    context.currentTime = 0.55;

    expect(events.at(-1)).toMatchObject({ type: "seek", previousPositionMs: 400 });
    expect(transport.getPositionMs()).toBe(1000);
    context.currentTime = 0.65;
    expect(transport.getPositionMs()).toBeCloseTo(1050);
  });

  it("pauses at the undelayed position and resumes the source there", async () => {
    const context = new FakeAudioContext();
    const transport = bufferTransport(context, 100);
    await transport.play();
    context.currentTime = 0.75;
    expect(transport.getPositionMs()).toBe(650);

    await transport.pause();

    expect(transport.getPositionMs()).toBe(750);
    await transport.play();
    expect(context.sources[1]?.start).toHaveBeenCalledWith(0, 0.75);
  });

  it("shows the end of each loop and fires loop when the heard position wraps", async () => {
    vi.useFakeTimers();
    const context = new FakeAudioContext();
    const transport = bufferTransport(context, 100, true);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.play();

    context.currentTime = 2.05;
    await vi.advanceTimersByTimeAsync(2050);
    expect(eventTypes(events)).toEqual(["play"]);
    expect(transport.getPositionMs()).toBeCloseTo(1950);

    context.currentTime = 2.15;
    await vi.advanceTimersByTimeAsync(100);
    expect(eventTypes(events)).toEqual(["play", "loop"]);
    expect(transport.getPositionMs()).toBeCloseTo(50);
    transport.dispose();
    vi.useRealTimers();
  });

  it("fires ended when the heard position reaches the end", async () => {
    vi.useFakeTimers();
    const context = new FakeAudioContext();
    const transport = bufferTransport(context, 100);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.play();

    context.currentTime = 2.05;
    await vi.advanceTimersByTimeAsync(2050);
    expect(eventTypes(events)).toEqual(["play"]);
    expect(transport.getSnapshot()).toMatchObject({ state: "playing" });
    expect(transport.getPositionMs()).toBeCloseTo(1950);

    context.currentTime = 2.1;
    await vi.advanceTimersByTimeAsync(50);
    expect(eventTypes(events)).toEqual(["play", "ended"]);
    expect(transport.getSnapshot()).toMatchObject({ state: "ended", positionMs: 2000 });
    transport.dispose();
    vi.useRealTimers();
  });

  it("does not move backward when a live latency grows, and jumps when it shrinks", async () => {
    const context = new FakeAudioContext();
    let latencyMs = 20;
    const transport = bufferTransport(context, () => latencyMs);
    await transport.play();
    context.currentTime = 0.5;
    expect(transport.getPositionMs()).toBe(480);

    latencyMs = 100;
    expect(transport.getPositionMs()).toBe(480);
    context.currentTime = 0.55;
    expect(transport.getPositionMs()).toBe(480);
    context.currentTime = 0.6;
    expect(transport.getPositionMs()).toBeCloseTo(500);

    latencyMs = 0;
    expect(transport.getPositionMs()).toBeCloseTo(600);
  });

  it("treats a negative or non-finite live latency as 0", async () => {
    const context = new FakeAudioContext();
    let latencyMs = -5;
    const transport = bufferTransport(context, () => latencyMs);
    await transport.play();
    context.currentTime = 0.5;

    expect(transport.getPositionMs()).toBe(500);
    latencyMs = Number.NaN;
    context.currentTime = 0.6;
    expect(transport.getPositionMs()).toBeCloseTo(600);
  });

  it("keeps tracking the heard position when a settle lands in a hold after the latency grew", async () => {
    const context = new FakeAudioContext();
    let latencyMs = 20;
    const transport = bufferTransport(context, () => latencyMs);
    await transport.play();
    context.currentTime = 1;
    expect(transport.getPositionMs()).toBe(980);

    latencyMs = 100;
    context.currentTime = 1.01;
    expect(transport.getPositionMs()).toBe(980);
    await transport.setLoop(true);
    context.currentTime = 1.05;
    expect(transport.getPositionMs()).toBe(980);

    context.currentTime = 2;
    expect(transport.getPositionMs()).toBeCloseTo(1900);
  });

  it("fires loop at the heard boundary when the latency grows just before it", async () => {
    vi.useFakeTimers();
    const context = new FakeAudioContext();
    let latencyMs = 20;
    const transport = bufferTransport(context, () => latencyMs, true);
    const events: PlaybackTransportEvent[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.play();

    context.currentTime = 2.01;
    await vi.advanceTimersByTimeAsync(2010);
    expect(transport.getPositionMs()).toBeCloseTo(1990);

    latencyMs = 100;
    context.currentTime = 2.02;
    await vi.advanceTimersByTimeAsync(10);
    expect(eventTypes(events)).toEqual(["play"]);
    expect(transport.getPositionMs()).toBeCloseTo(1990);

    context.currentTime = 2.1;
    await vi.advanceTimersByTimeAsync(80);
    expect(eventTypes(events)).toEqual(["play", "loop"]);
    context.currentTime = 2.2;
    expect(transport.getPositionMs()).toBeCloseTo(100);
    transport.dispose();
    vi.useRealTimers();
  });

  describe("media element", () => {
    const mediaTransport = (media: FakeMedia, latencyCompensation: number) =>
      createMediaElementTransport(media as unknown as HTMLMediaElement, { latencyCompensation });

    it("holds at the start, trails the element, and pauses at the element position", async () => {
      const media = new FakeMedia();
      const transport = mediaTransport(media, 100);
      await transport.play();

      media.currentTime = 0.05;
      expect(transport.getPositionMs()).toBe(0);
      media.currentTime = 0.5;
      expect(transport.getPositionMs()).toBe(400);

      await transport.pause();
      expect(transport.getPositionMs()).toBe(500);
    });

    it('subtracts the audioContext latency for "output"', async () => {
      const media = new FakeMedia();
      const context = new FakeAudioContext();
      context.baseLatency = 0.005;
      context.outputLatency = 0.015;
      const transport = createMediaElementTransport(media as unknown as HTMLMediaElement, {
        audioContext: context as unknown as AudioContext,
        latencyCompensation: "output",
      });
      await transport.play();
      media.currentTime = 0.5;

      expect(transport.getPositionMs()).toBeCloseTo(480);
    });

    it("reports a loop when the heard position wraps, not the element", async () => {
      const media = new FakeMedia();
      const transport = mediaTransport(media, 100);
      const events: PlaybackTransportEvent[] = [];
      transport.subscribe((event) => events.push(event));
      await transport.setLoop(true);
      await transport.play();

      media.currentTime = 1.95;
      media.dispatch("timeupdate");
      expect(transport.getPositionMs()).toBe(1850);

      media.currentTime = 0.05;
      media.dispatch("timeupdate");
      expect(eventTypes(events)).toEqual(["loopchange", "play"]);
      expect(transport.getPositionMs()).toBe(1950);

      media.currentTime = 0.15;
      media.dispatch("timeupdate");
      expect(eventTypes(events)).toEqual(["loopchange", "play", "loop"]);
      expect(events.at(-1)).toMatchObject({ iteration: 1 });
      expect(transport.getPositionMs()).toBeCloseTo(50);
    });

    it("runs the clock through the end tail before firing ended", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      const media = new FakeMedia();
      const transport = mediaTransport(media, 100);
      const events: PlaybackTransportEvent[] = [];
      transport.subscribe((event) => events.push(event));
      await transport.play();

      media.currentTime = 2;
      media.paused = true;
      media.ended = true;
      media.dispatch("ended");
      expect(eventTypes(events)).toEqual(["play"]);
      expect(transport.getPositionMs()).toBe(1900);

      await vi.advanceTimersByTimeAsync(50);
      expect(transport.getPositionMs()).toBe(1950);

      await vi.advanceTimersByTimeAsync(50);
      expect(eventTypes(events)).toEqual(["play", "ended"]);
      expect(transport.getSnapshot()).toMatchObject({ state: "ended", positionMs: 2000 });
      transport.dispose();
      vi.useRealTimers();
    });

    it("pauses at the target of a seek during the end tail", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      const media = new FakeMedia();
      const transport = mediaTransport(media, 100);
      const events: PlaybackTransportEvent[] = [];
      transport.subscribe((event) => events.push(event));
      await transport.play();
      media.currentTime = 2;
      media.paused = true;
      media.ended = true;
      media.dispatch("ended");
      await vi.advanceTimersByTimeAsync(30);

      await transport.seekPositionMs(500);
      media.ended = false;
      await vi.advanceTimersByTimeAsync(1000);

      expect(transport.getSnapshot()).toMatchObject({ state: "paused", positionMs: 500 });
      expect(eventTypes(events)).toEqual(["play", "seek"]);
      transport.dispose();
      vi.useRealTimers();
    });

    it("keeps following the element when loop is turned off right after a wrap", async () => {
      const media = new FakeMedia();
      const transport = mediaTransport(media, 100);
      await transport.setLoop(true);
      await transport.play();
      media.currentTime = 1.95;
      expect(transport.getPositionMs()).toBe(1850);
      media.currentTime = 0.02;
      expect(transport.getPositionMs()).toBeCloseTo(1920);

      await transport.setLoop(false);
      media.currentTime = 0.5;

      expect(transport.getPositionMs()).toBeCloseTo(400);
    });

    it("counts a wrap read before timeupdate picks up a direct media.loop change", () => {
      const media = new FakeMedia();
      const transport = mediaTransport(media, 100);
      const events: PlaybackTransportEvent[] = [];
      transport.subscribe((event) => events.push(event));
      media.paused = false;
      media.dispatch("play");
      media.loop = true;
      media.currentTime = 1.95;
      expect(transport.getPositionMs()).toBe(1850);
      media.currentTime = 0.02;
      expect(transport.getPositionMs()).toBeCloseTo(1920);

      media.dispatch("timeupdate");
      media.currentTime = 0.5;

      expect(transport.getPositionMs()).toBeCloseTo(400);
      media.dispatch("timeupdate");
      expect(eventTypes(events)).toEqual(["play", "loopchange", "loop"]);
    });
  });
});
