import { describe, expect, it } from "vitest";
import { createDecayEnvelope, createEnvelope } from "./envelope";
import { decaySmoothedValue, exciteSmoothedValue } from "./smoothing";
import { easeInOutQuad, linear } from "./easing";

// ─── createEnvelope ────────────────────────────────────────────────────────

describe("createEnvelope", () => {
  it("returns 0 before any trigger", () => {
    const env = createEnvelope({ decay: 200 });
    expect(env.sample(0)).toBe(0);
    expect(env.sample(1000)).toBe(0);
  });

  it("snaps to peak immediately when attack=0 (default)", () => {
    const env = createEnvelope({ decay: 200 });
    env.trigger(0, 1);
    expect(env.sample(0)).toBe(1);
  });

  it("rises to peak during attack phase", () => {
    const env = createEnvelope({ attack: 100, decay: 200, curve: linear });
    env.trigger(0, 1);
    expect(env.sample(0)).toBeCloseTo(0, 5);
    expect(env.sample(50)).toBeCloseTo(0.5, 5);
    expect(env.sample(100)).toBeCloseTo(1, 5);
  });

  it("falls from peak to 0 during decay phase", () => {
    const env = createEnvelope({ attack: 0, decay: 200, curve: linear });
    env.trigger(0, 1);
    expect(env.sample(0)).toBeCloseTo(1, 5);
    expect(env.sample(100)).toBeCloseTo(0.5, 5);
    expect(env.sample(200)).toBeCloseTo(0, 5);
  });

  it("returns 0 after decay completes", () => {
    const env = createEnvelope({ decay: 100 });
    env.trigger(0, 1);
    expect(env.sample(200)).toBe(0);
  });

  it("respects the peak option", () => {
    const env = createEnvelope({ decay: 100, peak: 0.5 });
    env.trigger(0); // value defaults to 1; scaled by peak → 0.5
    expect(env.sample(0)).toBeCloseTo(0.5, 5);
  });

  it("scales peak by trigger value", () => {
    const env = createEnvelope({ decay: 100 });
    env.trigger(0, 0.8);
    expect(env.sample(0)).toBeCloseTo(0.8, 5);
  });

  it("clamps peak to 0–1", () => {
    const env = createEnvelope({ decay: 100 });
    env.trigger(0, 2); // value clamped to 1
    expect(env.sample(0)).toBeCloseTo(1, 5);
  });

  it("can be re-triggered mid-decay", () => {
    const env = createEnvelope({ decay: 200, curve: linear });
    env.trigger(0, 1);
    // At t=100 the value is 0.5; now retrigger
    env.trigger(100, 1);
    expect(env.sample(100)).toBeCloseTo(1, 5);
  });

  it("respects absolute time offset for trigger", () => {
    const env = createEnvelope({ decay: 100, curve: linear });
    env.trigger(500, 1); // origin is at 500ms
    expect(env.sample(500)).toBeCloseTo(1, 5);
    expect(env.sample(550)).toBeCloseTo(0.5, 5);
    expect(env.sample(600)).toBeCloseTo(0, 5);
  });

  it("applies custom easing curve", () => {
    // Use t=0.25 where easeInOutQuad diverges from linear:
    // easeInOutQuad(0.25) = 2 * 0.25² = 0.125  vs  linear(0.25) = 0.25
    const env = createEnvelope({ attack: 100, curve: easeInOutQuad });
    env.trigger(0, 1);
    const t = 0.25;
    const expectedEased = easeInOutQuad(t); // 0.125
    const expectedLinear = t;               // 0.25
    expect(expectedEased).not.toBeCloseTo(expectedLinear, 3);
    expect(env.sample(25)).toBeCloseTo(expectedEased, 5);
  });

  it("returns 0 for samples before trigger time", () => {
    const env = createEnvelope({ decay: 100 });
    env.trigger(500, 1);
    expect(env.sample(400)).toBe(0);
  });

  it("resets to rest and clears the trigger", () => {
    const env = createEnvelope({ decay: 100 });
    env.trigger(0, 1);
    expect(env.sample(0)).toBe(1);

    env.reset();

    expect(env.sample(0)).toBe(0);
    expect(env.sample(50)).toBe(0);
  });
});

// ─── createDecayEnvelope ───────────────────────────────────────────────────

