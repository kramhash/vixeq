import type { PlaybackClock, Unsubscribe } from "./types";

/**
 * Where playback stands. `stopped` is always at position 0; `paused` keeps its
 * position for a later resume; `ended` keeps the finite end position, and
 * `play()` from it starts again at 0. A buffering transport stays `playing`.
 */
export type PlaybackState = "stopped" | "playing" | "paused" | "ended";

/**
 * A transport's state at one moment. `durationMs` is `null` when unknown or
 * unbounded; `buffering` is `true` while a `playing` transport is waiting for
 * media.
 */
export type PlaybackSnapshot = {
  state: PlaybackState;
  positionMs: number;
  durationMs: number | null;
  playbackRate: number;
  loop: boolean;
  buffering: boolean;
};

/**
 * Emitted to {@link PlaybackTransport.subscribe} listeners, each with the
 * snapshot after the change. New event types may be added in a minor release;
 * handle unknown ones with a default branch.
 */
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

/**
 * Where a listener error came from: the event name, and whether a transport
 * or an engine was dispatching it.
 */
export type ListenerErrorContext = {
  source: "transport" | "engine";
  eventName: string;
};

/**
 * Options shared by the built-in transports.
 *
 * `onListenerError` receives errors thrown by `subscribe` listeners. If it is
 * omitted or throws, the error goes to `globalThis.reportError` when
 * available, otherwise `console.error`.
 */
export type PlaybackTransportBaseOptions = {
  onListenerError?: (error: unknown, context: ListenerErrorContext) => void;
};

/**
 * Options for {@link createClockTransport}. `durationMs` (finite, greater than
 * 0) makes playback end there; `loop: true` requires it.
 */
export type ClockTransportOptions = PlaybackTransportBaseOptions & {
  durationMs?: number;
  loop?: boolean;
};

/**
 * {@link PlaybackError} codes: `TRANSPORT_DISPOSED` for a command on a disposed
 * transport, `DURATION_UNAVAILABLE` for looping without a known duration.
 */
export type PlaybackErrorCode = "TRANSPORT_DISPOSED" | "DURATION_UNAVAILABLE";

/**
 * An error from a transport or engine command that is not an invalid
 * argument (those throw `TypeError` or `RangeError`). Check `code` rather than
 * `instanceof`: with two copies of `@vixeq/core` installed, `instanceof`
 * fails, while `name === "PlaybackError"` and `code` still match.
 */
export class PlaybackError extends Error {
  /** What went wrong; stable across releases. */
  readonly code: PlaybackErrorCode;

  /**
   * @param code - The error code.
   * @param message - Overrides the default message for `code`.
   */
  constructor(code: PlaybackErrorCode, message?: string) {
    super(message ?? defaultPlaybackErrorMessage(code));
    this.name = "PlaybackError";
    this.code = code;
  }
}

/**
 * The clock an engine follows: an audio file, a media element, or a plain
 * clock. Its position is authoritative; engines map it to beats and steps.
 *
 * Commands return promises; invalid arguments throw synchronously. After
 * `dispose()`, every getter, command, and subscription fails with
 * {@link PlaybackError} (`TRANSPORT_DISPOSED`). Implement it to drive engines
 * from another source. In 1.x it gains only optional members.
 */
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
  seekPositionMs(positionMs: number): Promise<void>;
  setPlaybackRate(rate: number): Promise<void>;
  setLoop(loop: boolean): Promise<void>;
  subscribe(listener: (event: PlaybackTransportEvent) => void): Unsubscribe;
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

/**
 * Creates a {@link PlaybackTransport} driven by `clock` alone, with no media.
 * Without `durationMs` it plays on indefinitely.
 *
 * @param clock - The time source, usually {@link browserClock}.
 * @param options - Duration, initial loop, and listener-error handling.
 * @returns A stopped transport at position 0.
 * @throws RangeError if `durationMs` is not finite and greater than 0.
 * @throws PlaybackError (`DURATION_UNAVAILABLE`) if `loop` is set without `durationMs`.
 */
