// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, type PlaybackClock } from "@vixeq/core";
import { SequencePlayer, type SequencePlayerChangeReason, type SequencePlayerRef } from "./SequencePlayer";

class FakeClock implements PlaybackClock {
  now = () => 0;
  setTimer = () => 1;
  clearTimer = () => undefined;
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { value: vi.fn(), configurable: true });
});
afterEach(cleanup);

describe("SequencePlayer", () => {
  it("emits the public edit reasons for visible editor operations", async () => {
    const user = userEvent.setup();
    const project = createProject({ trackCount: 2, stepCount: 4, trackNames: ["Alpha", "Beta"] });
    const onChange = vi.fn();
    render(<SequencePlayer project={project} clock={new FakeClock()} onProjectChange={onChange} />);
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
    render(<SequencePlayer project={project} clock={new FakeClock()} onProjectChange={onChange} />);
    const cell = screen.getByTitle("Alpha step 1: 0.00");
    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({ top: 0, height: 100, left: 0, right: 100, bottom: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(cell, { pointerId: 1, clientX: 10, clientY: 90, buttons: 1 });
    fireEvent.pointerMove(cell, { pointerId: 1, clientX: 10, clientY: 20, buttons: 1 });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: "step:value", stepIndex: 0 }));
  });

  it("exposes imperative transport controls", async () => {
    const ref = createRef<SequencePlayerRef>();
    const project = createProject({ trackCount: 1 });
    render(<SequencePlayer ref={ref} project={project} clock={new FakeClock()} onProjectChange={() => undefined} />);
    await act(async () => { await ref.current?.play(); });
    expect(screen.getByText("Stop")).toBeTruthy();
    await act(async () => { await ref.current?.stop(); });
    expect(screen.getByText("Play")).toBeTruthy();
    await act(async () => { await ref.current?.reset(); });
  });
});
