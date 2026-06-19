import { SequencerEngine, type SequenceProject, type StepEvent, type TransportEvent } from "@viseq/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type SequencerEngineHookOptions = {
  project: SequenceProject;
  onStep?: (event: StepEvent) => void;
  onTransportChange?: (event: TransportEvent) => void;
};

export type SequencerEngineHookState = {
  currentStep: number;
  isPlaying: boolean;
  latestEvent: StepEvent | null;
  play: () => void;
  stop: () => void;
  toggle: () => void;
  reset: (stepIndex?: number) => void;
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
  const onStepRef = useLatestRef(options.onStep);
  const onTransportChangeRef = useLatestRef(options.onTransportChange);
  const engineRef = useRef<SequencerEngine | null>(null);
  const projectRef = useRef(project);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [latestEvent, setLatestEvent] = useState<StepEvent | null>(null);

  useEffect(() => {
    const engine = new SequencerEngine(projectRef.current);
    engineRef.current = engine;

    const offStep = engine.on("step", (event) => {
      setCurrentStep(event.stepIndex);
      setLatestEvent(event);
      onStepRef.current?.(event);
    });
    const offTransport = engine.on("transport", (event) => {
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
      engine.dispose();
      engineRef.current = null;
    };
  }, [onStepRef, onTransportChangeRef]);

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

  const play = useCallback(() => {
    engineRef.current?.start();
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    if (engine.isPlaying()) {
      engine.stop();
      return;
    }

    engine.start();
  }, []);

  const reset = useCallback((stepIndex = 0) => {
    engineRef.current?.reset(stepIndex);
    setCurrentStep(stepIndex);
  }, []);

  return {
    currentStep,
    isPlaying,
    latestEvent,
    play,
    stop,
    toggle,
    reset,
  };
}

export function useSequencePlayer(options: SequencerEngineHookOptions): SequencePlayerHookState {
  return useSequencerEngine(options);
}
