// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackError } from "@vixeq/core";
import type {
  ChannelProjectEvent,
  ChannelSource,
  EnginePlaybackEvent,
  Envelope,
  PlaybackState,
  StepEvent,
  Unsubscribe,
} from "@vixeq/core";
import { useAnimatedChannels } from "./useAnimatedChannels";

class FakeChannelSource implements ChannelSource {
  positionMs = 0;
  playbackState: PlaybackState = "stopped";
  readonly sampleChannels = vi.fn(() => ({ value: this.positionMs }));
  readonly listeners = {
    step: new Set<(event: StepEvent) => void>(),
    playback: new Set<(event: EnginePlaybackEvent) => void>(),
    project: new Set<(event: ChannelProjectEvent) => void>(),
  };

  sampleChannelsAt(timeMs: number): Record<string, number> {
    return { value: timeMs };
  }

  getPosition(): { positionMs: number; beat: number } {
    return { positionMs: this.positionMs, beat: this.positionMs / 500 };
  }

  getPlaybackState(): PlaybackState {
    return this.playbackState;
  }

  on(eventName: "step", handler: (event: StepEvent) => void): Unsubscribe;
  on(eventName: "playback", handler: (event: EnginePlaybackEvent) => void): Unsubscribe;
  on(eventName: "project", handler: (event: ChannelProjectEvent) => void): Unsubscribe;
  on(
    eventName: "step" | "playback" | "project",
    handler: ((event: StepEvent) => void) | ((event: EnginePlaybackEvent) => void) | ((event: ChannelProjectEvent) => void),
  ): Unsubscribe {
    const listeners = this.listeners[eventName] as Set<typeof handler>;
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  emitStep(event: StepEvent): void {
    for (const listener of [...this.listeners.step]) listener(event);
  }

  emitPlayback(event: EnginePlaybackEvent): void {
    for (const listener of [...this.listeners.playback]) listener(event);
  }

  emitProject(event: ChannelProjectEvent): void {
    for (const listener of [...this.listeners.project]) listener(event);
  }
}

const stepEvent = (scheduledPositionMs: number): StepEvent => ({
  stepIndex: 0,
  bpm: 120,
  scheduledPositionMs,
  transportPositionMs: scheduledPositionMs,
  lateByMs: 0,
  durationMs: 500,
  cause: "tick",
  tracks: [
    { id: "a", name: "A", enabled: true, value: 0.75, nextValue: 0 },
    { id: "b", name: "B", enabled: true, value: 0.5, nextValue: 0 },
  ],
});

const playbackEvent = (type: EnginePlaybackEvent["type"]): EnginePlaybackEvent => ({
  type,
  cause: "command",
  previousState: "playing",
  snapshot: {
    state: type === "stop" ? "stopped" : "playing",
    positionMs: 0,
    beat: 0,
    playbackRate: 1,
    projectLoop: true,
    transportLoop: false,
    buffering: false,
  },
});

const createEnvelope = (sampleValue: number, order?: string[], id = "a"): Envelope => ({
  trigger: vi.fn((positionMs: number) => order?.push(`${id}:trigger:${positionMs}`)),
  sample: vi.fn((positionMs: number) => {
    order?.push(`${id}:sample:${positionMs}`);
    return sampleValue;
  }),
  reset: vi.fn(() => order?.push(`${id}:reset`)),
});

describe("useAnimatedChannels", () => {
  let rafCallback: FrameRequestCallback | undefined;

  beforeEach(() => {
    rafCallback = undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      rafCallback = callback;
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("samples interpolation from engine.sampleChannels without passing rAF time", () => {
    const engine = new FakeChannelSource();
    engine.positionMs = 250;
    const onFrame = vi.fn();

    const { result } = renderHook(() => useAnimatedChannels(engine, { onFrame }));

    act(() => rafCallback?.(999));

    expect(engine.sampleChannels).toHaveBeenCalledWith(undefined);
    expect(result.current.current).toEqual({ value: 250 });
    expect(onFrame).toHaveBeenCalledWith({ value: 250 });
  });

  it("triggers envelopes with scheduled positions and samples with logical engine position", () => {
    const engine = new FakeChannelSource();
    const envelope = createEnvelope(0.4);
    const onFrame = vi.fn();

    renderHook(() => useAnimatedChannels(engine, { envelopes: { a: envelope }, onFrame }));

    act(() => engine.emitStep(stepEvent(500)));
    engine.positionMs = 625;
    act(() => rafCallback?.(999));

    expect(envelope.trigger).toHaveBeenCalledWith(500, 0.75);
    expect(envelope.sample).toHaveBeenCalledWith(625);
    expect(onFrame).toHaveBeenCalledWith({ a: 0.4 });

    act(() => rafCallback?.(1500));
    engine.positionMs = 700;
    act(() => rafCallback?.(2000));

    expect(envelope.sample).toHaveBeenNthCalledWith(2, 625);
    expect(envelope.sample).toHaveBeenNthCalledWith(3, 700);
  });

  it("PB-EV-001 freezes envelope sampling while engine position is frozen and resumes from the next position", () => {
    const engine = new FakeChannelSource();
    const order: string[] = [];
    const envelope = createEnvelope(0.4, order);

    renderHook(() => useAnimatedChannels(engine, { envelopes: { a: envelope } }));

    act(() => engine.emitStep(stepEvent(500)));
    engine.positionMs = 625;
    act(() => rafCallback?.(1000));
    act(() => rafCallback?.(1100));
    engine.positionMs = 700;
    act(() => rafCallback?.(1200));

    expect(order).toEqual([
      "a:trigger:500",
      "a:sample:625",
      "a:sample:625",
      "a:sample:700",
    ]);
  });

  it("resets envelopes on seek before the destination step retriggers and on stop", () => {
    const engine = new FakeChannelSource();
    const order: string[] = [];
    const envelope = createEnvelope(1, order);

    renderHook(() => useAnimatedChannels(engine, { envelopes: { a: envelope } }));

    act(() => {
      engine.emitPlayback(playbackEvent("seek"));
      engine.emitStep(stepEvent(1000));
      engine.emitPlayback(playbackEvent("stop"));
    });

    expect(order).toEqual(["a:reset", "a:trigger:1000", "a:reset"]);
  });

  it("resets changed project envelopes without retriggering", () => {
    const engine = new FakeChannelSource();
    const envelopeA = createEnvelope(1);
    const envelopeB = createEnvelope(1);

    renderHook(() => useAnimatedChannels(engine, { envelopes: { a: envelopeA, b: envelopeB } }));

    act(() => {
      engine.emitProject({
        changedChannelIds: ["b", "missing"],
        previousChannels: {},
        channels: {},
        positionMs: 0,
        beat: 0,
      });
    });

    expect(envelopeA.reset).not.toHaveBeenCalled();
    expect(envelopeB.reset).toHaveBeenCalledOnce();
    expect(envelopeB.trigger).not.toHaveBeenCalled();
  });

  it("samples once, ignores steps, and re-samples explicit changes when motionPreference is reduce", () => {
    const engine = new FakeChannelSource();
    engine.positionMs = 750;
    const onFrame = vi.fn();
    const order: string[] = [];
    const envelope = createEnvelope(0.25, order);

    renderHook(() => useAnimatedChannels(engine, {
      envelopes: { a: envelope },
      motionPreference: "reduce",
      onFrame,
    }));

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(envelope.sample).toHaveBeenCalledWith(750);
    expect(onFrame).toHaveBeenCalledWith({ a: 0.25 });
    expect(engine.listeners.step.size).toBe(0);
    expect(engine.listeners.playback.size).toBe(1);
    expect(engine.listeners.project.size).toBe(1);

    engine.positionMs = 1000;
    act(() => {
      engine.emitStep(stepEvent(1000));
      engine.emitPlayback(playbackEvent("seek"));
      engine.emitProject({
        changedChannelIds: ["a"],
        previousChannels: {},
        channels: {},
        positionMs: 1000,
        beat: 2,
      });
    });

    expect(envelope.trigger).not.toHaveBeenCalled();
    expect(order).toEqual([
      "a:sample:750",
      "a:reset",
      "a:sample:1000",
      "a:reset",
      "a:sample:1000",
    ]);
  });

  it("follows system reduced motion by default", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const engine = new FakeChannelSource();

    renderHook(() => useAnimatedChannels(engine));

    expect(engine.sampleChannels).toHaveBeenCalledOnce();
    expect(engine.listeners.step.size).toBe(0);
  });

  it("can ignore system reduced motion with no-preference", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const engine = new FakeChannelSource();

    renderHook(() => useAnimatedChannels(engine, { motionPreference: "no-preference" }));

    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it("PB-LC-003 ignores a disposed StrictMode source until the live source render arrives", () => {
    const engine = new FakeChannelSource();
    vi.spyOn(engine, "on").mockImplementation(() => {
      throw new PlaybackError("TRANSPORT_DISPOSED");
    });
    engine.sampleChannels.mockImplementation(() => {
      throw new PlaybackError("TRANSPORT_DISPOSED");
    });

    expect(() => {
      renderHook(() => useAnimatedChannels(engine));
    }).not.toThrow();

    act(() => rafCallback?.(0));
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });
});
