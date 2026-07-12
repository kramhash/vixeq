// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClockTransport,
  createProject,
  setStepValue,
  type PlaybackClock,
  type PlaybackSnapshot,
  type PlaybackState,
  type PlaybackTransport,
  type PlaybackTransportEvent,
} from "@vixeq/core";
import { useSequencerEngine } from "./useSequencerEngine";

class FakeClock implements PlaybackClock {
  time = 0;
  now = () => this.time;
  setTimer = () => 1;
  clearTimer = () => undefined;
}

/**
 * Unlike {@link FakeClock} above (whose `setTimer` is a no-op stub used to
 * drive the hook's own rAF-based position loop by hand), this clock actually
 * queues and fires the engine's internal step-scheduling timers when
 * advanced, so natural (non-command) "tick" step events fire — mirroring
 * `packages/core/src/SequencerEngine.test.ts`'s fixture.
 */
class TickingFakeClock implements PlaybackClock {
  currentTime = 0;
  private nextTimerId = 1;
  private timers: Array<{ id: number; callback: () => void; dueAt: number }> = [];

  now = () => this.currentTime;

  setTimer = (callback: () => void, delayMs: number): unknown => {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.push({ id, callback, dueAt: this.currentTime + delayMs });
    return id;
  };

  clearTimer = (timerId: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== timerId);
  };

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

type Deferred = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

class DeferredTransport implements PlaybackTransport {
  state: PlaybackState = "stopped";
  positionMs = 0;
  playDeferred: Deferred | null = null;
  pauseDeferred: Deferred | null = null;
  private listeners = new Set<(event: PlaybackTransportEvent) => void>();

  getSnapshot = (): PlaybackSnapshot => ({
    state: this.state,
    positionMs: this.positionMs,
    durationMs: null,
    playbackRate: 1,
    loop: false,
    buffering: false,
  });

  getPlaybackState = () => this.state;
  getPositionMs = () => this.positionMs;
  getDurationMs = () => null;
  getPlaybackRate = () => 1;
  getLoop = () => false;

  play = () => new Promise<void>((resolve, reject) => {
    this.playDeferred = {
      resolve: () => {
        this.state = "playing";
        this.emit({ type: "play", snapshot: this.getSnapshot() });
        resolve();
      },
      reject,
    };
  });

  pause = () => new Promise<void>((resolve, reject) => {
    this.pauseDeferred = {
      resolve: () => {
        this.state = "paused";
        this.emit({ type: "pause", snapshot: this.getSnapshot() });
        resolve();
      },
      reject,
    };
  });

  stop = async () => {
    this.state = "stopped";
    this.positionMs = 0;
    this.emit({ type: "stop", snapshot: this.getSnapshot() });
  };

  seekMs = async (positionMs: number) => {
    const previousPositionMs = this.positionMs;
    this.positionMs = positionMs;
    this.state = positionMs === 0 ? "stopped" : "paused";
    this.emit({ type: "seek", previousPositionMs, snapshot: this.getSnapshot() });
  };

  setPlaybackRate = async () => undefined;
  setLoop = async () => undefined;

