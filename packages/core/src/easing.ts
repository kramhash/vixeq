export type EasingFunction = (t: number) => number;

const clampT = (t: number): number => {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, t));
};

/** No easing: passes `t` through unchanged (clamped to [0, 1]). */
export const linear: EasingFunction = (t) => clampT(t);

/** Quadratic ease-in: slow start, accelerating toward t = 1 (t²). */
export const easeInQuad: EasingFunction = (t) => {
  const c = clampT(t);
  return c * c;
};

/** Quadratic ease-out: fast start, decelerating toward t = 1. */
export const easeOutQuad: EasingFunction = (t) => {
  const c = clampT(t);
  return c * (2 - c);
};

/** Quadratic ease-in-out: accelerate then decelerate, symmetric about t = 0.5. */
export const easeInOutQuad: EasingFunction = (t) => {
  const c = clampT(t);
  return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c;
};

/** Cubic ease-in: slow start, stronger acceleration than {@link easeInQuad} (t³). */
export const easeInCubic: EasingFunction = (t) => {
  const c = clampT(t);
  return c * c * c;
};

/** Cubic ease-out: fast start, stronger deceleration than {@link easeOutQuad}. */
export const easeOutCubic: EasingFunction = (t) => {
  const c = clampT(t) - 1;
  return c * c * c + 1;
};

/** Cubic ease-in-out: accelerate then decelerate, symmetric about t = 0.5, steeper than {@link easeInOutQuad}. */
export const easeInOutCubic: EasingFunction = (t) => {
  const c = clampT(t);
  return c < 0.5 ? 4 * c * c * c : (c - 1) * (2 * c - 2) * (2 * c - 2) + 1;
};

/**
 * Linearly interpolate between `from` and `to` by `t`.
 *
 * @param from - Value at t = 0.
 * @param to   - Value at t = 1.
 * @param t    - Interpolation phase; values outside [0, 1] are clamped.
 * @returns The interpolated value.
 */
export const lerp = (from: number, to: number, t: number): number => {
  const c = clampT(t);
  return from + (to - from) * c;
};
