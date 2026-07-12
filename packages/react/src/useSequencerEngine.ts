import {
  browserClock,
  createClockTransport,
  SequencerEngine,
  type ChannelPosition,
  type MissedStepPolicy,
  type PlaybackState,
  type PlaybackTransport,
  type ProjectEvent,
  type SequenceProject,
  type SequencerPlaybackEvent,
  type StepEvent,
} from "@vixeq/core";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

/**
 * Name of a `useSequencerEngine` command while it sits at the head of the
 * internal command queue (queued or actively running). Reflected on
 * {@link SequencerEngineHookState.pendingOperation}.
 */
export type SequencerEnginePendingOperation =
  | "play"
  | "pause"
  | "stop"
  | "toggle"
  | "seekPositionMs"
  | "seekStep"
  | "setPlaybackRate"
  | "setTransportLoop";

/**
 * Union of the engine events that can be surfaced through
 * {@link SequencerEngineHookState.latestEventRef}: a scheduled `StepEvent`, a
 * `SequencerPlaybackEvent` (play/pause/stop/seek/error transitions), or a
 * `ProjectEvent` emitted after a `setProject` hot-swap.
 */
export type SequencerEngineLatestEvent =
  | StepEvent
  | SequencerPlaybackEvent
  | ProjectEvent;

/** Options accepted by {@link useSequencerEngine}. */
export type SequencerEngineHookOptions = {
  /**
   * The step-sequencer project to play. Passing a new reference hot-swaps
   * the running engine's project via `setProject` instead of recreating the
   * engine, unless construction previously failed for this exact object.
   */
  project: SequenceProject;
  /**
   * Playback transport to drive the engine's clock. Defaults to
   * `createClockTransport(browserClock)`, which the hook creates and
   * disposes itself. Pass an explicit transport to share a clock across
   * multiple engines or hooks.
   */
  transport?: PlaybackTransport;
  /** Forwarded to `SequencerEngine`'s constructor; bounds the scheduling lookahead window in milliseconds. */
  lookaheadMs?: number;
  /** Forwarded to `SequencerEngine`'s constructor; controls whether skipped intermediate steps are emitted or coalesced. */
  missedStepPolicy?: MissedStepPolicy;
  /** Called with every `StepEvent` the engine schedules. */
  onStep?: (event: StepEvent) => void;
  /** Called on every playback state transition (play/pause/stop/seek/error). */
  onPlaybackChange?: (event: SequencerPlaybackEvent) => void;
  /**
   * Called with the engine's current `ChannelPosition` on every rAF tick
   * while playing, and after seeks/project swaps. Use this (or
   * {@link SequencerEngineHookState.positionRef}) instead of `latestEventRef`
   * for continuous progress UI, since position updates do not trigger a
   * React re-render on their own.
   */
  onPosition?: (position: ChannelPosition) => void;
  /**
   * Called when constructing the engine, or hot-swapping its project, throws.
   * The error is also captured on
   * {@link SequencerEngineHookState.projectError} without throwing during
   * render.
   */
  onProjectError?: (error: Error) => void;
  /**
   * Called when a queued transport command (play/pause/stop/seek/...)
   * rejects. The error is also captured on
   * {@link SequencerEngineHookState.transportError}; the rejected promise
   * returned by the corresponding command method still rejects as well.
   */
  onTransportError?: (error: unknown) => void;
};

/** State and controls returned by {@link useSequencerEngine}. */
export type SequencerEngineHookState = {
  /** The underlying SequencerEngine instance, or null when construction fails. */
  engine: SequencerEngine | null;
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
   * Ref holding the most recent step, playback, or project event emitted by
   * the engine. Updated on every step (not just once per frame), without
   * forcing a re-render — read it inside imperative code, not during
   * render. Consumers that need to repaint on every step (e.g. a moving
   * playhead) should track `onStep` into their own state instead, since a
   * ref mutation does not itself schedule a render.
   */
  latestEventRef: MutableRefObject<SequencerEngineLatestEvent | null>;
  /**
   * Error from the most recent engine construction or `setProject` call, or
   * `null` if it succeeded. Construction/hot-swap failures are captured here
   * rather than thrown during render.
   */
  projectError: Error | null;
  /** Error from the most recently rejected transport command, or `null`. */
  transportError: unknown | null;
  /** The command currently at the head of the queue (running or waiting), or `null` if idle. */
  pendingOperation: SequencerEnginePendingOperation | null;
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
  /** Seeks to a specific step index. */
  seekStep: (stepIndex: number) => Promise<void>;
  /** Sets the transport's playback rate (must be a finite number greater than 0). */
  setPlaybackRate: (rate: number) => Promise<void>;
  /** Sets whether the transport loops at its known duration. */
  setTransportLoop: (loop: boolean) => Promise<void>;
};

