import {
  browserClock,
  createClockTransport,
  TimelineEngine,
  type ChannelPosition,
  type MissedStepPolicy,
  type PlaybackState,
  type PlaybackTransport,
  type TimelineCueEvent,
  type TimelineEvent,
  type TimelineEventValidator,
  type TimelinePlaybackEvent,
  type TimelineProject,
  type TimelineProjectEvent,
} from "@vixeq/core";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

/**
 * Name of a `useTimeline` command while it sits at the head of the internal
 * command queue (queued or actively running). Reflected on
 * {@link UseTimelineState.pendingOperation}.
 */
export type TimelinePendingOperation =
  | "play"
  | "pause"
  | "stop"
  | "toggle"
  | "seekPositionMs"
  | "seekBeat"
  | "setPlaybackRate"
  | "setTransportLoop"
  | "setLoop";

/**
 * Union of the engine events that can be surfaced through
 * {@link UseTimelineState.latestEventRef}: a scheduled `TimelineCueEvent`, a
 * `TimelinePlaybackEvent` (play/pause/stop/seek/error transitions), or a
 * `TimelineProjectEvent` emitted after a `setProject` hot-swap.
 */
export type TimelineLatestEvent<TEvent extends TimelineEvent = TimelineEvent> =
  | TimelineCueEvent<TEvent>
  | TimelinePlaybackEvent
  | TimelineProjectEvent<TEvent>;

/** Options accepted by {@link useTimeline}. */
export type UseTimelineOptions<TEvent extends TimelineEvent = TimelineEvent> = {
  /**
   * The sparse-cue timeline project to play. Passing a new reference
   * hot-swaps the running engine's project via `setProject` instead of
   * recreating the engine, unless construction previously failed for this
   * exact object.
   */
  project: TimelineProject<TEvent>;
  /**
   * Playback transport to drive the engine's clock. Defaults to
   * `createClockTransport(browserClock)`, which the hook creates and
   * disposes itself. Pass an explicit transport to share a clock across
   * multiple engines or hooks.
   */
  transport?: PlaybackTransport;
  /** Forwarded to `TimelineEngine`'s constructor; bounds the scheduling lookahead window in milliseconds. */
  lookaheadMs?: number;
  /**
   * Engine-local loop flag: when `true`, playback repeats from beat 0 once
   * it reaches the end of the timeline. Defaults to `false`; can also be
   * changed at runtime via {@link UseTimelineState.setLoop}.
   */
  loop?: boolean;
  /** Forwarded to `TimelineEngine`'s constructor as `missedCuePolicy`; controls whether skipped intermediate cues are emitted or coalesced. */
  missedCuePolicy?: MissedStepPolicy;
  /**
   * Optional domain validator invoked once per event after Core's
   * structural checks; throw inside it to reject a domain-invalid event.
   */
  eventValidator?: TimelineEventValidator<TEvent>;
  /** Called with every `TimelineCueEvent` the engine schedules. */
  onCue?: (event: TimelineCueEvent<TEvent>) => void;
  /** Called on every playback state transition (play/pause/stop/seek/error). */
  onPlaybackChange?: (event: TimelinePlaybackEvent) => void;
  /**
   * Called with the engine's current `ChannelPosition` on every rAF tick
   * while playing, and after seeks/project swaps. Use this (or
   * {@link UseTimelineState.positionRef}) instead of `latestEventRef` for
   * continuous progress UI, since position updates do not trigger a React
   * re-render on their own.
   */
  onPosition?: (position: ChannelPosition) => void;
  /**
   * Called when constructing the engine, or hot-swapping its project, throws.
   * The error is also captured on {@link UseTimelineState.projectError}
   * without throwing during render.
   */
  onProjectError?: (error: Error) => void;
  /**
   * Called when a queued transport command (play/pause/stop/seek/...)
   * rejects. The error is also captured on
   * {@link UseTimelineState.transportError}; the rejected promise returned
   * by the corresponding command method still rejects as well.
   */
  onTransportError?: (error: unknown) => void;
};

