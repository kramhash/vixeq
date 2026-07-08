import type { EasingFunction } from "./easing";

export type StepValue = number;

export type Track = {
  id: string;
  name: string;
  enabled: boolean;
  steps: StepValue[];
};

export type SequenceProject = {
  version: 1;
  bpm: number;
  stepCount: number;
  stepsPerBeat: number;
  tracks: Track[];
};

export type StepEventTrack = {
  id: string;
  name: string;
  enabled: boolean;
  value: StepValue;
  nextValue: StepValue;
};

export type StepEvent = {
  stepIndex: number;
  bpm: number;
  timestamp: number;
  durationMs: number;
  tracks: StepEventTrack[];
};

export type TransportEvent =
  | {
      type: "start";
      bpm: number;
      stepIndex: number;
      timestamp: number;
    }
  | {
      type: "stop";
      bpm: number;
      stepIndex: number;
      timestamp: number;
    }
  | {
      type: "reset";
      bpm: number;
      stepIndex: number;
      timestamp: number;
    }
  | {
      type: "bpm";
      bpm: number;
      previousBpm: number;
      stepIndex: number;
      timestamp: number;
    };

export type ProjectEvent = {
  project: SequenceProject;
  previousProject: SequenceProject;
  stepIndex: number;
  timestamp: number;
};

export type SequencerEventMap = {
  step: StepEvent;
  transport: TransportEvent;
  project: ProjectEvent;
};

export type SequencerEventName = keyof SequencerEventMap;

export type SequencerEventHandler<TEventName extends SequencerEventName> = (
  event: SequencerEventMap[TEventName],
) => void;

export type Unsubscribe = () => void;

export type PlaybackClock = {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timerId: unknown): void;
};

export type SequencerTransport = {
  clock: PlaybackClock;
  play(): void | Promise<void>;
  stop(): void | Promise<void>;
  pause?(): void | Promise<void>;
  seek?(timeMs: number): void | Promise<void>;
  dispose?(): void;
};

export type MissedStepPolicy = "emit" | "skip";

export type SequencerEngineOptions = {
  clock?: PlaybackClock;
  lookaheadMs?: number;
  missedStepPolicy?: MissedStepPolicy;
  onStep?: SequencerEventHandler<"step">;
  /** When true, step index is derived from absolute time rather than incremented. */
  timeDriven?: boolean;
  /** Absolute ms that corresponds to step 0 in time-driven mode. Defaults to 0. */
  originMs?: number;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationResult =
  | {
      ok: true;
      errors: [];
    }
  | {
      ok: false;
      errors: ValidationIssue[];
    };

/**
 * Minimal contract shared by SequencerEngine and ArrangementEngine.
 * Lets rAF-driven consumers (e.g. useAnimatedChannels) work with either
 * engine without depending on the concrete class.
 */
export type ChannelSource = {
  on(eventName: "step", handler: SequencerEventHandler<"step">): Unsubscribe;
  sampleChannels(timeMs: number, easing?: EasingFunction): Record<string, number>;
};
