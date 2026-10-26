/**
 * Tuning for {@link exciteSmoothedValue} and {@link decaySmoothedValue}.
 *
 * `impact` scales how far an input jumps the value, `lift` how much it adds on
 * top, and `decayRate` (per second) how fast the value falls back to `rest`
 * (default 0). With `holdWhenInputZero`, an input of 0 leaves the value as it
 * is instead of exciting it.
 */
export type SmoothingConfig = {
  decayRate: number;
  impact: number;
  lift: number;
  rest?: number;
  holdWhenInputZero?: boolean;
};

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/**
 * Excites a smoothed value with a new input, such as a step value: the value
 * jumps to at least `input * impact` and is lifted by `input * lift`. With
 * `rest` set, the value moves away from `rest` in either direction.
 *
 * @param current - The current smoothed value (clamped to 0–1).
 * @param input - The new input (clamped to 0–1).
 * @param config - The smoothing parameters.
 * @returns The new value, clamped to 0–1.
 */
export const exciteSmoothedValue = (current: number, input: number, config: SmoothingConfig): number => {
  const normalizedCurrent = clamp01(current);
  const normalizedInput = clamp01(input);

  if (config.holdWhenInputZero && normalizedInput === 0) {
    return normalizedCurrent;
  }

  const rest = config.rest;
  if (rest !== undefined) {
    const normalizedRest = clamp01(rest);
    const currentDelta = normalizedCurrent - normalizedRest;
    const inputDelta = normalizedInput - normalizedRest;
    const impactDelta = inputDelta * config.impact;
    const liftedDelta = currentDelta + inputDelta * config.lift;
    const nextDelta = Math.abs(impactDelta) > Math.abs(liftedDelta) ? impactDelta : liftedDelta;
    return clamp01(normalizedRest + nextDelta);
  }

  const hit = normalizedInput * config.impact;
  return clamp01(Math.max(normalizedCurrent, hit) + normalizedInput * config.lift);
};

/**
 * Decays a smoothed value toward `config.rest` (default 0) exponentially at
 * `config.decayRate` per second. Call it every frame with the elapsed time.
 *
 * @param current - The current smoothed value (clamped to 0–1).
 * @param deltaSeconds - Seconds since the last call; negative counts as 0.
 * @param config - The smoothing parameters.
 * @returns The decayed value, clamped to 0–1.
 */
export const decaySmoothedValue = (current: number, deltaSeconds: number, config: SmoothingConfig): number => {
  const normalizedCurrent = clamp01(current);
  const multiplier = Math.exp(-Math.max(0, deltaSeconds) * Math.max(0, config.decayRate));
  const rest = clamp01(config.rest ?? 0);
  return clamp01(rest + (normalizedCurrent - rest) * multiplier);
};
