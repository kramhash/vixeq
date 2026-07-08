import {
  SequencerEngine,
  type SequenceProject,
  type PlaybackClock,
  type SequencerTransport,
  type StepEvent,
  type TransportEvent,
} from "@vixeq/core";
import { useCallback, useEffect, useRef, useState } from "react";

type SequencerEngineHookBaseOptions = {
  project: SequenceProject;
  onStep?: (event: StepEvent) => void;
  onTransportChange?: (event: TransportEvent) => void;
  timeDriven?: boolean;
  originMs?: number;
};

export type SequencerEngineHookOptions =
  | (SequencerEngineHookBaseOptions & {
      clock?: PlaybackClock;
      transport?: never;
    })
  | (SequencerEngineHookBaseOptions & {
      clock?: never;
      transport: SequencerTransport;
    });

export type SequencerEngineHookState = {
  /** The underlying SequencerEngine instance, or null while unmounted. */
  engine: SequencerEngine | null;
  currentStep: number;
  isPlaying: boolean;
  isStarting: boolean;
  latestEvent: StepEvent | null;
  transportError: unknown | null;
  play: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
  reset: (stepIndex?: number) => Promise<void>;
};

export type SequencePlayerHookState = SequencerEngineHookState;

const useLatestRef = <TValue>(value: TValue) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

export function useSequencerEngine(options: SequencerEngineHookOptions): SequencerEngineHookState {
  const { project } = options;
  const clock = (options as { clock?: PlaybackClock }).clock;
  const transport = (options as { transport?: SequencerTransport }).transport;
  const activeClock = transport?.clock ?? clock;
  const { timeDriven, originMs } = options;
  const onStepRef = useLatestRef(options.onStep);
  const onTransportChangeRef = useLatestRef(options.onTransportChange);
  const engineRef = useRef<SequencerEngine | null>(null);
  const projectRef = useRef(project);
  const isStartingRef = useRef(false);
  const [engine, setEngine] = useState<SequencerEngine | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [latestEvent, setLatestEvent] = useState<StepEvent | null>(null);
  const [transportError, setTransportError] = useState<unknown | null>(null);

  useEffect(() => {
    if (clock && transport && typeof console !== "undefined") {
      console.warn("[vixeq] useSequencerEngine received both clock and transport. Use one clock source.");
    }
  }, [clock, transport]);

  useEffect(() => {
    const newEngine = new SequencerEngine(projectRef.current, {
      clock: activeClock,
      timeDriven,
      originMs,
    });
    engineRef.current = newEngine;
    setEngine(newEngine);

    const offStep = newEngine.on("step", (event) => {
      setCurrentStep(event.stepIndex);
      setLatestEvent(event);
      onStepRef.current?.(event);
    });
    const offTransport = newEngine.on("transport", (event) => {
      if (event.type === "start") {
        setIsPlaying(true);
      }
      if (event.type === "stop") {
        setIsPlaying(false);
      }
      if (event.type === "reset") {
        setCurrentStep(event.stepIndex);
      }
      if (event.type === "bpm") {
        setCurrentStep(event.stepIndex);
      }
      onTransportChangeRef.current?.(event);
    });

    return () => {
      offStep();
      offTransport();
      newEngine.dispose();
      engineRef.current = null;
      setEngine(null);
    };
  }, [activeClock, originMs, onStepRef, onTransportChangeRef, timeDriven]);

  useEffect(() => {
    const previousProject = projectRef.current;
    projectRef.current = project;

    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    if (previousProject.bpm !== project.bpm) {
      engine.setBpm(project.bpm);
    }
    engine.setProject(project);
  }, [project]);

  const play = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    if (isStartingRef.current) {
      return;
    }

    isStartingRef.current = true;
    setIsStarting(true);
    setTransportError(null);

    try {
      await transport?.play();
      engine.start();
    } catch (error) {
      engine.stop();
      setTransportError(error);
      throw error;
    } finally {
      isStartingRef.current = false;
      setIsStarting(false);
    }
  }, [transport]);

  const stop = useCallback(async () => {
    const engine = engineRef.current;
    engine?.stop();

    try {
      await transport?.stop();
    } catch (error) {
      setTransportError(error);
      throw error;
    }
  }, [transport]);

  const toggle = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    if (engine.isPlaying()) {
      await stop();
      return;
    }

    await play();
  }, [play, stop]);

  const reset = useCallback(async (stepIndex = 0) => {
    const currentProject = projectRef.current;
    const stepCount = Math.max(1, currentProject.stepCount);
    const normalizedStepIndex = ((Math.trunc(stepIndex) % stepCount) + stepCount) % stepCount;
    const stepDurationMs = 60_000 / currentProject.bpm / currentProject.stepsPerBeat;

    try {
      await transport?.seek?.(normalizedStepIndex * stepDurationMs);
    } catch (error) {
      setTransportError(error);
      throw error;
    }

    engineRef.current?.reset(stepIndex);
    setCurrentStep(normalizedStepIndex);
  }, [transport]);

  return {
    engine,
    currentStep,
    isPlaying,
    isStarting,
    latestEvent,
    transportError,
    play,
    stop,
    toggle,
    reset,
  };
}

export function useSequencePlayer(options: SequencerEngineHookOptions): SequencePlayerHookState {
  return useSequencerEngine(options);
}
