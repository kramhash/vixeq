import { lerp, linear, type EasingFunction } from "./easing";
import { clamp01, decaySmoothedValue, exciteSmoothedValue } from "./smoothing";
import type { SmoothingConfig } from "./smoothing";

/** Stateful envelope: trigger on a step event, sample at any timestamp. */
export type Envelope = {
  /** Excite the envelope at the given absolute time (ms). value 0–1, default 1. */
  trigger(timeMs: number, value?: number): void;
  /** Return the current 0–1 envelope value at the given absolute time (ms). */
  sample(timeMs: number): number;
};

export type CreateEnvelopeOptions = {
  /** Attack duration in ms (0 = instant snap to peak). Default 0. */
  attack?: number;
  /** Decay duration in ms (time to fall from peak back to 0). Default 300. */
  decay?: number;
  /** Easing applied to both attack and decay phases. Default linear. */
  curve?: EasingFunction;
  /** Maximum output value 0–1 (multiplied by the trigger's value). Default 1. */
  peak?: number;
};

/**
 * Time-based envelope: attack phase (0 → peak) then decay phase (peak → 0).
 * Both durations are in milliseconds; the curve is applied to both phases.
 */
export const createEnvelope = (options: CreateEnvelopeOptions = {}): Envelope => {
  const attack = Math.max(0, options.attack ?? 0);
  const decay = Math.max(1, options.decay ?? 300);
  const curve = options.curve ?? linear;
  const peakScale = clamp01(options.peak ?? 1);

  let triggerTime: number | null = null;
  let triggerPeak = peakScale;

  return {
    trigger(timeMs: number, value?: number): void {
      triggerTime = timeMs;
      triggerPeak = value !== undefined ? clamp01(value) * peakScale : peakScale;
    },

    sample(timeMs: number): number {
      if (triggerTime === null) return 0;
      const elapsed = timeMs - triggerTime;
      if (elapsed < 0) return 0;

      if (attack > 0 && elapsed < attack) {
        // Attack phase: 0 → peak
        return lerp(0, triggerPeak, curve(elapsed / attack));
      }

      const decayElapsed = elapsed - attack;
      if (decayElapsed >= decay) return 0;

      // Decay phase: peak → 0
      return lerp(triggerPeak, 0, curve(decayElapsed / decay));
    },
  };
};

/**
 * Exponential-decay envelope backed by smoothing.ts primitives.
 * Matches the impulse-and-decay pattern used in the website-pulse example.
 * trigger() excites the state; sample() applies per-frame exponential decay.
 */
export const createDecayEnvelope = (config: SmoothingConfig): Envelope => {
  let current = 0;
  let lastSampleTime: number | null = null;

  return {
    trigger(_timeMs: number, value?: number): void {
      const input = value !== undefined ? clamp01(value) : 1;
      current = exciteSmoothedValue(current, input, config);
    },

    sample(timeMs: number): number {
      if (lastSampleTime !== null) {
        const dt = (timeMs - lastSampleTime) / 1000;
        if (dt > 0) {
          current = decaySmoothedValue(current, dt, config);
          lastSampleTime = timeMs;
        }
        // dt <= 0 (backwards or same time): skip decay and do not update
        // lastSampleTime, so forward progress resumes correctly afterward.
      } else {
        lastSampleTime = timeMs;
      }
      return clamp01(current);
    },
  };
};
