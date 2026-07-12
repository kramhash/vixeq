import {
  ArrangementEngine,
  browserClock,
  createClockTransport,
  type ArrangementPlaybackEvent,
  type ArrangementProject,
  type ArrangementProjectEvent,
  type ArrangementSection,
  type ArrangementSectionEvent,
  type ChannelPosition,
  type MissedStepPolicy,
  type PlaybackState,
  type PlaybackTransport,
  type StepEvent,
} from "@vixeq/core";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

/**
 * Name of a `useArrangement` command while it sits at the head of the
 * internal command queue (queued or actively running). Reflected on
 * {@link UseArrangementState.pendingOperation}.
 */
export type ArrangementPendingOperation =
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
 * {@link UseArrangementState.latestEventRef}: a scheduled `StepEvent`, an
 * `ArrangementPlaybackEvent` (play/pause/stop/seek/error transitions), an
 * `ArrangementProjectEvent` emitted after a `setArrangement` hot-swap, or an
 * `ArrangementSectionEvent` emitted whenever the active section changes.
 */
export type ArrangementLatestEvent =
  | StepEvent
  | ArrangementPlaybackEvent
  | ArrangementProjectEvent
  | ArrangementSectionEvent;

/** Options accepted by {@link useArrangement}. */
export type UseArrangementOptions = {
  /**
   * The arrangement project to play. Passing a new reference hot-swaps the
   * running engine's arrangement via `setArrangement` instead of recreating
   * the engine, unless construction previously failed for this exact
   * object.
   */
  arrangement: ArrangementProject;
  /**
   * Playback transport to drive the engine's clock. Defaults to
   * `createClockTransport(browserClock)`, which the hook creates and
   * disposes itself. Pass an explicit transport to share a clock across
   * multiple engines or hooks.
   */
  transport?: PlaybackTransport;
  /** Forwarded to `ArrangementEngine`'s constructor; bounds the scheduling lookahead window in milliseconds. */
  lookaheadMs?: number;
  /**
   * Engine-local loop flag: when `true`, playback repeats from beat 0 once
   * it reaches the end of the arrangement. Distinct from
   * {@link UseArrangementState.setTransportLoop}, which loops the transport
   * itself. Defaults to `false`; can also be changed at runtime via
   * {@link UseArrangementState.setLoop}.
   */
  loop?: boolean;
  /** Forwarded to `ArrangementEngine`'s constructor; controls whether skipped intermediate steps are emitted or coalesced. */
  missedStepPolicy?: MissedStepPolicy;
  /** Called with every `StepEvent` the engine schedules. */
  onStep?: (event: StepEvent) => void;
  /** Called whenever the active arrangement section changes, including transitions to/from a gap (`section: null`). */
  onSection?: (event: ArrangementSectionEvent) => void;
  /** Called on every playback state transition (play/pause/stop/seek/error). */
  onPlaybackChange?: (event: ArrangementPlaybackEvent) => void;
  /**
   * Called with the engine's current `ChannelPosition` on every rAF tick
   * while playing, and after seeks/arrangement swaps. Use this (or
   * {@link UseArrangementState.positionRef}) instead of `latestEventRef` for
   * continuous progress UI, since position updates do not trigger a React
   * re-render on their own.
   */
  onPosition?: (position: ChannelPosition) => void;
  /**
   * Called when constructing the engine, or hot-swapping its arrangement,
   * throws. The error is also captured on
   * {@link UseArrangementState.projectError} without throwing during
   * render.
   */
  onProjectError?: (error: Error) => void;
  /**
   * Called when a queued transport command (play/pause/stop/seek/...)
   * rejects. The error is also captured on
   * {@link UseArrangementState.transportError}; the rejected promise
   * returned by the corresponding command method still rejects as well.
   */
  onTransportError?: (error: unknown) => void;
};

