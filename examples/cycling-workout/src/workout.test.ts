import { describe, expect, it } from "vitest";
import {
  WORKOUT_LIMITS,
  cloneInitialWorkout,
  normalizeCadence,
  normalizeResistance,
  sanitizeInterval,
  totalDuration,
  workoutToArrangement,
} from "./workout";

describe("cycling workout adapter", () => {
  it("maps elapsed seconds directly to arrangement beats", () => {
    const arrangement = workoutToArrangement(cloneInitialWorkout().slice(0, 2));
    expect(arrangement.bpm).toBe(60);
    expect(arrangement.sections).toEqual([
      { id: "warm-up", patternId: "interval-warm-up", startBeat: 0, endBeat: 60 },
      { id: "build", patternId: "interval-build", startBeat: 60, endBeat: 105 },
    ]);
  });

  it("normalizes physical targets to control values", () => {
    expect(normalizeCadence(40)).toBe(0);
    expect(normalizeCadence(140)).toBe(1);
    expect(normalizeResistance(55)).toBe(0.55);
  });

  it("builds ramps with exact endpoints", () => {
    const arrangement = workoutToArrangement([cloneInitialWorkout()[0]]);
    const pattern = arrangement.patterns["interval-warm-up"];
    expect(pattern.stepCount).toBe(61);
    expect(pattern.tracks[0].steps[0]).toBe(normalizeCadence(70));
    expect(pattern.tracks[0].steps.at(-1)).toBe(normalizeCadence(85));
    expect(pattern.tracks[1].steps.at(-1)).toBe(normalizeResistance(35));
  });

  it("calculates duration after add, remove, and reorder operations", () => {
    const workout = cloneInitialWorkout().slice(0, 3);
    const reordered = [workout[2], workout[0]];
    expect(totalDuration(workout)).toBe(135);
    expect(totalDuration(reordered)).toBe(90);
  });

  it("sanitizes values to the editor limits", () => {
    const interval = sanitizeInterval({
      id: "test",
      name: " ",
      duration: 999,
      cadenceStart: 0,
      cadenceEnd: 999,
      resistanceStart: -1,
      resistanceEnd: 101,
    });
    expect(interval).toMatchObject({
      name: "Untitled interval",
      duration: WORKOUT_LIMITS.maxDuration,
      cadenceStart: WORKOUT_LIMITS.minCadence,
      cadenceEnd: WORKOUT_LIMITS.maxCadence,
      resistanceStart: WORKOUT_LIMITS.minResistance,
      resistanceEnd: WORKOUT_LIMITS.maxResistance,
    });
  });
});
