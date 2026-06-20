import { describe, expect, it } from "vitest";
import {
  easeInCubic,
  easeInOutCubic,
  easeInOutQuad,
  easeInQuad,
  easeOutCubic,
  easeOutQuad,
  lerp,
  linear,
} from "./easing";

const EASINGS = [linear, easeInQuad, easeOutQuad, easeInOutQuad, easeInCubic, easeOutCubic, easeInOutCubic];

describe("easing functions", () => {
  it("all return 0 at t=0", () => {
    for (const fn of EASINGS) {
      expect(fn(0)).toBe(0);
    }
  });

  it("all return 1 at t=1", () => {
    for (const fn of EASINGS) {
      expect(fn(1)).toBe(1);
    }
  });

  it("all clamp negative t to 0", () => {
    for (const fn of EASINGS) {
      expect(fn(-1)).toBe(0);
      expect(fn(-0.5)).toBe(0);
    }
  });

  it("all clamp t > 1 to 1", () => {
    for (const fn of EASINGS) {
      expect(fn(2)).toBe(1);
      expect(fn(1.5)).toBe(1);
    }
  });

  it("all return 0 for NaN", () => {
    for (const fn of EASINGS) {
      expect(fn(NaN)).toBe(0);
    }
  });

  it("all return 0 for Infinity", () => {
    for (const fn of EASINGS) {
      expect(fn(Infinity)).toBe(1);
      expect(fn(-Infinity)).toBe(0);
    }
  });

  it("linear is identity", () => {
    expect(linear(0.25)).toBeCloseTo(0.25);
    expect(linear(0.5)).toBeCloseTo(0.5);
    expect(linear(0.75)).toBeCloseTo(0.75);
  });

  it("easeInQuad: midpoint is 0.25", () => {
    expect(easeInQuad(0.5)).toBeCloseTo(0.25);
  });

  it("easeOutQuad: midpoint is 0.75", () => {
    expect(easeOutQuad(0.5)).toBeCloseTo(0.75);
  });

  it("easeInOutQuad: midpoint is 0.5", () => {
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5);
  });

  it("easeInCubic: midpoint is 0.125", () => {
    expect(easeInCubic(0.5)).toBeCloseTo(0.125);
  });

  it("easeOutCubic: midpoint is 0.875", () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
  });

  it("easeInOutCubic: midpoint is 0.5", () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });

  it("ease-in functions are monotonically increasing", () => {
    for (const fn of [easeInQuad, easeInCubic]) {
      let prev = fn(0);
      for (let i = 1; i <= 10; i++) {
        const curr = fn(i / 10);
        expect(curr).toBeGreaterThanOrEqual(prev);
        prev = curr;
      }
    }
  });

  it("ease-out functions are monotonically increasing", () => {
    for (const fn of [easeOutQuad, easeOutCubic]) {
      let prev = fn(0);
      for (let i = 1; i <= 10; i++) {
        const curr = fn(i / 10);
        expect(curr).toBeGreaterThanOrEqual(prev);
        prev = curr;
      }
    }
  });
});

describe("lerp", () => {
  it("returns from at t=0", () => {
    expect(lerp(0, 1, 0)).toBe(0);
    expect(lerp(0.2, 0.8, 0)).toBe(0.2);
  });

  it("returns to at t=1", () => {
    expect(lerp(0, 1, 1)).toBe(1);
    expect(lerp(0.2, 0.8, 1)).toBe(0.8);
  });

  it("interpolates at midpoint", () => {
    expect(lerp(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(lerp(0.2, 0.6, 0.5)).toBeCloseTo(0.4);
  });

  it("clamps t to 0–1 range", () => {
    expect(lerp(0, 1, -1)).toBe(0);
    expect(lerp(0, 1, 2)).toBe(1);
  });

  it("works with same from and to", () => {
    expect(lerp(0.5, 0.5, 0.7)).toBeCloseTo(0.5);
  });
});
