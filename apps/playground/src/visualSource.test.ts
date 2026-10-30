import { describe, expect, it } from "vitest";
import { createProject, setStepValue, type SequenceProject } from "@vixeq/core";
import { evaluateVisual, getStepMs } from "./visualSource";

// 120 BPM, 4 steps per beat: 125 ms per step, 2000 ms per pass of 16 steps.
const base = (): SequenceProject => createProject({ bpm: 120, stepCount: 16, stepsPerBeat: 4, trackCount: 4 });

const withSteps = (project: SequenceProject, track: number, steps: Array<[number, number]>) =>
  steps.reduce((next, [step, value]) => setStepValue(next, next.tracks[track].id, step, value), project);

describe("evaluateVisual", () => {
  it("is a pure function of the position", () => {
    const project = withSteps(base(), 0, [[0, 1], [4, 0.5]]);
    const order = [1730, 20, 640, 1730, 0, 640].map((positionMs) => evaluateVisual(project, positionMs));
    expect(order[3]).toEqual(order[0]);
    expect(order[5]).toEqual(order[2]);
  });

  it("peaks the kick on the step and rises just before it", () => {
    const project = withSteps(base(), 0, [[4, 1]]);
    const stepStart = 4 * getStepMs(project);

    expect(evaluateVisual(project, stepStart).energy).toBe(1);
    expect(evaluateVisual(project, stepStart - 20).energy).toBeGreaterThan(0);
    expect(evaluateVisual(project, stepStart - 20).energy).toBeLessThan(1);
    expect(evaluateVisual(project, stepStart + 300).energy).toBeLessThan(evaluateVisual(project, stepStart + 100).energy);
    expect(evaluateVisual(project, stepStart - 100).energy).toBe(0);
  });

  it("holds depth at its last non-zero value and rests in the middle until it fires", () => {
    expect(evaluateVisual(base(), 500).tracks[1]).toBe(0.5);

    const project = withSteps(base(), 1, [[0, 1], [8, 0.2]]);
    // Long after step 0, before step 8: settled on 1, held through the empty steps.
    expect(evaluateVisual(project, 7 * 125).tracks[1]).toBeCloseTo(1, 2);
    // Right on step 8 it starts from 1 and moves toward 0.2.
    expect(evaluateVisual(project, 8 * 125).tracks[1]).toBeCloseTo(1);
    expect(evaluateVisual(project, 15 * 125).tracks[1]).toBeCloseTo(0.2, 1);
  });

  it("advances the palette by each color step, cumulatively across passes", () => {
    const silent = base();
    const project = withSteps(silent, 3, [[2, 1], [10, 0.5]]);
    const advance = (positionMs: number) =>
      (evaluateVisual(project, positionMs).colorPhase - evaluateVisual(silent, positionMs).colorPhase + 1) % 1;

    expect(advance(2 * 125 - 1)).toBeCloseTo(0);
    expect(advance(2 * 125)).toBeCloseTo(0.42);
    expect(advance(10 * 125)).toBeCloseTo(0.42 + 0.25);
    // One full pass later, the pass's total (0.67) has been added once more.
    expect(advance(2000 + 2 * 125)).toBeCloseTo((0.67 + 0.42) % 1);
    // The drift alone turns the palette once every 72 s.
    expect(evaluateVisual(silent, 36_000).colorPhase).toBeCloseTo(0.5);
  });

  it("flashes on color steps and lets the flash decay", () => {
    const project = withSteps(base(), 3, [[0, 1]]);
    expect(evaluateVisual(project, 0).colorFlash).toBeCloseTo(0.9);
    expect(evaluateVisual(project, 200).colorFlash).toBeLessThan(0.9);
    expect(evaluateVisual(project, 600).colorFlash).toBe(0);
  });

  it("reports the step under the position, also at exact step starts at odd tempos", () => {
    const project = createProject({ bpm: 97, stepCount: 16, stepsPerBeat: 4, trackCount: 4 });
    const stepMs = getStepMs(project);
    for (let step = 0; step < 32; step += 1) {
      expect(evaluateVisual(project, step * stepMs).stepIndex).toBe(step % 16);
    }
  });

  it("treats a position an ulp before a step start as the step start", () => {
    // fx-canvas passes the position as seconds; at 119 BPM, step 1's start
    // comes back from ms -> s -> ms one ulp short of the step.
    const project = withSteps(createProject({ bpm: 119, stepCount: 16, stepsPerBeat: 4, trackCount: 4 }), 3, [[1, 1]]);
    const roundTripped = ((1 * getStepMs(project)) / 1000) * 1000;
    expect(roundTripped).toBeLessThan(getStepMs(project));

    const frame = evaluateVisual(project, roundTripped);
    expect(frame.stepIndex).toBe(1);
    expect(frame.colorFlash).toBeCloseTo(0.9);
    expect(frame.tracks[3]).toBeCloseTo(1);

    for (let bpm = 40; bpm <= 240; bpm += 1) {
      const everyStep = createProject({ bpm, stepCount: 16, stepsPerBeat: 4, trackCount: 4 });
      const colored = withSteps(everyStep, 3, Array.from({ length: 16 }, (_, step): [number, number] => [step, 1]));
      for (let step = 0; step < 16; step += 1) {
        const atStart = evaluateVisual(colored, ((step * getStepMs(colored)) / 1000) * 1000);
        expect([bpm, step, atStart.stepIndex, Math.round(atStart.colorFlash * 1e6) / 1e6]).toEqual([bpm, step, step, 0.9]);
      }
    }
  });

  it("interpolates complexity between steps instead of jumping", () => {
    const project = withSteps(base(), 2, [[4, 1], [5, 1]]);
    const before = evaluateVisual(project, 3 * 125).complexity;
    const middle = evaluateVisual(project, 3.5 * 125).complexity;
    const on = evaluateVisual(project, 4 * 125).complexity;
    expect(middle).toBeGreaterThan(Math.min(before, on));
    expect(middle).toBeLessThan(Math.max(before, on));
  });
});
