// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClockTransport,
  createProject,
  type PlaybackClock,
  type PlaybackTransport,
} from "@vixeq/core";
import { SequencePlayer, type SequencePlayerChangeReason, type SequencePlayerRef } from "./SequencePlayer";

class FakeClock implements PlaybackClock {
  time = 0;
  now = () => this.time;
  setTimer = () => 1;
  clearTimer = () => undefined;
}

const createDeferredPlayTransport = (): {
  transport: PlaybackTransport;
  resolvePlay: () => Promise<void>;
} => {
  const base = createClockTransport(new FakeClock(), { durationMs: 4000 });
  let resolvePlayRequest: (() => void) | null = null;
  const playRequest = new Promise<void>((resolve) => {
    resolvePlayRequest = resolve;
  });

  return {
    transport: {
      ...base,
      play: async () => {
        await playRequest;
        await base.play();
      },
    },
    resolvePlay: async () => {
      resolvePlayRequest?.();
      await playRequest;
    },
  };
};

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { value: vi.fn(), configurable: true });
});
afterEach(cleanup);

describe("SequencePlayer", () => {
  it("emits the public edit reasons for visible editor operations", async () => {
    const user = userEvent.setup();
    const project = createProject({ trackCount: 2, stepCount: 4, trackNames: ["Alpha", "Beta"] });
    const onChange = vi.fn();
    render(<SequencePlayer project={project} onProjectChange={onChange} />);
    await user.clear(screen.getByLabelText("Alpha name"));
    await user.type(screen.getByLabelText("Alpha name"), "Renamed");
    await user.click(screen.getAllByText("On")[0]);
    await user.click(screen.getAllByText("Remove")[0]);
    await user.click(screen.getByText("Add Lane"));
    await user.click(screen.getByTitle("Alpha step 1: 0.00"));
    fireEvent.change(screen.getByLabelText("BPM"), { target: { value: "90" } });
    const reasons = new Set(onChange.mock.calls.map(([change]) => change.reason));
    expect(reasons).toEqual(new Set<SequencePlayerChangeReason>(["track:rename", "track:enabled", "track:remove", "track:add", "step:toggle", "bpm"]));
  });

  it("emits step:value during pointer drag", () => {
    const project = createProject({ trackCount: 1, stepCount: 4, trackNames: ["Alpha"] });
    const onChange = vi.fn();
    render(<SequencePlayer project={project} onProjectChange={onChange} />);
    const cell = screen.getByTitle("Alpha step 1: 0.00");
    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({ top: 0, height: 100, left: 0, right: 100, bottom: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(cell, { pointerId: 1, clientX: 10, clientY: 90, buttons: 1 });
    fireEvent.pointerMove(cell, { pointerId: 1, clientX: 10, clientY: 20, buttons: 1 });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: "step:value", stepIndex: 0 }));
  });

  it("PB-UI-001 PB-UI-002 PB-UI-003 PB-UI-005 PB-UI-006 exposes Playback v2 controls", async () => {
    const ref = createRef<SequencePlayerRef>();
    const clock = new FakeClock();
    const transport = createClockTransport(clock, { durationMs: 20_000 });
    const project = createProject({ bpm: 120, stepCount: 4, trackCount: 1 });
    render(<SequencePlayer ref={ref} project={project} transport={transport} onProjectChange={() => undefined} />);
    expect((screen.getByText("Play") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText("Stop") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { await ref.current?.play(); });
    expect(screen.getByText("Pause")).toBeTruthy();
    await act(async () => {
      clock.time = 250;
      await ref.current?.pause();
    });
    expect(screen.getByText("Resume")).toBeTruthy();
    await act(async () => { await ref.current?.seekStep(2); });
    expect(screen.getByText("Step 3")).toBeTruthy();
    await act(async () => { await ref.current?.seekPositionMs(9000); });
    expect(transport.getPositionMs()).toBe(9000);
    expect(screen.getByText("Step 1")).toBeTruthy();
    await act(async () => { await ref.current?.setPlaybackRate(1.5); });
    expect(transport.getPlaybackRate()).toBe(1.5);
    await act(async () => { await ref.current?.setTransportLoop(true); });
    expect(transport.getLoop()).toBe(true);
    await act(async () => { await ref.current?.stop(); });
    expect(screen.getByText("Play")).toBeTruthy();
    expect(screen.getByText("Step 1")).toBeTruthy();
    expect(transport.getPositionMs()).toBe(0);
  });

  it("PB-UI-004 disables transport controls while an operation is pending", async () => {
    const { transport, resolvePlay } = createDeferredPlayTransport();
    render(
      <SequencePlayer
        project={createProject({ trackCount: 1 })}
        transport={transport}
        onProjectChange={() => undefined}
      />,
    );

    await userEvent.click(screen.getByText("Play"));
    expect((screen.getByText("Working...") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Stop") as HTMLButtonElement).disabled).toBe(true);

    await act(resolvePlay);
    expect((screen.getByText("Pause") as HTMLButtonElement).disabled).toBe(false);
  });

  it("PB-UI-007 renders a recoverable transport error", async () => {
    const base = createClockTransport(new FakeClock(), { durationMs: 4000 });
    const transport: PlaybackTransport = {
      ...base,
      play: () => Promise.reject(new Error("play blocked")),
    };
    render(
      <SequencePlayer
        project={createProject({ trackCount: 1 })}
        transport={transport}
        onProjectChange={() => undefined}
      />,
    );

    await userEvent.click(screen.getByText("Play"));
    expect((await screen.findByRole("alert")).textContent).toContain("Transport failed");
    expect((screen.getByText("Play") as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders project validation failures separately from transport failures", async () => {
    const project = { ...createProject({ trackCount: 1 }), bpm: 0 };
    render(<SequencePlayer project={project} onProjectChange={() => undefined} />);

    expect((await screen.findByRole("alert")).textContent).toContain("Project failed to load");
  });
});