/** State and controls returned by {@link useArrangement}. */
export type UseArrangementState = {
  /** The underlying ArrangementEngine instance, or null when construction fails. */
  engine: ArrangementEngine | null;
  /** The currently active section, or `null` if playback is in a gap between sections. */
  currentSection: ArrangementSection | null;
  /** Current playback state, updated on every playback transition. */
  playbackState: PlaybackState;
  /**
   * Ref holding the engine's current `ChannelPosition`. Updated on every rAF
   * tick while playing and after seeks/arrangement swaps, without forcing a
   * re-render — read it inside animation callbacks instead of depending on
   * hook state for continuous progress.
   */
  positionRef: MutableRefObject<ChannelPosition>;
  /**
   * Ref holding the most recent step, playback, project, or section event
   * emitted by the engine. Updated on every step (not just once per frame),
   * without forcing a re-render — read it inside imperative code, not
   * during render. Consumers that need to repaint on every step should
   * track `onStep`/`onSection` into their own state instead, since a ref
   * mutation does not itself schedule a render.
   */
  latestEventRef: MutableRefObject<ArrangementLatestEvent | null>;
  /**
   * Error from the most recent engine construction or `setArrangement`
   * call, or `null` if it succeeded. Construction/hot-swap failures are
   * captured here rather than thrown during render.
   */
  projectError: Error | null;
  /** Error from the most recently rejected transport command, or `null`. */
  transportError: unknown | null;
  /** The command currently at the head of the queue (running or waiting), or `null` if idle. */
  pendingOperation: ArrangementPendingOperation | null;
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
  /** Sets the engine-local loop flag (repeat from beat 0 at arrangement end), independent of transport looping. */
  setLoop: (loop: boolean) => Promise<void>;
};