export function createClockTransport(
  clock: PlaybackClock,
  options: ClockTransportOptions = {},
): PlaybackTransport {
  return createLatencyClockTransport(clock, options, () => 0);
}

/**
 * {@link createClockTransport} whose reported position trails the clock by
 * `latencyMs()` (read on every query, in clock milliseconds). Playback holds at
 * its start position for the latency after `play` and `seek`, and `loop` and
 * `ended` fire when the delayed position reaches the boundary. `pause` settles
 * at the undelayed position, where the audio stopped. While playing, the
 * position never moves backward when the latency grows. Internal to the audio
 * transports; not exported from the package.
 */
export function createLatencyClockTransport(
  clock: PlaybackClock,
  options: ClockTransportOptions,
  latencyMs: () => number,
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
  // Lowest unwrapped position a playing read may return; keeps the position
  // from moving backward when the latency grows.
  let floorPositionMs = 0;
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

  const readUnwrappedPosition = (now: number, latency: number): number => {
    const elapsedClockMs = Math.max(0, now - anchorClockMs - latency);
    return Math.max(floorPositionMs, positionMs + elapsedClockMs * playbackRate);
  };

  const readPlayingPosition = (): number => {
    const rawPositionMs = readUnwrappedPosition(clock.now(), latencyMs());
    floorPositionMs = rawPositionMs;
    if (durationMs === null) return rawPositionMs;
    if (loop) return rawPositionMs % durationMs;
    return Math.min(durationMs, rawPositionMs);
  };

  const anchorAt = (nextPositionMs: number, now: number): void => {
    positionMs = nextPositionMs;
    floorPositionMs = nextPositionMs;
    anchorClockMs = now;
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
    const delayMs = anchorClockMs + latencyMs() + remainingMs / playbackRate - clock.now();
    boundaryTimerId = clock.setTimer(handleBoundary, Math.max(0, delayMs));
  };

  /**
   * Folds the elapsed time into `positionMs`. `delayed` uses the latency-delayed
   * position (boundaries, rate and loop changes); otherwise the undelayed one
   * (pause). A start hold that has not elapsed is kept. The anchor follows the
   * true delayed position, not a floor held after the latency grew, and the
   * floor carries over (less the completed loops) so reads keep holding.
   */
  const settlePlayingPosition = (delayed = true): void => {
    const now = clock.now();
    const latency = delayed ? latencyMs() : 0;
    const elapsedClockMs = Math.max(0, now - anchorClockMs - latency);
    const rawPositionMs = positionMs + elapsedClockMs * playbackRate;
    const floorMs = Math.max(floorPositionMs, rawPositionMs);
    anchorClockMs = Math.max(anchorClockMs, now - latency);

    if (durationMs === null) {
      positionMs = rawPositionMs;
      floorPositionMs = floorMs;
      return;
    }

    if (loop) {
      const completedLoops = Math.floor(rawPositionMs / durationMs);
      positionMs = rawPositionMs % durationMs;
      floorPositionMs = floorMs - completedLoops * durationMs;
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
    floorPositionMs = floorMs;
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
        anchorAt(positionMs, clock.now());
        emit({ type: "play", snapshot: createSnapshot() });
        scheduleBoundary();
      });
    },

    pause(): Promise<void> {
      assertActive();
      return enqueue(() => {
        if (state !== "playing") return;
        settlePlayingPosition(false);
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
        anchorAt(0, clock.now());
        loopIteration = 0;
        clearBoundaryTimer();
        emit({ type: "stop", snapshot: createSnapshot() });
      });
    },

    seekPositionMs(nextPositionMs: number): Promise<void> {
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
        anchorAt(nextPositionMs, clock.now());

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

    subscribe(listener: (event: PlaybackTransportEvent) => void): Unsubscribe {
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
