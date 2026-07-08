// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createProject, setStepValue, type PlaybackClock } from "@vixeq/core";
import { useSequencerEngine } from "./useSequencerEngine";

class FakeClock implements PlaybackClock {
  time = 0;
  now = () => this.time;
  setTimer = () => 1;
  clearTimer = () => undefined;
}

describe("useSequencerEngine", () => {
  it("supports StrictMode mount, transport state, and cleanup", async () => {
    const clock = new FakeClock();
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, unmount } = renderHook(() => useSequencerEngine({ project, clock }), { wrapper });
    expect(result.current.engine).not.toBeNull();
    await act(() => result.current.play());
    expect(result.current.isPlaying).toBe(true);
    await act(() => result.current.stop());
    expect(result.current.isPlaying).toBe(false);
    unmount();
  });

  it("hot-swaps project data without recreating the engine", () => {
    const clock = new FakeClock();
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const { result, rerender } = renderHook(({ value }) => useSequencerEngine({ project: value, clock }), { initialProps: { value: project } });
    const engine = result.current.engine;
    const next = setStepValue(project, project.tracks[0].id, 0, 1);
    rerender({ value: next });
    expect(result.current.engine).toBe(engine);
    expect(engine?.getProject().tracks[0].steps[0]).toBe(1);
  });
});
