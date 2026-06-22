import { describe, expect, it, vi } from "vitest";
import {
  createAudioBufferTransport,
  createAudioClock,
  createAudioContextClock,
  createMediaElementTransport,
} from "./audioClock";

type Listener = EventListener;

class FakeMedia {
  currentTime = 0;
  paused = true;
  playbackRate = 1;
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
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(listener);
  }

  removeEventListener(event: string, listener: Listener): void {
    const list = this.listeners.get(event);
    if (!list) return;
    this.listeners.set(event, list.filter((l) => l !== listener));
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  dispatch(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(new Event(event));
    }
  }
}

class FakeAudioContext {
  currentTime = 0;
  resume = vi.fn(async () => {});
  destination = {};
  sources: FakeAudioBufferSource[] = [];

  createBufferSource(): FakeAudioBufferSource {
    const source = new FakeAudioBufferSource();
    this.sources.push(source);
    return source;
  }
}

class FakeAudioBufferSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn(() => {
    this.onended?.();
  });
}

class FakeAudioBuffer {
  duration = 2;
}

describe("createAudioClock", () => {
  it("now() returns media.currentTime * 1000 when paused (no ctx)", () => {
    const media = new FakeMedia();
    media.currentTime = 2.5;
    const clock = createAudioClock(media as unknown as HTMLMediaElement);
    expect(clock.now()).toBeCloseTo(2500);
    clock.dispose();
  });

  it("now() returns media.currentTime * 1000 when paused (with ctx)", () => {
    const media = new FakeMedia();
    const ctx = new FakeAudioContext();
    media.currentTime = 1.0;
    const clock = createAudioClock(media as unknown as HTMLMediaElement, {
      audioContext: ctx as unknown as AudioContext,
    });
    expect(clock.now()).toBeCloseTo(1000);
    clock.dispose();
  });

  it("now() interpolates from context clock when playing", () => {
    const media = new FakeMedia();
    const ctx = new FakeAudioContext();
    media.currentTime = 1.0; // 1000ms
    media.paused = false;
    ctx.currentTime = 10.0; // anchor ctxMs = 10000

    const clock = createAudioClock(media as unknown as HTMLMediaElement, {
      audioContext: ctx as unknown as AudioContext,
    });

    // Simulate play event to resample anchor
    media.dispatch("play");

    // Advance context clock by 0.5s (500ms) with rate=1
    ctx.currentTime = 10.5;
    // Expected: 1000 + 500 * 1 = 1500ms
    expect(clock.now()).toBeCloseTo(1500);

    clock.dispose();
  });

  it("re-anchors on seeked event", () => {
    const media = new FakeMedia();
    const ctx = new FakeAudioContext();
    media.currentTime = 1.0;
    media.paused = false;
    ctx.currentTime = 10.0;

    const clock = createAudioClock(media as unknown as HTMLMediaElement, {
      audioContext: ctx as unknown as AudioContext,
    });
    media.dispatch("play"); // anchor at media=1000, ctx=10000

    // Seek forward
    media.currentTime = 5.0;
    ctx.currentTime = 10.1;
    media.dispatch("seeked"); // re-anchor: media=5000, ctx=10100

    // Advance ctx by 0.5s
    ctx.currentTime = 10.6;
    expect(clock.now()).toBeCloseTo(5500); // 5000 + 500
    clock.dispose();
  });

  it("re-anchors on ratechange", () => {
    const media = new FakeMedia();
    const ctx = new FakeAudioContext();
    media.currentTime = 0.0;
    media.paused = false;
    media.playbackRate = 1;
    ctx.currentTime = 0.0;

    const clock = createAudioClock(media as unknown as HTMLMediaElement, {
      audioContext: ctx as unknown as AudioContext,
    });
    media.dispatch("play"); // anchor at 0

    // Change to 2x speed at t=1s
    media.currentTime = 1.0;
    ctx.currentTime = 1.0;
    media.playbackRate = 2;
    media.dispatch("ratechange"); // re-anchor: media=1000, ctx=1000

    // Advance ctx by 0.5s → media advanced by 0.5*2=1s
    ctx.currentTime = 1.5;
    expect(clock.now()).toBeCloseTo(2000);
    clock.dispose();
  });

  it("dispose() removes all event listeners", () => {
    const media = new FakeMedia();
    const clock = createAudioClock(media as unknown as HTMLMediaElement);
    const before = ["play", "pause", "seeked", "ratechange", "timeupdate"].map((e) =>
      media.listenerCount(e),
    );

    clock.dispose();

    const after = ["play", "pause", "seeked", "ratechange", "timeupdate"].map((e) =>
      media.listenerCount(e),
    );
    expect(after.every((n) => n === 0)).toBe(true);
    expect(before.every((n) => n > 0)).toBe(true);
  });

  it("setTimer and clearTimer delegate to setTimeout", () => {
    vi.useFakeTimers();
    const media = new FakeMedia();
    const clock = createAudioClock(media as unknown as HTMLMediaElement);
    const fn = vi.fn();

    const id = clock.setTimer(fn, 100);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();

    clock.clearTimer(id);
    clock.dispose();
    vi.useRealTimers();
  });
});