describe("createDecayEnvelope", () => {
  const config = { decayRate: 4.5, impact: 1.0, lift: 0 };

  it("returns 0 before any trigger", () => {
    const env = createDecayEnvelope(config);
    expect(env.sample(0)).toBe(0);
    expect(env.sample(1000)).toBe(0);
  });

  it("jumps to input * impact on trigger", () => {
    const env = createDecayEnvelope(config);
    env.trigger(0, 1);
    // After trigger, current = exciteSmoothedValue(0, 1, config) = 1 * impact = 1
    const excited = exciteSmoothedValue(0, 1, config);
    expect(env.sample(0)).toBeCloseTo(excited, 5);
  });

  it("decays after trigger using exponential decay", () => {
    const env = createDecayEnvelope(config);
    env.trigger(0, 1);
    const initial = env.sample(0); // first sample sets lastSampleTime, no decay yet
    const afterDecay = env.sample(1000); // 1 second later
    expect(afterDecay).toBeLessThan(initial);
    // Verify against decaySmoothedValue over 1 second
    const expected = decaySmoothedValue(initial, 1, config);
    expect(afterDecay).toBeCloseTo(expected, 4);
  });

  it("can be re-triggered mid-decay", () => {
    const env = createDecayEnvelope(config);
    env.trigger(0, 1);
    const v1 = env.sample(0);
    const v2 = env.sample(500); // decayed for 0.5s
    expect(v2).toBeLessThan(v1);
    env.trigger(500, 1); // re-trigger at current (decayed) value
    const v3 = env.sample(500); // same time as trigger — excite applies but no decay
    expect(v3).toBeGreaterThanOrEqual(v2);
  });

  it("supports partial trigger value", () => {
    const env = createDecayEnvelope(config);
    env.trigger(0, 0.5);
    const excited = exciteSmoothedValue(0, 0.5, config);
    expect(env.sample(0)).toBeCloseTo(excited, 5);
  });

  it("respects lift in config", () => {
    const liftConfig = { decayRate: 3.0, impact: 0.8, lift: 0.1 };
    const env = createDecayEnvelope(liftConfig);
    env.trigger(0, 1);
    const expected = exciteSmoothedValue(0, 1, liftConfig);
    expect(env.sample(0)).toBeCloseTo(expected, 5);
  });

  it("respects rest in config", () => {
    const restConfig = { decayRate: 3.0, impact: 1.0, lift: 0, rest: 0.1 };
    const env = createDecayEnvelope(restConfig);
    env.trigger(0, 1);
    // Decay a long time — should approach rest
    let val = env.sample(0);
    val = env.sample(10_000); // 10 seconds
    // Should be very close to rest = 0.1
    expect(val).toBeCloseTo(0.1, 2);
  });

  it("does not corrupt lastSampleTime on backwards time", () => {
    const env = createDecayEnvelope(config);
    env.trigger(0, 1);
    const v0 = env.sample(0);   // lastSampleTime = 0
    const v1 = env.sample(500); // decays for 0.5s; lastSampleTime = 500
    expect(v1).toBeLessThan(v0);

    // Scrub backwards — should not change the decayed value
    const vBack = env.sample(250);
    expect(vBack).toBeCloseTo(v1, 5); // same value, no decay applied

    // After the backward sample, forward time should resume from the last valid
    // baseline (500ms), not from 250ms
    const v2 = env.sample(1000); // 0.5s of decay from t=500, not 0.75s from t=250
    const expected = decaySmoothedValue(v1, 0.5, config);
    expect(v2).toBeCloseTo(expected, 4);
  });

  it("resets current value and sample baseline", () => {
    const env = createDecayEnvelope(config);
    env.trigger(0, 1);
    expect(env.sample(0)).toBeGreaterThan(0);

    env.reset();

    expect(env.sample(0)).toBe(0);
    expect(env.sample(1000)).toBe(0);
  });

  it("does not leak old decay state after reset and backward sampling", () => {
    const env = createDecayEnvelope(config);
    env.trigger(500, 1);
    expect(env.sample(500)).toBeGreaterThan(0);

    env.reset();
    expect(env.sample(250)).toBe(0);
    env.trigger(300, 0.5);

    const expected = exciteSmoothedValue(0, 0.5, config);
    expect(env.sample(300)).toBeCloseTo(expected, 5);
  });
});
