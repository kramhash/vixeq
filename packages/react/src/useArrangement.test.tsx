// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createArrangement,
  createClockTransport,
  createProject,
  type PlaybackClock,
} from "@vixeq/core";
import { useArrangement } from "./useArrangement";

class FakeClock implements PlaybackClock {
  time = 0;
  now = () => this.time;
  setTimer = () => 1;
  clearTimer = () => undefined;
}

/**
 * Unlike {@link FakeClock} above (whose `setTimer` is a no-op stub), this
 * clock actually queues and fires the engine's internal step-scheduling
 * timers when advanced, so natural (non-command) "tick" step events fire —
 * mirroring `packages/core/src/SequencerEngine.test.ts`'s fixture.
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

const pattern = createProject({ stepCount: 4, stepsPerBeat: 1, trackCount: 1 });
const arrangement = createArrangement({
  durationBeats: 4,
  patterns: { pattern },
  sections: [{ id: "one", patternId: "pattern", startBeat: 0, endBeat: 4 }],
});

describe("useArrangement", () => {
  it("PB-RE-001 supports StrictMode lifecycle and Playback v2 controls", async () => {
    const transport = createClockTransport(new FakeClock(), { durationMs: 4000 });
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const onPlaybackChange = vi.fn();
    const { result, unmount } = renderHook(() => useArrangement({ arrangement, transport, onPlaybackChange }), { wrapper });

    expect(result.current.engine).not.toBeNull();
    expect(result.current.currentSection?.id).toBe("one");
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
      await result.current.seekPositionMs(500);
    });
    expect(result.current.positionRef.current.positionMs).toBe(500);

    await act(async () => {
      await result.current.setPlaybackRate(1.25);
    });
    expect(transport.getPlaybackRate()).toBe(1.25);

    await act(async () => {
      await result.current.setTransportLoop(true);
    });
    expect(transport.getLoop()).toBe(true);

    await act(async () => {
      await result.current.setLoop(true);
    });
    expect(onPlaybackChange).toHaveBeenLastCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({ projectLoop: true }),
    }));

    unmount();
    expect(transport.getPlaybackState()).toBe("paused");
  });

  it("PB-RE-002 rejects commands without changing transportError when initial arrangement is invalid", async () => {
    const invalidArrangement = {
      ...arrangement,
      sections: [{ ...arrangement.sections[0]!, patternId: "missing" }],
    };
    const { result, rerender } = renderHook(
      ({ value }) => useArrangement({ arrangement: value }),
      { initialProps: { value: invalidArrangement } },
    );

    expect(result.current.engine).toBeNull();
    expect(result.current.projectError).toBeInstanceOf(Error);

    await expect(result.current.play()).rejects.toThrow("ArrangementEngine is not available");
    expect(result.current.transportError).toBeNull();

    rerender({ value: arrangement });
    expect(result.current.engine).not.toBeNull();
    expect(result.current.projectError).toBeNull();
  });

  it("PB-RE-003 hot-swaps valid data and reports invalid updates without losing the engine", async () => {
    const transport = createClockTransport(new FakeClock());
    const onProjectError = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useArrangement({ arrangement: value, transport, onProjectError }),
      { initialProps: { value: arrangement } },
    );
    const engine = result.current.engine;

    await act(async () => {
      await transport.seekMs(1000);
    });

    const replacement = createArrangement({
      timing: { bpm: 60 },
      durationBeats: arrangement.durationBeats,
      patterns: { pattern },
      sections: arrangement.sections,
    });
    rerender({ value: replacement });
    expect(result.current.engine).toBe(engine);
    expect(engine?.getArrangement().timing.tempos[0].bpm).toBe(60);
    expect(transport.getPositionMs()).toBe(1000);
    expect(result.current.positionRef.current).toMatchObject({ beat: 2, positionMs: 2000 });
    expect(result.current.projectError).toBeNull();

    rerender({ value: { ...replacement, sections: [{ ...replacement.sections[0]!, patternId: "missing" }] } });
    expect(result.current.projectError).toBeInstanceOf(Error);
    expect(onProjectError).toHaveBeenCalledOnce();
    expect(engine?.getArrangement().timing.tempos[0].bpm).toBe(60);
  });

  it("seekBeat updates position and section synchronously", async () => {
    const transport = createClockTransport(new FakeClock());
    const withGap = createArrangement({
      durationBeats: 8,
      patterns: { pattern },
      sections: [{ id: "later", patternId: "pattern", startBeat: 4, endBeat: 8 }],
    });
    const { result } = renderHook(() => useArrangement({ arrangement: withGap, transport }));

    await act(async () => {
      await result.current.seekBeat(4);
    });

    expect(result.current.currentSection?.id).toBe("later");
    expect(result.current.positionRef.current.beat).toBe(4);
    expect(result.current.playbackState).toBe("paused");
  });

  it("PB-RE-004 mutates latestEventRef on every natural tick step without a rerender per step", async () => {
    vi.useFakeTimers();
    try {
      const clock = new TickingFakeClock();
      const transport = createClockTransport(clock);
      let renders = 0;
      const { result } = renderHook(() => {
        renders += 1;
        return useArrangement({ arrangement, transport, lookaheadMs: 1000 });
      });

      await act(async () => {
        await result.current.play();
      });
      expect(result.current.latestEventRef.current).toMatchObject({ stepIndex: 0, cause: "play" });
      const rendersAfterPlay = renders;

      // pattern is bpm 120 / stepsPerBeat 1 -> one step every 500ms.
      await act(async () => {
        clock.advance(500 * 3);
        await vi.advanceTimersByTimeAsync(500 * 3);
      });

      expect(result.current.latestEventRef.current).toMatchObject({ stepIndex: 3, cause: "tick" });
      expect(renders).toBe(rendersAfterPlay);
    } finally {
      vi.useRealTimers();
    }
  });
});
