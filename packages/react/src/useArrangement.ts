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

export type ArrangementLatestEvent =
  | StepEvent
  | ArrangementPlaybackEvent
  | ArrangementProjectEvent
  | ArrangementSectionEvent;

export type UseArrangementOptions = {
  arrangement: ArrangementProject;
  transport?: PlaybackTransport;
  lookaheadMs?: number;
  loop?: boolean;
  missedStepPolicy?: MissedStepPolicy;
  onStep?: (event: StepEvent) => void;
  onSection?: (event: ArrangementSectionEvent) => void;
  onPlaybackChange?: (event: ArrangementPlaybackEvent) => void;
  onPosition?: (position: ChannelPosition) => void;
  onProjectError?: (error: Error) => void;
  onTransportError?: (error: unknown) => void;
};

export type UseArrangementState = {
  /** The underlying ArrangementEngine instance, or null when construction fails. */
  engine: ArrangementEngine | null;
  currentSection: ArrangementSection | null;
  playbackState: PlaybackState;
  positionRef: MutableRefObject<ChannelPosition>;
  latestEvent: ArrangementLatestEvent | null;
  projectError: Error | null;
  transportError: unknown | null;
  pendingOperation: ArrangementPendingOperation | null;
  isBusy: boolean;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
  seekPositionMs: (positionMs: number) => Promise<void>;
  seekBeat: (beat: number) => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
  setTransportLoop: (loop: boolean) => Promise<void>;
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
 * Owns an ArrangementEngine lifecycle, hot-swaps ArrangementProject updates,
 * and exposes Playback v2 controls. The returned `engine` satisfies the
 * `ChannelSource` contract, so it can be passed directly to
 * `useAnimatedChannels`.
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
  const [latestEvent, setLatestEvent] = useState<ArrangementLatestEvent | null>(null);
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
      setLatestEvent(event);
      onStepRef.current?.(event);
    });
    const offSection = newEngine.on("section", (event) => {
      setCurrentSection(event.section);
      setLatestEvent(event);
      onSectionRef.current?.(event);
    });
    const offPlayback = newEngine.on("playback", (event) => {
      setPlaybackState(event.snapshot.state);
      setCurrentSection(event.snapshot.section);
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
      setCurrentSection(newEngine.getCurrentSection());
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
    seekBeat,
    setPlaybackRate,
    setTransportLoop,
    setLoop,
  };
}
