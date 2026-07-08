import {
  ArrangementEngine,
  type ArrangementProject,
  type ArrangementSection,
  type ArrangementSectionEvent,
  type PlaybackClock,
  type StepEvent,
} from "@vixeq/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type UseArrangementOptions = {
  arrangement: ArrangementProject;
  clock?: PlaybackClock;
  /** Absolute ms that corresponds to beat 0. Omit to anchor on first start(). */
  originMs?: number;
  loop?: boolean;
  onStep?: (event: StepEvent) => void;
  onSection?: (event: ArrangementSectionEvent) => void;
  onError?: (error: Error) => void;
};

export type UseArrangementState = {
  /** The underlying ArrangementEngine instance, or null while unmounted. */
  engine: ArrangementEngine | null;
  currentSection: ArrangementSection | null;
  isPlaying: boolean;
  latestEvent: StepEvent | null;
  error: Error | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  reset: () => void;
  seek: (beat: number) => void;
};

const useLatestRef = <TValue>(value: TValue) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

/**
 * Mirrors useSequencerEngine's lifecycle (create on mount, dispose on
 * unmount, hot-swap the arrangement on prop change) for ArrangementEngine.
 * The returned `engine` satisfies the `ChannelSource` contract, so it can
 * be passed directly to `useAnimatedChannels`.
 */
export function useArrangement(options: UseArrangementOptions): UseArrangementState {
  const { arrangement, clock, originMs, loop } = options;
  const onStepRef = useLatestRef(options.onStep);
  const onSectionRef = useLatestRef(options.onSection);
  const onErrorRef = useLatestRef(options.onError);
  const engineRef = useRef<ArrangementEngine | null>(null);
  const arrangementRef = useRef(arrangement);
  const [engine, setEngine] = useState<ArrangementEngine | null>(null);
  const [currentSection, setCurrentSection] = useState<ArrangementSection | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [latestEvent, setLatestEvent] = useState<StepEvent | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let newEngine: ArrangementEngine;
    try {
      newEngine = new ArrangementEngine(arrangementRef.current, { clock, originMs, loop });
      setError(null);
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error(String(cause));
      setError(nextError);
      onErrorRef.current?.(nextError);
      return;
    }
    engineRef.current = newEngine;
    setEngine(newEngine);
    setCurrentSection(newEngine.getCurrentSection());

    const offStep = newEngine.on("step", (event) => {
      setLatestEvent(event);
      onStepRef.current?.(event);
    });
    const offSection = newEngine.on("section", (event) => {
      setCurrentSection(event.section);
      onSectionRef.current?.(event);
    });
    const offTransport = newEngine.on("transport", (event) => {
      if (event.type === "start") {
        setIsPlaying(true);
      }
      if (event.type === "stop" || event.type === "end") {
        setIsPlaying(false);
      }
    });

    return () => {
      offStep();
      offSection();
      offTransport();
      newEngine.dispose();
      engineRef.current = null;
      setEngine(null);
    };
  }, [clock, originMs, loop, onStepRef, onSectionRef, onErrorRef]);

  useEffect(() => {
    arrangementRef.current = arrangement;
    const currentEngine = engineRef.current;
    if (!currentEngine) return;
    try {
      currentEngine.setArrangement(arrangement);
      setError(null);
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error(String(cause));
      setError(nextError);
      onErrorRef.current?.(nextError);
    }
  }, [arrangement, onErrorRef]);

  const start = useCallback(() => {
    engineRef.current?.start();
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    const currentEngine = engineRef.current;
    if (!currentEngine) {
      return;
    }
    if (currentEngine.isPlaying()) {
      currentEngine.stop();
    } else {
      currentEngine.start();
    }
  }, []);

  const reset = useCallback(() => {
    engineRef.current?.reset();
  }, []);

  const seek = useCallback((beat: number) => {
    engineRef.current?.seek(beat);
  }, []);

  return {
    engine,
    currentSection,
    isPlaying,
    latestEvent,
    error,
    start,
    stop,
    toggle,
    reset,
    seek,
  };
}
