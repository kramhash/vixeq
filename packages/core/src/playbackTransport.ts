import type { PlaybackClock } from "./types";

export type PlaybackState = "stopped" | "playing" | "paused" | "ended";

export type PlaybackSnapshot = {
  state: PlaybackState;
  positionMs: number;
  durationMs: number | null;
  playbackRate: number;
  loop: boolean;
  buffering: boolean;
};

export type PlaybackOperation =
  | "play"
  | "pause"
  | "stop"
  | "seek"
  | "ratechange"
  | "transport-loop";

export type PlaybackTransportEvent =
  | { type: "play"; snapshot: PlaybackSnapshot }
  | { type: "pause"; snapshot: PlaybackSnapshot }
  | { type: "stop"; snapshot: PlaybackSnapshot }
  | { type: "seek"; previousPositionMs: number; snapshot: PlaybackSnapshot }
  | { type: "ratechange"; previousPlaybackRate: number; snapshot: PlaybackSnapshot }
  | { type: "loopchange"; previousLoop: boolean; snapshot: PlaybackSnapshot }
  | { type: "loop"; iteration: number; snapshot: PlaybackSnapshot }
  | { type: "durationchange"; previousDurationMs: number | null; snapshot: PlaybackSnapshot }
  | { type: "bufferingchange"; previousBuffering: boolean; snapshot: PlaybackSnapshot }
  | { type: "ended"; snapshot: PlaybackSnapshot }
  | { type: "error"; error: unknown; snapshot: PlaybackSnapshot }
  | { type: "dispose"; snapshot: PlaybackSnapshot };

export type ListenerErrorContext = {
  source: "transport" | "engine";
  eventName: string;
};

export type PlaybackTransportBaseOptions = {
  onListenerError?: (error: unknown, context: ListenerErrorContext) => void;
};

export type ClockTransportOptions = PlaybackTransportBaseOptions & {
  durationMs?: number;
  loop?: boolean;
};

export type PlaybackErrorCode = "TRANSPORT_DISPOSED" | "DURATION_UNAVAILABLE";

export class PlaybackError extends Error {
  readonly code: PlaybackErrorCode;

  constructor(code: PlaybackErrorCode, message?: string) {
    super(message ?? defaultPlaybackErrorMessage(code));
    this.name = "PlaybackError";
    this.code = code;
  }
}

export type PlaybackTransport = {
  getSnapshot(): PlaybackSnapshot;
  getPlaybackState(): PlaybackState;
  getPositionMs(): number;
  getDurationMs(): number | null;
  getPlaybackRate(): number;
  getLoop(): boolean;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekMs(positionMs: number): Promise<void>;
  setPlaybackRate(rate: number): Promise<void>;
  setLoop(loop: boolean): Promise<void>;
  subscribe(listener: (event: PlaybackTransportEvent) => void): () => void;
  dispose(): void;
};

const defaultPlaybackErrorMessage = (code: PlaybackErrorCode): string => {
  if (code === "TRANSPORT_DISPOSED") {
    return "Playback transport has been disposed.";
  }
  return "Playback duration is unavailable.";
};