/** State and controls returned by {@link useSequencePlayer}, identical to {@link SequencerEngineHookState}. */
export type SequencePlayerHookState = SequencerEngineHookState;

class MissingEngineError extends Error {
  constructor() {
    super("SequencerEngine is not available.");
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
 * Owns a `SequencerEngine` lifecycle: constructs it from a `SequenceProject`,
 * hot-swaps the project when a new reference is passed, and disposes the
 * engine (and any transport the hook created) on unmount. Commands
 * (`play`/`pause`/`stop`/seeks/rate/loop changes) are serialized through an
 * internal queue, so calling several in a row runs them one after another in
 * order rather than racing.
 *
 * Construction and project-hot-swap failures are captured on
 * `projectError`/`onProjectError` instead of throwing during render.
 * Continuous playback position is exposed both as `positionRef` (read
 * without a re-render) and via the `onPosition` callback, since it changes
 * every animation frame while playing.
 *
 * @param options - Project, transport, and callback configuration. See {@link SequencerEngineHookOptions}.
 * @returns Playback state, position, latest event, errors, and transport controls. See {@link SequencerEngineHookState}.
 *
 * @example
 * ```tsx
 * function StepSequencer({ project }: { project: SequenceProject }) {
 *   const { playbackState, isBusy, play, pause, positionRef } = useSequencerEngine({
 *     project,
 *     onProjectError: (error) => console.error("Invalid project", error),
 *   });
 *
 *   return (
 *     <button disabled={isBusy} onClick={() => (playbackState === "playing" ? pause() : play())}>
 *       {playbackState === "playing" ? "Pause" : "Play"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useSequencerEngine(options: SequencerEngineHookOptions): SequencerEngineHookState {
  const { project, transport, lookaheadMs, missedStepPolicy } = options;
  const onStepRef = useLatestRef(options.onStep);
  const onPlaybackChangeRef = useLatestRef(options.onPlaybackChange);
  const onPositionRef = useLatestRef(options.onPosition);
  const onProjectErrorRef = useLatestRef(options.onProjectError);
  const onTransportErrorRef = useLatestRef(options.onTransportError);

  const engineRef = useRef<SequencerEngine | null>(null);
  const transportRef = useRef<PlaybackTransport | null>(null);
  const positionRef = useRef<ChannelPosition>({ positionMs: 0, beat: 0 });
  const mountedRef = useRef(false);
  const pendingQueueRef = useRef<SequencerEnginePendingOperation[]>([]);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const rafRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);
  const failedConstructionProjectRef = useRef<SequenceProject | null>(null);

  const [engine, setEngine] = useState<SequencerEngine | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("stopped");
  const latestEventRef = useRef<SequencerEngineLatestEvent | null>(null);
  const [projectError, setProjectError] = useState<Error | null>(null);
  const [transportError, setTransportError] = useState<unknown | null>(null);
  const [pendingOperation, setPendingOperation] = useState<SequencerEnginePendingOperation | null>(null);
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
    operation: SequencerEnginePendingOperation,
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
    operation: SequencerEnginePendingOperation,
    command: (engine: SequencerEngine) => Promise<void>,
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
    let newEngine: SequencerEngine;
    const activeTransport = transport ?? createClockTransport(browserClock);
    const ownsTransport = transport === undefined;
    try {
      newEngine = new SequencerEngine(project, {
        transport: activeTransport,
        lookaheadMs,
        missedStepPolicy,
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

    const offStep = newEngine.on("step", (event) => {
      latestEventRef.current = event;
      onStepRef.current?.(event);
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
      offStep();
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
  }, [constructionAttempt, lookaheadMs, missedStepPolicy, onPlaybackChangeRef, onPositionRef, onProjectErrorRef, onStepRef, onTransportErrorRef, transport]);

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

  const seekStep = useCallback((stepIndex: number) => (
    enqueueEngineCommand("seekStep", (currentEngine) => currentEngine.seekStep(stepIndex))
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
    seekStep,
    setPlaybackRate,
    setTransportLoop,
  };
}

/**
 * Alias for {@link useSequencerEngine} with a playback-focused name. Accepts
 * the same options and returns the same state shape; use whichever name
 * reads better at the call site.
 *
 * @param options - See {@link SequencerEngineHookOptions}.
 * @returns See {@link SequencePlayerHookState}.
 *
 * @example
 * ```tsx
 * function Player({ project }: { project: SequenceProject }) {
 *   const { play, pause, playbackState } = useSequencePlayer({ project });
 *   return <button onClick={() => play()}>{playbackState}</button>;
 * }
 * ```
 */
export function useSequencePlayer(options: SequencerEngineHookOptions): SequencePlayerHookState {
  return useSequencerEngine(options);
}
