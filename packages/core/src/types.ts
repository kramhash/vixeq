import type { EasingFunction } from "./easing";
import type {
  ListenerErrorContext,
  PlaybackState,
  PlaybackTransport,
} from "./playbackTransport";

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
  scheduledPositionMs: number;
  transportPositionMs: number;
  lateByMs: number;
  durationMs: number;
  cause: StepEventCause;
  tracks: StepEventTrack[];
  /** @deprecated Use scheduledPositionMs. Kept until ArrangementEngine moves to Playback v2. */
  timestamp?: number;
};

export type StepEventCause = "play" | "tick" | "seek" | "project-change" | "loop";

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
  changedChannelIds: string[];
  previousChannels: Record<string, number>;
  channels: Record<string, number>;
  positionMs: number;
  beat: number;
  /** @deprecated Kept until ArrangementEngine moves to Playback v2. */
  timestamp?: number;
};

export type ChannelProjectEvent = {
  changedChannelIds: string[];
  previousChannels: Record<string, number>;
  channels: Record<string, number>;
  positionMs: number;
  beat: number;
};

export type SequencerEventMap = {
  step: StepEvent;
  playback: SequencerPlaybackEvent;
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

export type EnginePlaybackCause = "command" | "transport" | "local-end";

export type EnginePlaybackSnapshot = {
  state: PlaybackState;
  positionMs: number;
  beat: number;
  playbackRate: number;
  projectLoop: boolean;
  transportLoop: boolean;
  buffering: boolean;
};

export type SequencerPlaybackSnapshot = EnginePlaybackSnapshot & {
  stepIndex: number;
};

export type EnginePlaybackEvent = {
  type:
    | "play"
    | "pause"
    | "stop"
    | "seek"
    | "ratechange"
    | "loopchange"
    | "loop"
    | "durationchange"
    | "bufferingchange"
    | "ended"
    | "error";
  cause: EnginePlaybackCause;
  previousState: PlaybackState;
  snapshot: EnginePlaybackSnapshot;
  error?: unknown;
};

export type SequencerPlaybackEvent = Omit<EnginePlaybackEvent, "snapshot"> & {
  snapshot: SequencerPlaybackSnapshot;
};

export type ChannelPosition = {
  positionMs: number;
  beat: number;
};

export type SequencerEngineOptions = {
  transport?: PlaybackTransport;
  lookaheadMs?: number;
  missedStepPolicy?: MissedStepPolicy;
  onStep?: SequencerEventHandler<"step">;
  onListenerError?: (error: unknown, context: ListenerErrorContext) => void;
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

export type MigrationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type MigrationResult<T> =
  | { ok: true; project: T; warnings: MigrationIssue[] }
  | { ok: false; errors: MigrationIssue[] };

/**
 * Minimal contract shared by SequencerEngine and ArrangementEngine.
 * Lets rAF-driven consumers (e.g. useAnimatedChannels) work with either
 * engine without depending on the concrete class.
 */
export type ChannelSource = {
  on(eventName: "step", handler: SequencerEventHandler<"step">): Unsubscribe;
  sampleChannels(easing?: EasingFunction): Record<string, number>;
  sampleChannelsAt(timeMs: number, easing?: EasingFunction): Record<string, number>;
  getPosition(): ChannelPosition;
  getPlaybackState(): PlaybackState;
  on(eventName: "playback", handler: (event: EnginePlaybackEvent) => void): Unsubscribe;
  on(eventName: "project", handler: (event: ChannelProjectEvent) => void): Unsubscribe;
};
