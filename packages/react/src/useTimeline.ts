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

export type TimelineLatestEvent<TEvent extends TimelineEvent = TimelineEvent> =
  | TimelineCueEvent<TEvent>
  | TimelinePlaybackEvent
  | TimelineProjectEvent<TEvent>;

export type UseTimelineOptions<TEvent extends TimelineEvent = TimelineEvent> = {
  project: TimelineProject<TEvent>;
  transport?: PlaybackTransport;
  lookaheadMs?: number;
  loop?: boolean;
  missedCuePolicy?: MissedStepPolicy;
  eventValidator?: TimelineEventValidator<TEvent>;
  onCue?: (event: TimelineCueEvent<TEvent>) => void;
  onPlaybackChange?: (event: TimelinePlaybackEvent) => void;
  onPosition?: (position: ChannelPosition) => void;
  onProjectError?: (error: Error) => void;
  onTransportError?: (error: unknown) => void;
};

export type UseTimelineState<TEvent extends TimelineEvent = TimelineEvent> = {
  /** The underlying TimelineEngine instance, or null when construction fails. */
  engine: TimelineEngine<TEvent> | null;
  playbackState: PlaybackState;
  positionRef: MutableRefObject<ChannelPosition>;
  latestEvent: TimelineLatestEvent<TEvent> | null;
  projectError: Error | null;
  transportError: unknown | null;
  pendingOperation: TimelinePendingOperation | null;
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
 * Owns a TimelineEngine lifecycle, hot-swaps TimelineProject updates, and
 * exposes Playback v2 controls for sparse cue scheduling.
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
  const [latestEvent, setLatestEvent] = useState<TimelineLatestEvent<TEvent> | null>(null);
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
      setLatestEvent(event);
      onCueRef.current?.(event);
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
