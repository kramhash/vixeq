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

export type SequencerTransport = {
  clock: SequencerClock;
  play(): void | Promise<void>;
  stop(): void | Promise<void>;
  pause?(): void | Promise<void>;
  seek?(timeMs: number): void | Promise<void>;
  dispose?(): void;
};

export type MissedStepPolicy = "emit" | "skip";

export type SequencerEngineOptions = {
  clock?: SequencerClock;
  lookaheadMs?: number;
  missedStepPolicy?: MissedStepPolicy;
  onStep?: SequencerEventHandler<"step">;
  /** When true, step index is derived from absolute time rather than incremented. */
  timeDriven?: boolean;
  /** Absolute ms that corresponds to step 0 in time-driven mode. Defaults to 0. */
  originMs?: number;
};

export type AudioClockOptions = {
  /** An AudioContext for high-resolution interpolation between media.currentTime samples. */
  audioContext?: AudioContext;
};

export type MediaElementTransportOptions = AudioClockOptions & {
  /** Reset media.currentTime to this position when stop() is called. Defaults to 0. */
  stopAtMs?: number;
};

export type AudioBufferTransportOptions = {
  /** Destination node for playback. Defaults to audioContext.destination. */
  destination?: AudioNode;
  /** Loop the AudioBufferSourceNode. Defaults to false. */
  loop?: boolean;
  /** Reset transport time to this position when stop() is called. Defaults to 0. */
  stopAtMs?: number;
};

export type AudioClock = SequencerClock & {
  /** Remove all event listeners added to the media element. */
  dispose(): void;
};

export type AudioContextClock = SequencerClock & {
  /** Anchor to the current AudioContext time and begin advancing. Call at the same moment as source.start(0). */
  start(): void;
  /** Stop advancing; now() returns 0 until start() is called again. */
  stop(): void;
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
