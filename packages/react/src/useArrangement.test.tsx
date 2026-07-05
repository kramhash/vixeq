// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createArrangement, createProject, type SequencerClock } from "@vixeq/core";
import { useArrangement } from "./useArrangement";

class FakeClock implements SequencerClock {
  time = 0;
  now = () => this.time;
  setTimer = () => 1;
  clearTimer = () => undefined;
}

const pattern = createProject({ stepCount: 4, stepsPerBeat: 1, trackCount: 1 });
const arrangement = createArrangement({ patterns: { pattern }, sections: [{ id: "one", patternId: "pattern", startBeat: 0, endBeat: 4 }] });

describe("useArrangement", () => {
  it("survives StrictMode lifecycle and disposes cleanly", () => {
    const clock = new FakeClock();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, unmount } = renderHook(() => useArrangement({ arrangement, clock }), { wrapper });
    expect(result.current.engine).not.toBeNull();
    act(() => result.current.start());
    expect(result.current.isPlaying).toBe(true);
    unmount();
  });

  it("hot-swaps valid data and reports invalid updates without losing the engine", () => {
    const clock = new FakeClock();
    const onError = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useArrangement({ arrangement: value, clock, onError }), { initialProps: { value: arrangement } });
    const engine = result.current.engine;
    const replacement = createArrangement({ bpm: 90, patterns: { pattern }, sections: arrangement.sections });
    rerender({ value: replacement });
    expect(result.current.engine).toBe(engine);
    expect(engine?.getArrangement().bpm).toBe(90);
    rerender({ value: { ...replacement, sections: [{ ...replacement.sections[0], patternId: "missing" }] } });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(onError).toHaveBeenCalledOnce();
    expect(engine?.getArrangement().bpm).toBe(90);
  });

  it("seek updates section synchronously", () => {
    const clock = new FakeClock();
    const withGap = createArrangement({ patterns: { pattern }, sections: [{ id: "later", patternId: "pattern", startBeat: 4, endBeat: 8 }] });
    const { result } = renderHook(() => useArrangement({ arrangement: withGap, clock }));
    act(() => result.current.seek(4));
    expect(result.current.currentSection?.id).toBe("later");
  });
});