/** State and controls returned by {@link useTimeline}. */
export type UseTimelineState<TEvent extends TimelineEvent = TimelineEvent> = {
  /** The underlying TimelineEngine instance, or null when construction fails. */
  engine: TimelineEngine<TEvent> | null;
  /** Current playback state, updated on every playback transition. */
  playbackState: PlaybackState;
  /**
   * Ref holding the engine's current `ChannelPosition`. Updated on every rAF
   * tick while playing and after seeks/project swaps, without forcing a
   * re-render — read it inside animation callbacks instead of depending on
   * hook state for continuous progress.
   */
  positionRef: MutableRefObject<ChannelPosition>;
  /**
   * Ref holding the most recent cue, playback, or project event emitted by
   * the engine. Updated on every cue (not just once per frame), without
   * forcing a re-render — read it inside imperative code, not during
   * render. Consumers that need to repaint on every cue should track
   * `onCue` into their own state instead, since a ref mutation does not
   * itself schedule a render.
   */
  latestEventRef: MutableRefObject<TimelineLatestEvent<TEvent> | null>;
  /**
   * Error from the most recent engine construction or `setProject` call, or
   * `null` if it succeeded. Construction/hot-swap failures are captured here
   * rather than thrown during render.
   */
  projectError: Error | null;
  /** Error from the most recently rejected transport command, or `null`. */
  transportError: unknown | null;
  /** The command currently at the head of the queue (running or waiting), or `null` if idle. */
  pendingOperation: TimelinePendingOperation | null;
  /** `true` while any command is queued or running, i.e. `pendingOperation !== null`. */
  isBusy: boolean;
  /** Starts or resumes playback. */
  play: () => Promise<void>;
  /** Pauses playback, retaining the current position. */
  pause: () => Promise<void>;
  /** Stops playback and resets position to the start. */
  stop: () => Promise<void>;
  /** Plays if paused/stopped, or pauses if currently playing. */
  toggle: () => Promise<void>;
  /** Seeks to an absolute position in milliseconds. */
  seekPositionMs: (positionMs: number) => Promise<void>;
  /** Seeks to a specific beat. */
  seekBeat: (beat: number) => Promise<void>;
  /** Sets the transport's playback rate (must be a finite number greater than 0). */
  setPlaybackRate: (rate: number) => Promise<void>;
  /** Sets whether the transport loops at its known duration. */
  setTransportLoop: (loop: boolean) => Promise<void>;
  /** Sets the engine-local loop flag (repeat from beat 0 at timeline end), independent of transport looping. */
  setLoop: (loop: boolean) => Promise<void>;
};

class MissingEngineError extends Error {
  constructor() {
    super("TimelineEngine is not available.");
    this.name = "MissingEngineError";
  }
}

const toError = (cause: unknown): Error => cause instanceof Error ? cause : new Error(String(cause));

const useLatestRef = <TValue>(value: TValue) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

const scheduleAnimationFrame = (callback: () => void): ReturnType<typeof setTimeout> | number => {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return setTimeout(callback, 16);
};

const cancelScheduledFrame = (frameId: ReturnType<typeof setTimeout> | number): void => {
  if (typeof cancelAnimationFrame === "function" && typeof frameId === "number") {
    cancelAnimationFrame(frameId);
    return;
  }
  clearTimeout(frameId as ReturnType<typeof setTimeout>);
};

