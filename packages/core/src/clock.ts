import type { PlaybackClock } from "./types";

const getHighResolutionNow = (): number => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
};

export const browserClock: PlaybackClock = {
  now: getHighResolutionNow,
  setTimer(callback, delayMs) {
    return setTimeout(callback, Math.max(0, delayMs));
  },
  clearTimer(timerId) {
    clearTimeout(timerId as ReturnType<typeof setTimeout>);
  },
};