describe("createAudioContextClock", () => {
  it("now() returns 0 before start()", () => {
    const ctx = new FakeAudioContext();
    const clock = createAudioContextClock(ctx as unknown as AudioContext);
    ctx.currentTime = 5;
    expect(clock.now()).toBe(0);
  });

  it("now() advances in ms after start()", () => {
    const ctx = new FakeAudioContext();
    const clock = createAudioContextClock(ctx as unknown as AudioContext);
    ctx.currentTime = 10.0;
    clock.start();
    ctx.currentTime = 10.5; // +0.5s
    expect(clock.now()).toBeCloseTo(500);
  });

  it("now() returns 0 after stop()", () => {
    const ctx = new FakeAudioContext();
    const clock = createAudioContextClock(ctx as unknown as AudioContext);
    ctx.currentTime = 0;
    clock.start();
    ctx.currentTime = 1.0;
    clock.stop();
    expect(clock.now()).toBe(0);
  });

  it("re-anchors on second start() — now() resets to ~0", () => {
    const ctx = new FakeAudioContext();
    const clock = createAudioContextClock(ctx as unknown as AudioContext);
    ctx.currentTime = 0;
    clock.start();
    ctx.currentTime = 3.0; // played 3s
    clock.stop();

    // Restart: ctx.currentTime advanced to 5s but start() re-anchors
    ctx.currentTime = 5.0;
    clock.start();
    expect(clock.now()).toBeCloseTo(0);

    ctx.currentTime = 5.25; // +0.25s since restart
    expect(clock.now()).toBeCloseTo(250);
  });

  it("setTimer and clearTimer delegate to setTimeout", () => {
    vi.useFakeTimers();
    const ctx = new FakeAudioContext();
    const clock = createAudioContextClock(ctx as unknown as AudioContext);
    const fn = vi.fn();

    const id = clock.setTimer(fn, 100);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();

    clock.clearTimer(id);
    vi.useRealTimers();
  });
});

describe("createMediaElementTransport", () => {
  it("plays media and resumes an optional AudioContext", async () => {
    const media = new FakeMedia();
    const ctx = new FakeAudioContext();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement, {
      audioContext: ctx as unknown as AudioContext,
    });

    await transport.play();

    expect(ctx.resume).toHaveBeenCalledOnce();
    expect(media.play).toHaveBeenCalledOnce();
    expect(media.paused).toBe(false);
    transport.dispose?.();
  });

  it("stops media and seeks to the configured stop position", () => {
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement, {
      stopAtMs: 500,
    });
    media.currentTime = 2;

    transport.stop();

    expect(media.pause).toHaveBeenCalledOnce();
    expect(media.currentTime).toBe(0.5);
    transport.dispose?.();
  });

  it("seeks using milliseconds", () => {
    const media = new FakeMedia();
    const transport = createMediaElementTransport(media as unknown as HTMLMediaElement);

    transport.seek?.(1250);

    expect(media.currentTime).toBe(1.25);
    transport.dispose?.();
  });
});

describe("createAudioBufferTransport", () => {
  it("creates a fresh source and starts it from the current offset", async () => {
    const ctx = new FakeAudioContext();
    const buffer = new FakeAudioBuffer();
    const transport = createAudioBufferTransport(
      ctx as unknown as AudioContext,
      buffer as unknown as AudioBuffer,
      { loop: true },
    );

    await transport.play();

    expect(ctx.resume).toHaveBeenCalledOnce();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.loop).toBe(true);
    expect(ctx.sources[0]!.connect).toHaveBeenCalledWith(ctx.destination);
    expect(ctx.sources[0]!.start).toHaveBeenCalledWith(0, 0);
  });

  it("clock advances from AudioContext currentTime while playing", async () => {
    const ctx = new FakeAudioContext();
    const buffer = new FakeAudioBuffer();
    const transport = createAudioBufferTransport(
      ctx as unknown as AudioContext,
      buffer as unknown as AudioBuffer,
    );

    ctx.currentTime = 10;
    await transport.play();
    ctx.currentTime = 10.5;

    expect(transport.clock.now()).toBeCloseTo(500);
  });

  it("pauses at the current clock offset and resumes from that offset", async () => {
    const ctx = new FakeAudioContext();
    const buffer = new FakeAudioBuffer();
    const transport = createAudioBufferTransport(
      ctx as unknown as AudioContext,
      buffer as unknown as AudioBuffer,
    );

    await transport.play();
    ctx.currentTime = 0.75;
    await transport.pause?.();
    await transport.play();

    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[1]!.start).toHaveBeenCalledWith(0, 0.75);
  });

  it("seeks while playing by replacing the one-shot source", async () => {
    const ctx = new FakeAudioContext();
    const buffer = new FakeAudioBuffer();
    const transport = createAudioBufferTransport(
      ctx as unknown as AudioContext,
      buffer as unknown as AudioBuffer,
    );

    await transport.play();
    await transport.seek?.(1250);

    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0]!.disconnect).toHaveBeenCalledOnce();
    expect(ctx.sources[1]!.start).toHaveBeenCalledWith(0, 1.25);
  });

  it("wraps loop offsets to the buffer duration", async () => {
    const ctx = new FakeAudioContext();
    const buffer = new FakeAudioBuffer();
    const transport = createAudioBufferTransport(
      ctx as unknown as AudioContext,
      buffer as unknown as AudioBuffer,
      { loop: true },
    );

    await transport.seek?.(2500);
    await transport.play();

    expect(ctx.sources[0]!.start).toHaveBeenCalledWith(0, 0.5);
  });

  it("stop disconnects the source and resets clock to stopAtMs", async () => {
    const ctx = new FakeAudioContext();
    const buffer = new FakeAudioBuffer();
    const transport = createAudioBufferTransport(
      ctx as unknown as AudioContext,
      buffer as unknown as AudioBuffer,
      { stopAtMs: 400 },
    );

    await transport.play();
    await transport.stop();

    expect(ctx.sources[0]!.disconnect).toHaveBeenCalledOnce();
    expect(transport.clock.now()).toBe(400);
  });
});
