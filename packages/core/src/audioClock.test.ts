import { describe, expect, it, vi } from "vitest";
import type { PlaybackTransportEvent } from "./playbackTransport";
import {
  createAudioBufferTransport,
  createMediaElementTransport,
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

    await transport.seekMs(500);
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
    await transport.seekMs(1250);

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
    expect(() => transport.seekMs(-1)).toThrow(RangeError);
    expect(() => transport.seekMs(3000)).toThrow(RangeError);
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