  subscribe = (listener: (event: PlaybackTransportEvent) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispose = () => undefined;

  emitPlaybackError(error: unknown) {
    this.emit({ type: "error", error, snapshot: this.getSnapshot() });
  }

  private emit(event: PlaybackTransportEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe("useSequencerEngine", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PB-RE-001 supports StrictMode mount, Playback v2 controls, and borrowed transport cleanup", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: 2000 });
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, unmount } = renderHook(() => useSequencerEngine({ project, transport }), { wrapper });

    expect(result.current.engine).not.toBeNull();
    expect(result.current.playbackState).toBe("stopped");

    await act(async () => {
      await result.current.play();
    });
    expect(result.current.playbackState).toBe("playing");

    await act(async () => {
      await result.current.pause();
    });
    expect(result.current.playbackState).toBe("paused");

    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.playbackState).toBe("stopped");

    await act(async () => {
      await result.current.seekPositionMs(500);
    });
    expect(result.current.positionRef.current.positionMs).toBe(500);

    await act(async () => {
      await result.current.setPlaybackRate(1.5);
    });
    expect(transport.getPlaybackRate()).toBe(1.5);

    await act(async () => {
      await result.current.setTransportLoop(true);
    });
    expect(transport.getLoop()).toBe(true);

    await act(async () => {
      await result.current.stop();
    });
    unmount();
    expect(transport.getPlaybackState()).toBe("stopped");
  });

  it("PB-RE-002 rejects commands without changing transportError when initial project is invalid", async () => {
    const invalidProject = { ...createProject({ stepCount: 4, trackCount: 1 }), stepCount: 0 };
    const validProject = createProject({ stepCount: 4, trackCount: 1 });
    const { result, rerender } = renderHook(
      ({ value }) => useSequencerEngine({ project: value }),
      { initialProps: { value: invalidProject } },
    );

    expect(result.current.engine).toBeNull();
    expect(result.current.projectError).toBeInstanceOf(Error);

    await expect(result.current.play()).rejects.toThrow("SequencerEngine is not available");
    expect(result.current.transportError).toBeNull();
    expect(result.current.projectError).toBeInstanceOf(Error);

    rerender({ value: validProject });
    expect(result.current.engine).not.toBeNull();
    expect(result.current.projectError).toBeNull();
  });

  it("PB-RE-003 hot-swaps valid data and preserves the engine on invalid updates", () => {
    const transport = createClockTransport(new FakeClock());
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const { result, rerender } = renderHook(
      ({ value }) => useSequencerEngine({ project: value, transport }),
      { initialProps: { value: project } },
    );
    const engine = result.current.engine;

    const next = setStepValue(project, project.tracks[0]!.id, 0, 1);
    rerender({ value: next });
    expect(result.current.engine).toBe(engine);
    expect(engine?.getProject().tracks[0]!.steps[0]).toBe(1);
    expect(result.current.projectError).toBeNull();

    rerender({ value: { ...next, stepCount: 0 } });
    expect(result.current.engine).toBe(engine);
    expect(result.current.projectError).toBeInstanceOf(Error);
    expect(engine?.getProject().stepCount).toBe(4);
  });

  it("PB-RE-004 PB-RE-006 command errors reject, set transportError, and later success clears only transportError", async () => {
    const transport = createClockTransport(new FakeClock());
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const { result, rerender } = renderHook(
      ({ value }) => useSequencerEngine({ project: value, transport }),
      { initialProps: { value: project } },
    );

    rerender({ value: { ...project, stepCount: 0 } });
    expect(result.current.projectError).toBeInstanceOf(Error);

    let seekError: unknown;
    await act(async () => {
      try {
        await result.current.seekStep(99);
      } catch (error) {
        seekError = error;
      }
    });
    expect(seekError).toBeInstanceOf(RangeError);
    expect(result.current.transportError).toBeInstanceOf(RangeError);

    await act(async () => {
      await result.current.play();
    });
    expect(result.current.transportError).toBeNull();
    expect(result.current.projectError).toBeInstanceOf(Error);
  });

  it("PB-RE-005 records unsolicited playback errors", () => {
    const transport = new DeferredTransport();
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const onTransportError = vi.fn();
    const { result } = renderHook(() => useSequencerEngine({ project, transport, onTransportError }));
    const failure = new Error("lost device");

    act(() => {
      transport.emitPlaybackError(failure);
    });

    expect(result.current.transportError).toBe(failure);
    expect(onTransportError).toHaveBeenCalledWith(failure);
  });

  it("PB-RE-007 queued toggles evaluate playback state at execution time", async () => {
    const transport = createClockTransport(new FakeClock());
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const { result } = renderHook(() => useSequencerEngine({ project, transport }));

    await act(async () => {
      await Promise.all([result.current.toggle(), result.current.toggle()]);
    });

    expect(result.current.playbackState).toBe("paused");
  });

  it("PB-RE-008 exposes the queued operation head until commands settle", async () => {
    const transport = new DeferredTransport();
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const { result } = renderHook(() => useSequencerEngine({ project, transport }));

    let playPromise!: Promise<void>;
    let pausePromise!: Promise<void>;
    act(() => {
      playPromise = result.current.play();
      pausePromise = result.current.pause();
    });

    expect(result.current.pendingOperation).toBe("play");
    expect(result.current.isBusy).toBe(true);

    await waitFor(() => expect(transport.playDeferred).not.toBeNull());
    await act(async () => {
      transport.playDeferred?.resolve();
      await playPromise;
    });
    await waitFor(() => expect(result.current.pendingOperation).toBe("pause"));

    await waitFor(() => expect(transport.pauseDeferred).not.toBeNull());
    await act(async () => {
      transport.pauseDeferred?.resolve();
      await pausePromise;
    });
    expect(result.current.pendingOperation).toBeNull();
    expect(result.current.isBusy).toBe(false);
  });

  it("PB-LC-002 survives unmount during a queued operation and keeps borrowed transport alive", async () => {
    const transport = new DeferredTransport();
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const { result, unmount } = renderHook(() => useSequencerEngine({ project, transport }));

    let playPromise!: Promise<void>;
    act(() => {
      playPromise = result.current.play();
    });
    await waitFor(() => expect(transport.playDeferred).not.toBeNull());

    unmount();

    transport.playDeferred?.resolve();
    await expect(playPromise).resolves.toBeUndefined();
    expect(transport.getPlaybackState()).toBe("playing");
  });

  it("PB-LC-003 cancels the position rAF loop on unmount", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 7));
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const { result, unmount } = renderHook(() => useSequencerEngine({ project, transport }));

    await act(async () => {
      await result.current.play();
    });
    expect(requestAnimationFrame).toHaveBeenCalled();

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  });

  it("PB-RE-009 updates positionRef and onPosition while playing without per-frame rerenders", async () => {
    const clock = new FakeClock();
    const transport = createClockTransport(clock);
    const project = createProject({ bpm: 120, stepCount: 4, stepsPerBeat: 1, trackCount: 1 });
    const onPosition = vi.fn();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useSequencerEngine({ project, transport, onPosition });
    });

    await act(async () => {
      await result.current.play();
    });
    const rendersAfterPlay = renders;

    await act(async () => {
      clock.time = 250;
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(result.current.positionRef.current.positionMs).toBeGreaterThan(0);
    expect(onPosition).toHaveBeenCalled();
    expect(renders).toBe(rendersAfterPlay);
  });

  it("PB-RE-010 mutates latestEventRef on every natural tick step without a rerender per step", async () => {
    vi.useFakeTimers();
    try {
      const clock = new TickingFakeClock();
      const transport = createClockTransport(clock);
      const project = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
      let renders = 0;
      const { result } = renderHook(() => {
        renders += 1;
        return useSequencerEngine({ project, transport, lookaheadMs: 1000 });
      });

      await act(async () => {
        await result.current.play();
      });
      expect(result.current.latestEventRef.current).toMatchObject({ stepIndex: 0, cause: "play" });
      const rendersAfterPlay = renders;

      await act(async () => {
        clock.advance(125 * 3);
        await vi.advanceTimersByTimeAsync(125 * 3);
      });

      expect(result.current.latestEventRef.current).toMatchObject({ stepIndex: 3, cause: "tick" });
      expect(renders).toBe(rendersAfterPlay);
    } finally {
      vi.useRealTimers();
    }
  });
});
