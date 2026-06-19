export type SmoothingConfig = {
  decayRate: number;
  impact: number;
  lift: number;
  rest?: number;
  holdWhenInputZero?: boolean;
};

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

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

export const decaySmoothedValue = (current: number, deltaSeconds: number, config: SmoothingConfig): number => {
  const normalizedCurrent = clamp01(current);
  const multiplier = Math.exp(-Math.max(0, deltaSeconds) * Math.max(0, config.decayRate));
  const rest = clamp01(config.rest ?? 0);
  return clamp01(rest + (normalizedCurrent - rest) * multiplier);
};
