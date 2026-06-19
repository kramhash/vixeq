import { describe, expect, it } from "vitest";
import { createVisualEnvelope, decayEnvelope, exciteEnvelope } from "./visualEnvelope";

const input = (color: number, complexity = 0) => ({
  energy: 0,
  accent: 0,
  complexity,
  tracks: [0, 0, 0, color] as [number, number, number, number],
});

describe("visualEnvelope color shift", () => {
  it("advances the palette phase and emits a flash when color shift is triggered", () => {
    const initial = createVisualEnvelope();
    const excited = exciteEnvelope(initial, input(1));

    expect(excited.colorPhase).toBeCloseTo(0.42);
    expect(excited.colorFlash).toBeCloseTo(0.9);
    expect(excited.tracks[3]).toBeGreaterThan(0.9);
  });

  it("does not flash on empty color steps but keeps drifting slowly", () => {
    const initial = createVisualEnvelope();
    const drifted = decayEnvelope(initial, 36);
    const held = exciteEnvelope(drifted, input(0));

    expect(drifted.colorPhase).toBeCloseTo(0.5);
    expect(held.colorPhase).toBe(drifted.colorPhase);
    expect(held.colorFlash).toBe(0);
  });

  it("decays color flash while preserving palette phase movement", () => {
    const excited = exciteEnvelope(createVisualEnvelope(), input(0.75));
    const decayed = decayEnvelope(excited, 1);

    expect(decayed.colorFlash).toBeLessThan(excited.colorFlash);
    expect(decayed.colorPhase).toBeGreaterThan(excited.colorPhase);
  });

  it("smooths complexity before it reaches the shader", () => {
    const excited = exciteEnvelope(createVisualEnvelope(), input(0, 1));
    const decayed = decayEnvelope(excited, 0.5);

    expect(excited.complexity).toBeGreaterThan(0.7);
    expect(excited.complexity).toBeLessThan(0.8);
    expect(decayed.complexity).toBeLessThan(excited.complexity);
  });
});
