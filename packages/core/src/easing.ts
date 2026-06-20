export type EasingFunction = (t: number) => number;

const clampT = (t: number): number => {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, t));
};

export const linear: EasingFunction = (t) => clampT(t);

export const easeInQuad: EasingFunction = (t) => {
  const c = clampT(t);
  return c * c;
};

export const easeOutQuad: EasingFunction = (t) => {
  const c = clampT(t);
  return c * (2 - c);
};

export const easeInOutQuad: EasingFunction = (t) => {
  const c = clampT(t);
  return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c;
};

export const easeInCubic: EasingFunction = (t) => {
  const c = clampT(t);
  return c * c * c;
};

export const easeOutCubic: EasingFunction = (t) => {
  const c = clampT(t) - 1;
  return c * c * c + 1;
};

export const easeInOutCubic: EasingFunction = (t) => {
  const c = clampT(t);
  return c < 0.5 ? 4 * c * c * c : (c - 1) * (2 * c - 2) * (2 * c - 2) + 1;
};

export const lerp = (from: number, to: number, t: number): number => {
  const c = clampT(t);
  return from + (to - from) * c;
};
