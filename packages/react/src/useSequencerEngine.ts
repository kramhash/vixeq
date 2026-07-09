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

export type SequencerEnginePendingOperation =
  | "play"
  | "pause"
  | "stop"
  | "toggle"
  | "seekPositionMs"
  | "seekStep"
  | "setPlaybackRate"
  | "setTransportLoop";

export type SequencerEngineLatestEvent =
  | StepEvent
  | SequencerPlaybackEvent
  | ProjectEvent;

export type SequencerEngineHookOptions = {
  project: SequenceProject;
  transport?: PlaybackTransport;
  lookaheadMs?: number;
  missedStepPolicy?: MissedStepPolicy;
  onStep?: (event: StepEvent) => void;
  onPlaybackChange?: (event: SequencerPlaybackEvent) => void;
  onPosition?: (position: ChannelPosition) => void;
  onProjectError?: (error: Error) => void;
  onTransportError?: (error: unknown) => void;
};

export type SequencerEngineHookState = {
  /** The underlying SequencerEngine instance, or null when construction fails. */
  engine: SequencerEngine | null;
  playbackState: PlaybackState;
  positionRef: MutableRefObject<ChannelPosition>;
  latestEvent: SequencerEngineLatestEvent | null;
  projectError: Error | null;
  transportError: unknown | null;
  pendingOperation: SequencerEnginePendingOperation | null;
  isBusy: boolean;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
  seekPositionMs: (positionMs: number) => Promise<void>;
  seekStep: (stepIndex: number) => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
  setTransportLoop: (loop: boolean) => Promise<void>;
};

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
  const [latestEvent, setLatestEvent] = useState<SequencerEngineLatestEvent | null>(null);
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
      setLatestEvent(event);
      onStepRef.current?.(event);
    });
    const offPlayback = newEngine.on("playback", (event) => {
      setPlaybackState(event.snapshot.state);
      setLatestEvent(event);
      positionRef.current = newEngine.getPosition();
      onPositionRef.current?.(positionRef.current);
      if (event.type === "error") {
        setTransportError(event.error);
        onTransportErrorRef.current?.(event.error);
      }
      onPlaybackChangeRef.current?.(event);
    });
    const offProject = newEngine.on("project", (event) => {
      setLatestEvent(event);
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
    latestEvent,
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

export function useSequencePlayer(options: SequencerEngineHookOptions): SequencePlayerHookState {
  return useSequencerEngine(options);
}