const assertFinitePositive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero.`);
  }
};

const assertBoolean = (value: boolean, name: string): void => {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
};

const reportListenerError = (
  error: unknown,
  eventName: string,
  onListenerError?: PlaybackTransportBaseOptions["onListenerError"],
): void => {
  if (onListenerError) {
    try {
      onListenerError(error, { source: "transport", eventName });
      return;
    } catch (reportingError) {
      error = reportingError;
    }
  }

  const reportError = (globalThis as typeof globalThis & {
    reportError?: (error: unknown) => void;
  }).reportError;
  if (reportError) {
    reportError.call(globalThis, error);
    return;
  }

  if (typeof console !== "undefined") {
    console.error(error);
  }
};

export function createClockTransport(
  clock: PlaybackClock,
  options: ClockTransportOptions = {},
): PlaybackTransport {
  const durationMs = options.durationMs ?? null;
  if (durationMs !== null) {
    assertFinitePositive(durationMs, "durationMs");
  }
  assertBoolean(options.loop ?? false, "loop");
  if (options.loop && durationMs === null) {
    throw new PlaybackError("DURATION_UNAVAILABLE");
  }

  let state: PlaybackState = "stopped";
  let positionMs = 0;
  let playbackRate = 1;
  let loop = options.loop ?? false;
  let anchorClockMs = clock.now();
  let boundaryTimerId: unknown;
  let loopIteration = 0;
  let disposed = false;
  let operationQueue = Promise.resolve();
  const listeners = new Set<(event: PlaybackTransportEvent) => void>();

  const assertActive = (): void => {
    if (disposed) {
      throw new PlaybackError("TRANSPORT_DISPOSED");
    }
  };

  const clearBoundaryTimer = (): void => {
    if (boundaryTimerId === undefined) return;
    clock.clearTimer(boundaryTimerId);
    boundaryTimerId = undefined;
  };

  const readPlayingPosition = (): number => {
    const elapsedClockMs = Math.max(0, clock.now() - anchorClockMs);
    const rawPositionMs = positionMs + elapsedClockMs * playbackRate;
    if (durationMs === null) return rawPositionMs;
    if (loop) return rawPositionMs % durationMs;
    return Math.min(durationMs, rawPositionMs);
  };

  const createSnapshot = (): PlaybackSnapshot => ({
    state,
    positionMs: state === "playing" ? readPlayingPosition() : positionMs,
    durationMs,
    playbackRate,
    loop,
    buffering: false,
  });

  const emit = (event: PlaybackTransportEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        reportListenerError(error, event.type, options.onListenerError);
      }
    }
  };

  const scheduleBoundary = (): void => {
    clearBoundaryTimer();
    if (state !== "playing" || durationMs === null) return;

    const remainingMs = Math.max(0, durationMs - positionMs);
    boundaryTimerId = clock.setTimer(handleBoundary, remainingMs / playbackRate);
  };

  const settlePlayingPosition = (): void => {
    if (state !== "playing") return;

    const now = clock.now();
    const elapsedClockMs = Math.max(0, now - anchorClockMs);
    const rawPositionMs = positionMs + elapsedClockMs * playbackRate;
    anchorClockMs = now;

    if (durationMs === null) {
      positionMs = rawPositionMs;
      return;
    }

    if (loop) {
      const completedLoops = Math.floor(rawPositionMs / durationMs);
      positionMs = rawPositionMs % durationMs;
      for (let index = 0; index < completedLoops; index += 1) {
        loopIteration += 1;
        emit({ type: "loop", iteration: loopIteration, snapshot: createSnapshot() });
      }
      return;
    }

    if (rawPositionMs >= durationMs) {
      positionMs = durationMs;
      state = "ended";
      clearBoundaryTimer();
      emit({ type: "ended", snapshot: createSnapshot() });
      return;
    }

    positionMs = rawPositionMs;
  };

  function handleBoundary(): void {
    boundaryTimerId = undefined;
    if (disposed || state !== "playing") return;
    settlePlayingPosition();
    scheduleBoundary();
  }

  const enqueue = (operation: () => void | Promise<void>): Promise<void> => {
    const result = operationQueue.then(async () => {
      assertActive();
      await operation();
    });
    operationQueue = result.catch(() => undefined);
    return result;
  };

  const transport: PlaybackTransport = {
    getSnapshot(): PlaybackSnapshot {
      assertActive();
      return createSnapshot();
    },

    getPlaybackState(): PlaybackState {
      assertActive();
      return state;
    },

    getPositionMs(): number {
      assertActive();
      return state === "playing" ? readPlayingPosition() : positionMs;
    },

    getDurationMs(): number | null {
      assertActive();
      return durationMs;
    },

    getPlaybackRate(): number {
      assertActive();
      return playbackRate;
    },

    getLoop(): boolean {
      assertActive();
      return loop;
    },

    play(): Promise<void> {
      assertActive();
      return enqueue(() => {
        if (state === "playing") return;
        if (state === "ended") {
          positionMs = 0;
          loopIteration = 0;
        }
        state = "playing";
        anchorClockMs = clock.now();
        emit({ type: "play", snapshot: createSnapshot() });
        scheduleBoundary();
      });
    },

    pause(): Promise<void> {
      assertActive();
      return enqueue(() => {
        if (state !== "playing") return;
        settlePlayingPosition();
        if (state !== "playing") return;
        state = "paused";
        clearBoundaryTimer();
        emit({ type: "pause", snapshot: createSnapshot() });
      });
    },

    stop(): Promise<void> {
      assertActive();
      return enqueue(() => {
        if (state === "stopped" && positionMs === 0) return;
        if (state === "playing") settlePlayingPosition();
        state = "stopped";
        positionMs = 0;
        loopIteration = 0;
        anchorClockMs = clock.now();
        clearBoundaryTimer();
        emit({ type: "stop", snapshot: createSnapshot() });
      });
    },

    seekMs(nextPositionMs: number): Promise<void> {
      assertActive();
      if (!Number.isFinite(nextPositionMs) || nextPositionMs < 0) {
        throw new RangeError("positionMs must be a finite, non-negative number.");
      }
      if (durationMs !== null && nextPositionMs > durationMs) {
        throw new RangeError("positionMs must not exceed the playback duration.");
      }
      return enqueue(() => {
        const previousPositionMs = state === "playing" ? readPlayingPosition() : positionMs;
        const previousState = state;
        positionMs = nextPositionMs;
        anchorClockMs = clock.now();

        if (previousState === "stopped") {
          state = nextPositionMs === 0 ? "stopped" : "paused";
        } else if (previousState === "ended") {
          state = durationMs !== null && nextPositionMs === durationMs ? "ended" : "paused";
        }

        clearBoundaryTimer();
        emit({ type: "seek", previousPositionMs, snapshot: createSnapshot() });
        scheduleBoundary();
      });
    },

    setPlaybackRate(nextPlaybackRate: number): Promise<void> {
      assertActive();
      assertFinitePositive(nextPlaybackRate, "playbackRate");
      return enqueue(() => {
        if (nextPlaybackRate === playbackRate) return;
        if (state === "playing") settlePlayingPosition();
        const previousPlaybackRate = playbackRate;
        playbackRate = nextPlaybackRate;
        anchorClockMs = clock.now();
        emit({ type: "ratechange", previousPlaybackRate, snapshot: createSnapshot() });
        scheduleBoundary();
      });
    },

    setLoop(nextLoop: boolean): Promise<void> {
      assertActive();
      assertBoolean(nextLoop, "loop");
      return enqueue(() => {
        if (nextLoop === loop) return;
        if (nextLoop && durationMs === null) {
          throw new PlaybackError("DURATION_UNAVAILABLE");
        }
        if (state === "playing") settlePlayingPosition();
        const previousLoop = loop;
        loop = nextLoop;
        emit({ type: "loopchange", previousLoop, snapshot: createSnapshot() });
        scheduleBoundary();
      });
    },

    subscribe(listener: (event: PlaybackTransportEvent) => void): () => void {
      assertActive();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      if (disposed) return;
      if (state === "playing") {
        positionMs = readPlayingPosition();
      }
      clearBoundaryTimer();
      const finalSnapshot = { ...createSnapshot(), positionMs };
      disposed = true;
      emit({ type: "dispose", snapshot: finalSnapshot });
      listeners.clear();
    },
  };

  return transport;
}