class MissingEngineError extends Error {
  constructor() {
    super("ArrangementEngine is not available.");
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
 * Owns an `ArrangementEngine` lifecycle: constructs it from an
 * `ArrangementProject` (patterns played across ordered, beat-timed
 * sections), hot-swaps the arrangement when a new reference is passed, and
 * disposes the engine (and any transport the hook created) on unmount.
 * Commands are serialized through an internal queue, so calling several in a
 * row runs them one after another in order rather than racing. The returned
 * `engine` satisfies the `ChannelSource` contract, so it can be passed
 * directly to `useAnimatedChannels`.
 *
 * Construction and arrangement-hot-swap failures are captured on
 * `projectError`/`onProjectError` instead of throwing during render.
 * Continuous playback position is exposed both as `positionRef` (read
 * without a re-render) and via the `onPosition` callback, since it changes
 * every animation frame while playing.
 *
 * @param options - Arrangement, transport, and callback configuration. See {@link UseArrangementOptions}.
 * @returns Playback state, current section, position, latest event, errors, and transport controls. See {@link UseArrangementState}.
 *
 * @example
 * ```tsx
 * function ArrangementPlayer({ arrangement }: { arrangement: ArrangementProject }) {
 *   const { currentSection, playbackState, play, pause } = useArrangement({
 *     arrangement,
 *     loop: true,
 *     onSection: (event) => console.log("entered section", event.section?.id),
 *   });
 *
 *   return (
 *     <div>
 *       <p>Section: {currentSection?.id ?? "(gap)"}</p>
 *       <button onClick={() => (playbackState === "playing" ? pause() : play())}>
 *         {playbackState === "playing" ? "Pause" : "Play"}
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useArrangement(options: UseArrangementOptions): UseArrangementState {
  const { arrangement, transport, lookaheadMs, loop, missedStepPolicy } = options;
  const onStepRef = useLatestRef(options.onStep);
  const onSectionRef = useLatestRef(options.onSection);
  const onPlaybackChangeRef = useLatestRef(options.onPlaybackChange);
  const onPositionRef = useLatestRef(options.onPosition);
  const onProjectErrorRef = useLatestRef(options.onProjectError);
  const onTransportErrorRef = useLatestRef(options.onTransportError);

  const engineRef = useRef<ArrangementEngine | null>(null);
  const transportRef = useRef<PlaybackTransport | null>(null);
  const positionRef = useRef<ChannelPosition>({ positionMs: 0, beat: 0 });
  const mountedRef = useRef(false);
  const pendingQueueRef = useRef<ArrangementPendingOperation[]>([]);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const rafRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);
  const failedConstructionArrangementRef = useRef<ArrangementProject | null>(null);

  const [engine, setEngine] = useState<ArrangementEngine | null>(null);
  const [currentSection, setCurrentSection] = useState<ArrangementSection | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("stopped");
  const latestEventRef = useRef<ArrangementLatestEvent | null>(null);
  const [projectError, setProjectError] = useState<Error | null>(null);
  const [transportError, setTransportError] = useState<unknown | null>(null);
  const [pendingOperation, setPendingOperation] = useState<ArrangementPendingOperation | null>(null);
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
    operation: ArrangementPendingOperation,
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
    operation: ArrangementPendingOperation,
    command: (engine: ArrangementEngine) => Promise<void>,
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
    let newEngine: ArrangementEngine;
    const activeTransport = transport ?? createClockTransport(browserClock);
    const ownsTransport = transport === undefined;
    try {
      newEngine = new ArrangementEngine(arrangement, {
        transport: activeTransport,
        lookaheadMs,
        loop,
        missedStepPolicy,
      });
    } catch (cause) {
      const nextError = toError(cause);
      failedConstructionArrangementRef.current = arrangement;
      if (ownsTransport) {
        activeTransport.dispose();
      }
      engineRef.current = null;
      transportRef.current = null;
      setEngine(null);
      setCurrentSection(null);
      setProjectError(nextError);
      onProjectErrorRef.current?.(nextError);
      return;
    }

    engineRef.current = newEngine;
    transportRef.current = activeTransport;
    failedConstructionArrangementRef.current = null;
    setEngine(newEngine);
    setCurrentSection(newEngine.getCurrentSection());
    setPlaybackState(newEngine.getPlaybackState());
    positionRef.current = newEngine.getPosition();
    setProjectError(null);

    const offStep = newEngine.on("step", (event) => {
      latestEventRef.current = event;
      onStepRef.current?.(event);
    });
    const offSection = newEngine.on("section", (event) => {
      setCurrentSection(event.section);
      latestEventRef.current = event;
      onSectionRef.current?.(event);
    });
    const offPlayback = newEngine.on("playback", (event) => {
      setPlaybackState(event.snapshot.state);
      setCurrentSection(event.snapshot.section);
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
      setCurrentSection(newEngine.getCurrentSection());
      latestEventRef.current = event;
      positionRef.current = newEngine.getPosition();
      onPositionRef.current?.(positionRef.current);
    });

    return () => {
      if (rafRef.current !== null) {
        cancelScheduledFrame(rafRef.current);
        rafRef.current = null;
      }
      offStep();
      offSection();
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
  }, [constructionAttempt, lookaheadMs, missedStepPolicy, onPlaybackChangeRef, onPositionRef, onProjectErrorRef, onSectionRef, onStepRef, onTransportErrorRef, transport]);

  useEffect(() => {
    const currentEngine = engineRef.current;
    if (!currentEngine) {
      if (failedConstructionArrangementRef.current !== arrangement) {
        setConstructionAttempt((attempt) => attempt + 1);
      }
      return;
    }
    try {
      currentEngine.setArrangement(arrangement);
      setProjectError(null);
      setCurrentSection(currentEngine.getCurrentSection());
      syncPosition();
    } catch (cause) {
      const nextError = toError(cause);
      setProjectError(nextError);
      onProjectErrorRef.current?.(nextError);
    }
  }, [arrangement, onProjectErrorRef, syncPosition]);

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

  const setTransportLoop = useCallback((loop: boolean) => (
    enqueueEngineCommand("setTransportLoop", () => {
      const currentTransport = transportRef.current;
      if (!currentTransport) {
        throw new MissingEngineError();
      }
      return currentTransport.setLoop(loop);
    })
  ), [enqueueEngineCommand]);

  const setLoop = useCallback((nextLoop: boolean) => (
    enqueueEngineCommand("setLoop", async (currentEngine) => {
      currentEngine.setLoop(nextLoop);
    })
  ), [enqueueEngineCommand]);

  return {
    engine,
    currentSection,
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
