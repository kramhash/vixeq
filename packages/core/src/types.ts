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

export type SequencerClock = {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timerId: unknown): void;
};

export type MissedStepPolicy = "emit" | "skip";

export type SequencerEngineOptions = {
  clock?: SequencerClock;
  lookaheadMs?: number;
  missedStepPolicy?: MissedStepPolicy;
  onStep?: SequencerEventHandler<"step">;
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