/**
 * Owns a `TimelineEngine` lifecycle: constructs it from a
 * `TimelineProject<TEvent>` (sparse, arbitrary cue events at beat
 * positions), hot-swaps the project when a new reference is passed, and
 * disposes the engine (and any transport the hook created) on unmount.
 * Commands are serialized through an internal queue, so calling several in a
 * row runs them one after another in order rather than racing.
 *
 * Construction and project-hot-swap failures are captured on
 * `projectError`/`onProjectError` instead of throwing during render.
 * Continuous playback position is exposed both as `positionRef` (read
 * without a re-render) and via the `onPosition` callback, since it changes
 * every animation frame while playing.
 *
 * @typeParam TEvent - The application-defined cue event type carried by the timeline.
 * @param options - Project, transport, and callback configuration. See {@link UseTimelineOptions}.
 * @returns Playback state, position, latest event, errors, and transport controls. See {@link UseTimelineState}.
 *
 * @example
 * ```tsx
 * function CueTimeline({ project }: { project: TimelineProject<MyCueEvent> }) {
 *   const { playbackState, play, pause } = useTimeline({
 *     project,
 *     onCue: (event) => console.log("cue fired", event.event),
 *   });
 *
 *   return (
 *     <button onClick={() => (playbackState === "playing" ? pause() : play())}>
 *       {playbackState === "playing" ? "Pause" : "Play"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useTimeline<TEvent extends TimelineEvent = TimelineEvent>(
  options: UseTimelineOptions<TEvent>,
): UseTimelineState<TEvent> {
  const { project, transport, lookaheadMs, loop, missedCuePolicy, eventValidator } = options;
  const onCueRef = useLatestRef(options.onCue);
  const onPlaybackChangeRef = useLatestRef(options.onPlaybackChange);
  const onPositionRef = useLatestRef(options.onPosition);
  const onProjectErrorRef = useLatestRef(options.onProjectError);
  const onTransportErrorRef = useLatestRef(options.onTransportError);

  const engineRef = useRef<TimelineEngine<TEvent> | null>(null);
  const transportRef = useRef<PlaybackTransport | null>(null);
  const positionRef = useRef<ChannelPosition>({ positionMs: 0, beat: 0 });
  const mountedRef = useRef(false);
  const pendingQueueRef = useRef<TimelinePendingOperation[]>([]);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const rafRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);
  const failedConstructionProjectRef = useRef<TimelineProject<TEvent> | null>(null);

  const [engine, setEngine] = useState<TimelineEngine<TEvent> | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("stopped");
  const latestEventRef = useRef<TimelineLatestEvent<TEvent> | null>(null);
  const [projectError, setProjectError] = useState<Error | null>(null);
  const [transportError, setTransportError] = useState<unknown | null>(null);
  const [pendingOperation, setPendingOperation] = useState<TimelinePendingOperation | null>(null);
  const [constructionAttempt, setConstructionAttempt] = useState(0);

  const syncPosition = useCallback(() => {
    const currentEngine = engineRef.current;
    if (!currentEngine) return;
    const position = currentEngine.getPosition();
    positionRef.current = position;
    onPositionRef.current?.(position);
  }, [onPositionRef]);

  const refreshPendingOperation = useCallback(() => {
    if (!mountedRef.current) return;
    setPendingOperation(pendingQueueRef.current[0] ?? null);
  }, []);

  const enqueueCommand = useCallback((
    operation: TimelinePendingOperation,
    command: () => Promise<void>,
  ): Promise<void> => {
    pendingQueueRef.current.push(operation);
    refreshPendingOperation();

    const task = commandQueueRef.current.then(async () => {
      try {
        await command();
        if (mountedRef.current) {
          setTransportError(null);
        }
        syncPosition();
      } catch (error) {
        if (mountedRef.current && !(error instanceof MissingEngineError)) {
          setTransportError(error);
          onTransportErrorRef.current?.(error);
        }
        throw error;
      } finally {
        pendingQueueRef.current.shift();
        refreshPendingOperation();
      }
    });

    commandQueueRef.current = task.catch(() => undefined);
    return task;
  }, [onTransportErrorRef, refreshPendingOperation, syncPosition]);

  const enqueueEngineCommand = useCallback((
    operation: TimelinePendingOperation,
    command: (engine: TimelineEngine<TEvent>) => Promise<void>,
  ): Promise<void> => {
    if (!engineRef.current) {
      return Promise.reject(new MissingEngineError());
    }

    return enqueueCommand(operation, () => {
      const currentEngine = engineRef.current;
      if (!currentEngine) {
        throw new MissingEngineError();
      }
      return command(currentEngine);
    });
  }, [enqueueCommand]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let newEngine: TimelineEngine<TEvent>;
    const activeTransport = transport ?? createClockTransport(browserClock);
    const ownsTransport = transport === undefined;
    try {
      newEngine = new TimelineEngine(project, {
        transport: activeTransport,
        lookaheadMs,
        loop,
        missedCuePolicy,
        eventValidator,
      });
    } catch (cause) {
      const nextError = toError(cause);
      failedConstructionProjectRef.current = project;
      if (ownsTransport) {
        activeTransport.dispose();
      }
      engineRef.current = null;
      transportRef.current = null;
      setEngine(null);
      setProjectError(nextError);
      onProjectErrorRef.current?.(nextError);
      return;
    }

    engineRef.current = newEngine;
    transportRef.current = activeTransport;
    failedConstructionProjectRef.current = null;
    setEngine(newEngine);
    setPlaybackState(newEngine.getPlaybackState());
    positionRef.current = newEngine.getPosition();
    setProjectError(null);

    const offCue = newEngine.on("cue", (event) => {
      latestEventRef.current = event;
      onCueRef.current?.(event);
    });
    const offPlayback = newEngine.on("playback", (event) => {
      setPlaybackState(event.snapshot.state);
      latestEventRef.current = event;
      positionRef.current = newEngine.getPosition();
      onPositionRef.current?.(positionRef.current);
      if (event.type === "error") {
        setTransportError(event.error);
        onTransportErrorRef.current?.(event.error);
      }
      onPlaybackChangeRef.current?.(event);
    });
    const offProject = newEngine.on("project", (event) => {
      latestEventRef.current = event;
      positionRef.current = newEngine.getPosition();
      onPositionRef.current?.(positionRef.current);
    });

    return () => {
      if (rafRef.current !== null) {
        cancelScheduledFrame(rafRef.current);
        rafRef.current = null;
      }
      offCue();
      offPlayback();
      offProject();
      newEngine.dispose();
      if (ownsTransport) {
        activeTransport.dispose();
      }
      if (engineRef.current === newEngine) {
        engineRef.current = null;
        transportRef.current = null;
        setEngine(null);
      }
    };
  }, [
    constructionAttempt,
    eventValidator,
    lookaheadMs,
    missedCuePolicy,
    onCueRef,
    onPlaybackChangeRef,
    onPositionRef,
    onProjectErrorRef,
    onTransportErrorRef,
    transport,
  ]);

  useEffect(() => {
    const currentEngine = engineRef.current;
    if (!currentEngine) {
      if (failedConstructionProjectRef.current !== project) {
        setConstructionAttempt((attempt) => attempt + 1);
      }
      return;
    }
    try {
      currentEngine.setProject(project);
      setProjectError(null);
      syncPosition();
    } catch (cause) {
      const nextError = toError(cause);
      setProjectError(nextError);
      onProjectErrorRef.current?.(nextError);
    }
  }, [onProjectErrorRef, project, syncPosition]);

  useEffect(() => {
    const currentEngine = engineRef.current;
    if (!currentEngine) return;
    currentEngine.setLoop(loop ?? false);
  }, [loop]);

  useEffect(() => {
    if (playbackState !== "playing") {
      if (rafRef.current !== null) {
        cancelScheduledFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = () => {
      syncPosition();
      if (engineRef.current?.getPlaybackState() === "playing") {
        rafRef.current = scheduleAnimationFrame(tick);
      }
    };

    rafRef.current = scheduleAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelScheduledFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playbackState, syncPosition]);

  const play = useCallback(() => enqueueEngineCommand("play", (currentEngine) => currentEngine.play()), [enqueueEngineCommand]);

  const pause = useCallback(() => enqueueEngineCommand("pause", (currentEngine) => currentEngine.pause()), [enqueueEngineCommand]);

  const stop = useCallback(() => enqueueEngineCommand("stop", (currentEngine) => currentEngine.stop()), [enqueueEngineCommand]);

  const toggle = useCallback(() => {
    if (!engineRef.current) {
      return Promise.reject(new MissingEngineError());
    }

    return enqueueCommand("toggle", () => {
      const currentEngine = engineRef.current;
      if (!currentEngine) {
        throw new MissingEngineError();
      }
      return currentEngine.getPlaybackState() === "playing"
        ? currentEngine.pause()
        : currentEngine.play();
    });
  }, [enqueueCommand]);

  const seekBeat = useCallback((beat: number) => (
    enqueueEngineCommand("seekBeat", (currentEngine) => currentEngine.seekBeat(beat))
  ), [enqueueEngineCommand]);

  const seekPositionMs = useCallback((positionMs: number) => (
    enqueueEngineCommand("seekPositionMs", (currentEngine) => currentEngine.seekPositionMs(positionMs))
  ), [enqueueEngineCommand]);

  const setPlaybackRate = useCallback((rate: number) => (
    enqueueEngineCommand("setPlaybackRate", () => {
      const currentTransport = transportRef.current;
      if (!currentTransport) {
        throw new MissingEngineError();
      }
      return currentTransport.setPlaybackRate(rate);
    })
  ), [enqueueEngineCommand]);

  const setTransportLoop = useCallback((nextLoop: boolean) => (
    enqueueEngineCommand("setTransportLoop", () => {
      const currentTransport = transportRef.current;
      if (!currentTransport) {
        throw new MissingEngineError();
      }
      return currentTransport.setLoop(nextLoop);
    })
  ), [enqueueEngineCommand]);

  const setLoop = useCallback((nextLoop: boolean) => (
    enqueueEngineCommand("setLoop", async (currentEngine) => {
      currentEngine.setLoop(nextLoop);
    })
  ), [enqueueEngineCommand]);

  return {
    engine,
    playbackState,
    positionRef,
    latestEventRef,
    projectError,
    transportError,
    pendingOperation,
    isBusy: pendingOperation !== null,
    play,
    pause,
    stop,
    toggle,
    seekPositionMs,
    seekBeat,
    setPlaybackRate,
    setTransportLoop,
    setLoop,
  };
}
