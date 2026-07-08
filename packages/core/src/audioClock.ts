import {
  createClockTransport,
  PlaybackError,
  type PlaybackSnapshot,
  type PlaybackState,
  type PlaybackTransport,
  type PlaybackTransportBaseOptions,
  type PlaybackTransportEvent,
} from "./playbackTransport";
import type { PlaybackClock } from "./types";

export type MediaElementTransportOptions = PlaybackTransportBaseOptions & {
  audioContext?: AudioContext;
};

export type AudioBufferTransportOptions = PlaybackTransportBaseOptions & {
  destination?: AudioNode;
  loop?: boolean;
};

const MEDIA_EVENTS = [
  "play",
  "pause",
  "seeking",
  "seeked",
  "ratechange",
  "durationchange",
  "waiting",
  "playing",
  "timeupdate",
  "ended",
  "error",
] as const;

const mediaDurationMs = (media: HTMLMediaElement): number | null =>
  Number.isFinite(media.duration) && media.duration > 0 ? media.duration * 1000 : null;

const mediaPositionMs = (media: HTMLMediaElement): number =>
  Math.max(0, media.currentTime * 1000);

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
  } else if (typeof console !== "undefined") {
    console.error(error);
  }
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

/** Creates a PlaybackTransport backed by a borrowed HTMLMediaElement. */
export function createMediaElementTransport(
  media: HTMLMediaElement,
  options: MediaElementTransportOptions = {},
): PlaybackTransport {
  let state: PlaybackState = media.ended
    ? "ended"
    : media.paused
      ? mediaPositionMs(media) === 0
        ? "stopped"
        : "paused"
      : "playing";
  let durationMs = mediaDurationMs(media);
  let playbackRate = media.playbackRate;
  let loop = media.loop;
  let buffering = false;
  let disposed = false;
  let operationQueue = Promise.resolve();
  let seekPreviousPositionMs = mediaPositionMs(media);
  let lastObservedPositionMs = seekPreviousPositionMs;
  let loopIteration = 0;
  let suppressPlay = false;
  let suppressPause = false;
  let suppressSeekTargetMs: number | null = null;
  let suppressRateTarget: number | null = null;
  let suppressError = false;
  let suppressNextError = false;
  const listeners = new Set<(event: PlaybackTransportEvent) => void>();

  const assertActive = (): void => {
    if (disposed) throw new PlaybackError("TRANSPORT_DISPOSED");
  };

  const createSnapshot = (): PlaybackSnapshot => ({
    state,
    positionMs: mediaPositionMs(media),
    durationMs,
    playbackRate,
    loop,
    buffering,
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

  const updateStateAfterSeek = (): void => {
    const positionMs = mediaPositionMs(media);
    if (state === "stopped") {
      state = positionMs === 0 ? "stopped" : "paused";
    } else if (state === "ended") {
      state = durationMs !== null && positionMs === durationMs ? "ended" : "paused";
    }
  };

  const onPlay = (): void => {
    state = "playing";
    buffering = false;
    lastObservedPositionMs = mediaPositionMs(media);
    if (suppressPlay) {
      suppressPlay = false;
      return;
    }
    emit({ type: "play", snapshot: createSnapshot() });
  };

  const onPause = (): void => {
    if (!media.ended) state = "paused";
    lastObservedPositionMs = mediaPositionMs(media);
    if (suppressPause) {
      suppressPause = false;
      return;
    }
    emit({ type: "pause", snapshot: createSnapshot() });
  };

  const onSeeking = (): void => {
    seekPreviousPositionMs = lastObservedPositionMs;
  };

  const onSeeked = (): void => {
    updateStateAfterSeek();
    const positionMs = mediaPositionMs(media);
    lastObservedPositionMs = positionMs;
    if (suppressSeekTargetMs !== null && Math.abs(positionMs - suppressSeekTargetMs) < 0.5) {
      suppressSeekTargetMs = null;
      return;
    }
    emit({
      type: "seek",
      previousPositionMs: seekPreviousPositionMs,
      snapshot: createSnapshot(),
    });
  };

  const onRateChange = (): void => {
    const previousPlaybackRate = playbackRate;
    playbackRate = media.playbackRate;
    if (suppressRateTarget !== null && playbackRate === suppressRateTarget) {
      suppressRateTarget = null;
      return;
    }
    if (previousPlaybackRate !== playbackRate) {
      emit({ type: "ratechange", previousPlaybackRate, snapshot: createSnapshot() });
    }
  };

  const onDurationChange = (): void => {
    const nextDurationMs = mediaDurationMs(media);
    if (nextDurationMs === durationMs) return;
    const previousDurationMs = durationMs;
    durationMs = nextDurationMs;
    emit({ type: "durationchange", previousDurationMs, snapshot: createSnapshot() });
  };

  const setBuffering = (nextBuffering: boolean): void => {
    if (buffering === nextBuffering || state !== "playing") return;
    const previousBuffering = buffering;
    buffering = nextBuffering;
    emit({ type: "bufferingchange", previousBuffering, snapshot: createSnapshot() });
  };

  const onTimeUpdate = (): void => {
    const positionMs = mediaPositionMs(media);
    const nextLoop = media.loop;
    if (nextLoop !== loop) {
      const previousLoop = loop;
      loop = nextLoop;
      emit({ type: "loopchange", previousLoop, snapshot: createSnapshot() });
    }
    if (state === "playing" && loop && positionMs + 0.5 < lastObservedPositionMs) {
      loopIteration += 1;
      emit({ type: "loop", iteration: loopIteration, snapshot: createSnapshot() });
    }
    lastObservedPositionMs = positionMs;
  };

  const handlers: Record<(typeof MEDIA_EVENTS)[number], EventListener> = {
    play: onPlay,
    pause: onPause,
    seeking: onSeeking,
    seeked: onSeeked,
    ratechange: onRateChange,
    durationchange: onDurationChange,
    waiting: () => setBuffering(true),
    playing: () => setBuffering(false),
    timeupdate: onTimeUpdate,
    ended: () => {
      state = "ended";
      buffering = false;
      lastObservedPositionMs = mediaPositionMs(media);
      emit({ type: "ended", snapshot: createSnapshot() });
    },
    error: () => {
      if (suppressError || suppressNextError) {
        suppressNextError = false;
        return;
      }
      emit({ type: "error", error: media.error, snapshot: createSnapshot() });
    },
  };

  for (const eventName of MEDIA_EVENTS) {
    media.addEventListener(eventName, handlers[eventName]);
  }

  const enqueue = (operation: () => void | Promise<void>): Promise<void> => {
    const result = operationQueue.then(async () => {
      assertActive();
      await operation();
    });
    operationQueue = result.catch(() => undefined);
    return result;
  };

  return {
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
      return mediaPositionMs(media);
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
      return enqueue(async () => {
        if (state === "playing") return;
        if (state === "ended") {
          suppressSeekTargetMs = 0;
          media.currentTime = 0;
          loopIteration = 0;
        }
        suppressPlay = true;
        suppressError = true;
        try {
          await options.audioContext?.resume();
          await media.play();
        } catch (error) {
          suppressPlay = false;
          suppressNextError = media.error !== null;
          state = media.ended
            ? "ended"
            : media.paused
              ? mediaPositionMs(media) === 0
                ? "stopped"
                : "paused"
              : "playing";
          throw error;
        } finally {
          suppressError = false;
        }
        state = "playing";
        buffering = false;
        lastObservedPositionMs = mediaPositionMs(media);
        emit({ type: "play", snapshot: createSnapshot() });
      });
    },
    pause(): Promise<void> {
      assertActive();
      return enqueue(() => {
        if (state !== "playing") return;
        suppressPause = true;
        media.pause();
        state = "paused";
        buffering = false;
        lastObservedPositionMs = mediaPositionMs(media);
        emit({ type: "pause", snapshot: createSnapshot() });
      });
    },
    stop(): Promise<void> {
      assertActive();
      return enqueue(() => {
        if (state === "stopped" && mediaPositionMs(media) === 0) return;
        if (!media.paused) {
          suppressPause = true;
          media.pause();
        }
        if (mediaPositionMs(media) !== 0) {
          suppressSeekTargetMs = 0;
          media.currentTime = 0;
        }
        state = "stopped";
        buffering = false;
        loopIteration = 0;
        lastObservedPositionMs = 0;
        emit({ type: "stop", snapshot: createSnapshot() });
      });
    },
    seekMs(positionMs: number): Promise<void> {
      assertActive();
      if (!Number.isFinite(positionMs) || positionMs < 0) {
        throw new RangeError("positionMs must be a finite, non-negative number.");
      }
      if (durationMs !== null && positionMs > durationMs) {
        throw new RangeError("positionMs must not exceed the playback duration.");
      }
      return enqueue(() => {
        const previousPositionMs = mediaPositionMs(media);
        suppressSeekTargetMs = positionMs;
        media.currentTime = positionMs / 1000;
        updateStateAfterSeek();
        lastObservedPositionMs = positionMs;
        emit({ type: "seek", previousPositionMs, snapshot: createSnapshot() });
      });
    },
    setPlaybackRate(rate: number): Promise<void> {
      assertActive();
      assertFinitePositive(rate, "playbackRate");
      return enqueue(() => {
        if (rate === playbackRate) return;
        const previousPlaybackRate = playbackRate;
        suppressRateTarget = rate;
        media.playbackRate = rate;
        playbackRate = rate;
        emit({ type: "ratechange", previousPlaybackRate, snapshot: createSnapshot() });
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
        const previousLoop = loop;
        media.loop = nextLoop;
        loop = nextLoop;
        emit({ type: "loopchange", previousLoop, snapshot: createSnapshot() });
      });
    },
    subscribe(listener: (event: PlaybackTransportEvent) => void): () => void {
      assertActive();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(): void {
      if (disposed) return;
      const snapshot = createSnapshot();
      disposed = true;
      emit({ type: "dispose", snapshot });
      listeners.clear();
      for (const eventName of MEDIA_EVENTS) {
        media.removeEventListener(eventName, handlers[eventName]);
      }
    },
  };
}

/** Creates a PlaybackTransport backed by one-shot AudioBufferSourceNodes. */
export function createAudioBufferTransport(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  options: AudioBufferTransportOptions = {},
): PlaybackTransport {
  const durationMs = buffer.duration * 1000;
  assertFinitePositive(durationMs, "buffer.duration");
  assertBoolean(options.loop ?? false, "loop");

  const clock: PlaybackClock = {
    now: () => audioContext.currentTime * 1000,
    setTimer: (callback, delayMs) => setTimeout(callback, Math.max(0, delayMs)),
    clearTimer: (timerId) => clearTimeout(timerId as ReturnType<typeof setTimeout>),
  };
  const base = createClockTransport(clock, {
    durationMs,
    loop: options.loop,
    onListenerError: options.onListenerError,
  });
  const destination = options.destination ?? audioContext.destination;
  let source: AudioBufferSourceNode | null = null;
  let disposed = false;
  let operationQueue = Promise.resolve();

  const stopSource = (): void => {
    const previousSource = source;
    source = null;
    if (!previousSource) return;
    previousSource.onended = null;
    try {
      previousSource.stop();
    } catch {
      // AudioBufferSourceNode is one-shot and may already have ended.
    }
    previousSource.disconnect();
  };

  const startSource = (positionMs: number): void => {
    stopSource();
    const nextSource = audioContext.createBufferSource();
    nextSource.buffer = buffer;
    nextSource.loop = base.getLoop();
    nextSource.playbackRate.value = base.getPlaybackRate();
    nextSource.connect(destination);
    nextSource.onended = () => {
      if (source === nextSource && !nextSource.loop) source = null;
    };
    source = nextSource;
    try {
      nextSource.start(0, positionMs / 1000);
    } catch (error) {
      source = null;
      nextSource.onended = null;
      nextSource.disconnect();
      throw error;
    }
  };

  const assertActive = (): void => {
    if (disposed) throw new PlaybackError("TRANSPORT_DISPOSED");
  };

  const enqueue = (operation: () => void | Promise<void>): Promise<void> => {
    const result = operationQueue.then(async () => {
      assertActive();
      await operation();
    });
    operationQueue = result.catch(() => undefined);
    return result;
  };

  return {
    getSnapshot: () => base.getSnapshot(),
    getPlaybackState: () => base.getPlaybackState(),
    getPositionMs: () => base.getPositionMs(),
    getDurationMs: () => base.getDurationMs(),
    getPlaybackRate: () => base.getPlaybackRate(),
    getLoop: () => base.getLoop(),
    play(): Promise<void> {
      assertActive();
      return enqueue(async () => {
        if (base.getPlaybackState() === "playing") return;
        await audioContext.resume();
        const positionMs = base.getPlaybackState() === "ended" ? 0 : base.getPositionMs();
        startSource(positionMs);
        try {
          await base.play();
        } catch (error) {
          stopSource();
          throw error;
        }
      });
    },
    pause(): Promise<void> {
      assertActive();
      return enqueue(async () => {
        if (base.getPlaybackState() !== "playing") return;
        stopSource();
        await base.pause();
      });
    },
    stop(): Promise<void> {
      assertActive();
      return enqueue(async () => {
        if (base.getPlaybackState() === "stopped" && base.getPositionMs() === 0) return;
        stopSource();
        await base.stop();
      });
    },
    seekMs(positionMs: number): Promise<void> {
      assertActive();
      if (!Number.isFinite(positionMs) || positionMs < 0 || positionMs > durationMs) {
        throw new RangeError("positionMs must be finite, non-negative, and within the buffer duration.");
      }
      return enqueue(async () => {
        const playing = base.getPlaybackState() === "playing";
        if (playing) startSource(positionMs);
        await base.seekMs(positionMs);
      });
    },
    setPlaybackRate(rate: number): Promise<void> {
      assertActive();
      assertFinitePositive(rate, "playbackRate");
      return enqueue(async () => {
        if (rate === base.getPlaybackRate()) return;
        if (source) source.playbackRate.value = rate;
        await base.setPlaybackRate(rate);
      });
    },
    setLoop(nextLoop: boolean): Promise<void> {
      assertActive();
      assertBoolean(nextLoop, "loop");
      return enqueue(async () => {
        if (nextLoop === base.getLoop()) return;
        if (source) source.loop = nextLoop;
        await base.setLoop(nextLoop);
      });
    },
    subscribe: (listener) => base.subscribe(listener),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      base.dispose();
      stopSource();
    },
  };
}
