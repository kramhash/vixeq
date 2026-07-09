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

const pattern = createProject({ stepCount: 4, stepsPerBeat: 1, trackCount: 1 });
const arrangement = createArrangement({
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

  it("PB-RE-003 hot-swaps valid data and reports invalid updates without losing the engine", () => {
    const transport = createClockTransport(new FakeClock());
    const onProjectError = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useArrangement({ arrangement: value, transport, onProjectError }),
      { initialProps: { value: arrangement } },
    );
    const engine = result.current.engine;

    const replacement = createArrangement({ bpm: 90, patterns: { pattern }, sections: arrangement.sections });
    rerender({ value: replacement });
    expect(result.current.engine).toBe(engine);
    expect(engine?.getArrangement().bpm).toBe(90);
    expect(result.current.projectError).toBeNull();

    rerender({ value: { ...replacement, sections: [{ ...replacement.sections[0]!, patternId: "missing" }] } });
    expect(result.current.projectError).toBeInstanceOf(Error);
    expect(onProjectError).toHaveBeenCalledOnce();
    expect(engine?.getArrangement().bpm).toBe(90);
  });

  it("seekBeat updates position and section synchronously", async () => {
    const transport = createClockTransport(new FakeClock());
    const withGap = createArrangement({
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
});
