import { describe, expect, it } from "vitest";
import { clamp01, decaySmoothedValue, exciteSmoothedValue } from "./smoothing";

describe("smoothing utilities", () => {
  it("clamps values to the 0-1 range", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });

  it("excites a value with impact and lift", () => {
    expect(exciteSmoothedValue(0.2, 1, { decayRate: 1, impact: 0.5, lift: 0.1 })).toBe(0.6);
  });

  it("supports a rest point and held zero input", () => {
    const config = { decayRate: 1, impact: 0.7, lift: 0.1, rest: 0.5, holdWhenInputZero: true };

    expect(exciteSmoothedValue(0.75, 0, config)).toBe(0.75);
    expect(decaySmoothedValue(1, 1, config)).toBeGreaterThan(0.5);
  });

  it("decays toward zero by default", () => {
    expect(decaySmoothedValue(1, 1, { decayRate: 2, impact: 1, lift: 0 })).toBeLessThan(0.2);
  });
});
