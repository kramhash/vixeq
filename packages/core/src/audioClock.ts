import type {
  AudioBufferTransportOptions,
  AudioClock,
  AudioClockOptions,
  AudioContextClock,
  MediaElementTransportOptions,
  SequencerTransport,
} from "./types";

type Anchor = {
  mediaMs: number;
  ctxMs: number;
};

/**
 * Creates a SequencerClock that follows an HTMLMediaElement's playback position.
 *
 * When an AudioContext is provided, now() interpolates between media.currentTime
 * samples using the AudioContext's high-resolution monotonic clock, eliminating
 * the jitter caused by media.currentTime's low update rate.
 *
 * The media element is the transport: call play/pause/seek on it to control the
 * sequencer. The AudioContext is a clock source only — you do not need to route
 * audio through it.
 *
 * The AudioContext must be resumed before playback (user-gesture requirement).
 * Call ctx.resume() in the same handler that calls audioEl.play().
 *
 * Call dispose() when done to remove all event listeners added to the media element.
 */
export function createAudioClock(
  media: HTMLMediaElement,
  options: AudioClockOptions = {},
): AudioClock {
  const { audioContext: ctx } = options;

  let anchor: Anchor = {
    mediaMs: media.currentTime * 1000,
    ctxMs: ctx ? ctx.currentTime * 1000 : 0,
  };
  let paused = media.paused;

  const resample = () => {
    anchor = {
      mediaMs: media.currentTime * 1000,
      ctxMs: ctx ? ctx.currentTime * 1000 : 0,
    };
    paused = media.paused;
  };

  media.addEventListener("play", resample);
  media.addEventListener("pause", resample);
  media.addEventListener("seeked", resample);
  media.addEventListener("ratechange", resample);
  media.addEventListener("timeupdate", resample);

  return {
    now(): number {
      if (!ctx || paused) {
        return media.currentTime * 1000;
      }
      const ctxElapsedMs = (ctx.currentTime * 1000 - anchor.ctxMs) * media.playbackRate;
      return anchor.mediaMs + ctxElapsedMs;
    },

    setTimer(callback: () => void, delayMs: number): unknown {
      return setTimeout(callback, Math.max(0, delayMs));
    },

    clearTimer(timerId: unknown): void {
      clearTimeout(timerId as ReturnType<typeof setTimeout>);
    },

    dispose(): void {
      media.removeEventListener("play", resample);
      media.removeEventListener("pause", resample);
      media.removeEventListener("seeked", resample);
      media.removeEventListener("ratechange", resample);
      media.removeEventListener("timeupdate", resample);
    },
  };
}

/**
 * Creates a transport around an HTMLMediaElement and exposes its playback
 * position as a SequencerClock.
 *
 * The media element remains the audio source. This helper only coordinates
 * play/stop/seek and clock sampling so a SequencerEngine can follow it.
 */
export function createMediaElementTransport(
  media: HTMLMediaElement,
  options: MediaElementTransportOptions = {},
): SequencerTransport {
  const { audioContext, stopAtMs = 0 } = options;
  const clock = createAudioClock(media, { audioContext });

  const seek = (timeMs: number) => {
    media.currentTime = Math.max(0, timeMs) / 1000;
  };

  return {
    clock,

    async play(): Promise<void> {
      await audioContext?.resume();
      await media.play();
    },

    stop(): void {
      media.pause();
      seek(stopAtMs);
    },

    pause(): void {
      media.pause();
    },

    seek,

    dispose(): void {
      clock.dispose();
    },
  };
}

/**
 * Creates a transport for an AudioBufferSourceNode playback graph.
 *
 * This is the preferred helper for seamless loops. The source node's loop
 * property handles loop boundaries; a new source node is created only for each
 * playback start or active seek because AudioBufferSourceNode instances are
 * one-shot after start().
 */
export function createAudioBufferTransport(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  options: AudioBufferTransportOptions = {},
): SequencerTransport {
  const { destination = audioContext.destination, loop = false, stopAtMs = 0 } = options;
  let source: AudioBufferSourceNode | null = null;
  let startCtxTime = 0;
  let offsetMs = 0;
  let playing = false;
  let stopping = false;

  const normalizeOffsetMs = (timeMs: number) => {
    const safeMs = Math.max(0, timeMs);
    if (!loop || buffer.duration <= 0) {
      return safeMs;
    }
    const durationMs = buffer.duration * 1000;
    return safeMs % durationMs;
  };

  const disconnectSource = () => {
    if (!source) return;
    stopping = true;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.disconnect();
    source = null;
    stopping = false;
  };

  const startSource = (timeMs: number) => {
    disconnectSource();
    const nextSource = audioContext.createBufferSource();
    const nextOffsetMs = normalizeOffsetMs(timeMs);
    nextSource.buffer = buffer;
    nextSource.loop = loop;
    nextSource.connect(destination);
    nextSource.onended = () => {
      if (!stopping && source === nextSource) {
        source = null;
        playing = false;
      }
    };
    startCtxTime = audioContext.currentTime;
    offsetMs = nextOffsetMs;
    playing = true;
    source = nextSource;
    nextSource.start(0, nextOffsetMs / 1000);
  };

  const clock = {
    now(): number {
      if (!playing) {
        return offsetMs;
      }
      return offsetMs + (audioContext.currentTime - startCtxTime) * 1000;
    },

    setTimer(callback: () => void, delayMs: number): unknown {
      return setTimeout(callback, Math.max(0, delayMs));
    },

    clearTimer(timerId: unknown): void {
      clearTimeout(timerId as ReturnType<typeof setTimeout>);
    },
  };

  return {
    clock,

    async play(): Promise<void> {
      await audioContext.resume();
      startSource(offsetMs);
    },

    stop(): void {
      disconnectSource();
      playing = false;
      offsetMs = normalizeOffsetMs(stopAtMs);
    },

    pause(): void {
      offsetMs = clock.now();
      disconnectSource();
      playing = false;
    },

    seek(timeMs: number): void {
      const nextOffsetMs = normalizeOffsetMs(timeMs);
      offsetMs = nextOffsetMs;
      if (playing) {
        startSource(nextOffsetMs);
      }
    },

    dispose(): void {
      disconnectSource();
      playing = false;
    },
  };
}

/**
 * Creates a SequencerClock driven by an AudioContext's monotonic clock.
 *
 * Designed for use with AudioBufferSourceNode (Web Audio graph) where there is
 * no HTMLMediaElement. Provides sample-accurate, gap-free timing.
 *
 * Usage:
 *   const clock = createAudioContextClock(ctx);
 *   await ctx.resume();        // must be inside a user-gesture handler
 *   clock.start();             // anchor to ctx.currentTime
 *   source.start(0);           // start audio at the same moment
 *   // ... later:
 *   source.stop();
 *   clock.stop();              // now() returns 0 until next start()
 *
 * The AudioContext lifecycle (creation, resume, close) is the caller's responsibility.
 */
export function createAudioContextClock(ctx: AudioContext): AudioContextClock {
  let startTime = 0;
  let playing = false;

  return {
    start(): void {
      startTime = ctx.currentTime;
      playing = true;
    },

    stop(): void {
      playing = false;
    },

    now(): number {
      return playing ? (ctx.currentTime - startTime) * 1000 : 0;
    },

    setTimer(callback: () => void, delayMs: number): unknown {
      return setTimeout(callback, Math.max(0, delayMs));
    },

    clearTimer(timerId: unknown): void {
      clearTimeout(timerId as ReturnType<typeof setTimeout>);
    },
  };
}
