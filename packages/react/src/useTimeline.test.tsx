// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createClockTransport,
  createTimelineProject,
  type PlaybackClock,
  type TimelineCueEvent,
  type TimelineEvent,
  type TimelineProject,
} from "@vixeq/core";
import { useTimeline } from "./useTimeline";

class FakeClock implements PlaybackClock {
  time = 0;
  now = () => this.time;
  setTimer = () => 1;
  clearTimer = () => undefined;
}

/**
 * Unlike {@link FakeClock} above (whose `setTimer` is a no-op stub), this
 * clock actually queues and fires the engine's internal cue-scheduling
 * timers when advanced, so natural (non-command) cues fire — mirroring
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

type CaptionEvent = TimelineEvent<"caption", { text: string }>;

const project = createTimelineProject({
  durationBeats: 4,
  events: [
    { id: "intro", trackId: null, beat: 0, type: "caption", data: { text: "Intro" } },
    { id: "middle", trackId: null, beat: 2, type: "caption", data: { text: "Middle" } },
  ],
}) as TimelineProject<CaptionEvent>;

describe("useTimeline", () => {
  it("supports StrictMode lifecycle and Playback v2 controls", async () => {
    const transport = createClockTransport(new FakeClock(), { durationMs: 4000 });
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const onPlaybackChange = vi.fn();
    const { result, unmount } = renderHook(() => useTimeline({ project, transport, onPlaybackChange }), { wrapper });

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
      await result.current.seekBeat(2);
    });
    expect(result.current.positionRef.current.beat).toBe(2);

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

  it("wires cue events to latestEventRef and onCue with generic event data", async () => {
    const transport = createClockTransport(new FakeClock());
    const onCue = vi.fn<(event: TimelineCueEvent<CaptionEvent>) => void>();
    const { result } = renderHook(() => useTimeline<CaptionEvent>({ project, transport, onCue }));

    await act(async () => {
      await result.current.play();
    });

    expect(onCue).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: "intro" }),
    }));
    expect(result.current.latestEventRef.current).toMatchObject({ event: { id: "intro" } });

    const latest = result.current.latestEventRef.current;
    if (latest && "event" in latest) {
      const text: string | undefined = latest.event.data?.text;
      expect(text).toBe("Intro");
    }
  });

  it("rejects commands without changing transportError when initial project is invalid", async () => {
    const invalidProject: TimelineProject<CaptionEvent> = {
      ...project,
      events: [{ ...project.events[0]!, trackId: "missing" }],
    };
    const { result, rerender } = renderHook(
      ({ value }) => useTimeline({ project: value }),
      { initialProps: { value: invalidProject } },
    );

    expect(result.current.engine).toBeNull();
    expect(result.current.projectError).toBeInstanceOf(Error);

    await expect(result.current.play()).rejects.toThrow("TimelineEngine is not available");
    expect(result.current.transportError).toBeNull();

    rerender({ value: project });
    expect(result.current.engine).not.toBeNull();
    expect(result.current.projectError).toBeNull();
  });

  it("hot-swaps valid projects and preserves the engine on invalid updates", async () => {
    const transport = createClockTransport(new FakeClock());
    const onProjectError = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useTimeline({ project: value, transport, onProjectError }),
      { initialProps: { value: project } },
    );
    const engine = result.current.engine;

    await act(async () => {
      await transport.seekMs(1000);
    });

    const replacement = createTimelineProject({
      timing: { bpm: 60 },
      durationBeats: 4,
      events: [{ id: "replacement", trackId: null, beat: 1, type: "caption", data: { text: "Next" } }],
    }) as TimelineProject<CaptionEvent>;

    rerender({ value: replacement });
    expect(result.current.engine).toBe(engine);
    expect(engine?.getProject()).toBe(replacement);
    expect(transport.getPositionMs()).toBe(1000);
    expect(result.current.positionRef.current).toMatchObject({ beat: 2, positionMs: 2000 });
    expect(result.current.projectError).toBeNull();

    rerender({
      value: {
        ...replacement,
        events: [{ ...replacement.events[0]!, trackId: "missing" }],
      },
    });
    expect(result.current.projectError).toBeInstanceOf(Error);
    expect(onProjectError).toHaveBeenCalledOnce();
    expect(engine?.getProject()).toBe(replacement);
  });

  it("rebuilds the engine when eventValidator changes", () => {
    const accept = vi.fn((event: CaptionEvent) => {
      if (!event.data?.text) throw new Error("caption text required");
    });
    const reject = vi.fn(() => {
      throw new Error("rejected by validator");
    });
    const { result, rerender } = renderHook(
      ({ validator }) => useTimeline<CaptionEvent>({ project, eventValidator: validator }),
      { initialProps: { validator: accept } },
    );
    const engine = result.current.engine;

    rerender({ validator: reject });

    expect(result.current.engine).not.toBe(engine);
    expect(result.current.engine).toBeNull();
    expect(result.current.projectError).toBeInstanceOf(Error);
  });

  it("does not rebuild the engine when only loop changes", async () => {
    const { result, rerender } = renderHook(({ loop }) => useTimeline({ project, loop }), {
      initialProps: { loop: false },
    });

    await act(async () => {
      await result.current.seekBeat(2);
    });
    const engine = result.current.engine;
    expect(result.current.positionRef.current.beat).toBe(2);

    rerender({ loop: true });

    expect(result.current.engine).toBe(engine);
    expect(result.current.positionRef.current.beat).toBe(2);
  });

  it("reports transport command errors through transportError", async () => {
    const transport = createClockTransport(new FakeClock());
    const onTransportError = vi.fn();
    const { result } = renderHook(() => useTimeline({ project, transport, onTransportError }));

    await act(async () => {
      await expect(result.current.setTransportLoop(true)).rejects.toMatchObject({
        code: "DURATION_UNAVAILABLE",
      });
    });

    expect(result.current.transportError).toMatchObject({ code: "DURATION_UNAVAILABLE" });
    expect(onTransportError).toHaveBeenCalledOnce();
  });

  it("accepts generic TimelineEvent data in callbacks", () => {
    const typedProject: TimelineProject<CaptionEvent> = project;
    const onCue = (event: TimelineCueEvent<CaptionEvent>) => {
      const data: { text: string } | undefined = event.event.data;
      return data?.text;
    };

    const { result } = renderHook(() => useTimeline({ project: typedProject, onCue }));

    expect(result.current.engine?.getProject()).toBe(typedProject);
  });

  it("mutates latestEventRef on every natural cue without a rerender per cue", async () => {
    vi.useFakeTimers();
    try {
      const clock = new TickingFakeClock();
      const transport = createClockTransport(clock);
      let renders = 0;
      const { result } = renderHook(() => {
        renders += 1;
        return useTimeline<CaptionEvent>({ project, transport, lookaheadMs: 1000 });
      });

      await act(async () => {
        await result.current.play();
      });
      expect(result.current.latestEventRef.current).toMatchObject({ event: { id: "intro" } });
      const rendersAfterPlay = renders;

      // Default timing is bpm 120 (500ms/beat); the "middle" cue is at beat 2 (1000ms).
      await act(async () => {
        clock.advance(1000);
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(result.current.latestEventRef.current).toMatchObject({ event: { id: "middle" } });
      expect(renders).toBe(rendersAfterPlay);
    } finally {
      vi.useRealTimers();
    }
  });
});
