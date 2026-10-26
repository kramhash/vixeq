import type { EasingFunction } from "./easing";
import type {
  ListenerErrorContext,
  PlaybackState,
  PlaybackTransport,
} from "./playbackTransport";

/** A step's control value, from 0 to 1 inclusive. */
export type StepValue = number;

/**
 * One row of a {@link SequenceProject}: a channel whose `steps` hold one value per step.
 * A disabled track keeps its steps but outputs 0.
 */
export type Track = {
  id: string;
  name: string;
  enabled: boolean;
  steps: StepValue[];
};

/**
 * A step-sequencer pattern: `stepCount` steps per track at `bpm`, with
 * `stepsPerBeat` steps to a beat. Validate untrusted data with
 * {@link validateProject}, and repair it with {@link normalizeProject}.
 */
export type SequenceProject = {
  version: 1;
  bpm: number;
  stepCount: number;
  stepsPerBeat: number;
  tracks: Track[];
};

/**
 * A track's state in a {@link StepEvent}: its value at this step and at the
 * next one (`nextValue`, wrapping to step 0 after the last step).
 */
export type StepEventTrack = {
  id: string;
  name: string;
  enabled: boolean;
  value: StepValue;
  nextValue: StepValue;
};

/**
 * Emitted as `"step"` when a step starts.
 *
 * `scheduledPositionMs` is when the step was due, `transportPositionMs` where
 * the transport was when it was dispatched, and `lateByMs` how late that was.
 * `durationMs` is the step's length at the current tempo. Trigger envelopes with
 * `scheduledPositionMs`, not with a clock timestamp.
 */
export type StepEvent = {
  stepIndex: number;
  bpm: number;
  scheduledPositionMs: number;
  transportPositionMs: number;
  lateByMs: number;
  durationMs: number;
  cause: StepEventCause;
  tracks: StepEventTrack[];
};

/**
 * What triggered a {@link StepEvent}.
 *
 * `"loop"` is emitted when an attached transport wraps its position on a
 * natural loop: the engine emits one `"loop"`-caused step immediately at the
 * wrapped position, re-anchoring step emission so it does not permanently
 * stop advancing after the first loop.
 */
export type StepEventCause = "play" | "tick" | "seek" | "project-change" | "loop";

/**
 * Emitted as `"project"` by {@link SequencerEngine.setProject}: the new and
 * previous project, the current step, and the channels whose output changed at
 * the preserved position.
 */
export type ProjectEvent = {
  project: SequenceProject;
  previousProject: SequenceProject;
  stepIndex: number;
  changedChannelIds: string[];
  previousChannels: Record<string, number>;
  channels: Record<string, number>;
  positionMs: number;
  beat: number;
};

/**
 * The engine-independent part of a `"project"` event, as seen through
 * {@link ChannelSource}. `changedChannelIds` lists the channels whose output
 * changed at the preserved position.
 */
export type ChannelProjectEvent = {
  changedChannelIds: string[];
  previousChannels: Record<string, number>;
  channels: Record<string, number>;
  positionMs: number;
  beat: number;
};

/** Payload type of each {@link SequencerEngine} event, keyed by event name. */
export type SequencerEventMap = {
  step: StepEvent;
  playback: SequencerPlaybackEvent;
  project: ProjectEvent;
};

/** Event names accepted by {@link SequencerEngine.on}. */
export type SequencerEventName = keyof SequencerEventMap;

/** Listener for one {@link SequencerEngine} event. */
export type SequencerEventHandler<TEventName extends SequencerEventName> = (
  event: SequencerEventMap[TEventName],
) => void;

/** Removes the listener it was returned for. Calling it again does nothing. */
export type Unsubscribe = () => void;

/**
 * A time source for {@link createClockTransport}: `now()` in milliseconds,
 * plus a timer pair. Implement it to drive playback from your own clock;
 * {@link browserClock} is the default. In 1.x it gains only optional members.
 */
export type PlaybackClock = {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timerId: unknown): void;
};

/**
 * What an engine does when a delayed tick crossed several steps (or cues):
 * `"emit"` dispatches every one in order, `"skip"` only the latest.
 * An explicit seek never applies it.
 */
export type MissedStepPolicy = "emit" | "skip";

/**
 * Why an engine playback event happened: a `"command"` called on the engine,
 * the `"transport"` itself (including a seek made directly on it), or the
 * engine reaching its `"local-end"`.
 */
export type EnginePlaybackCause = "command" | "transport" | "local-end";

/**
 * An engine's playback state: the transport state and position mapped into
 * the engine (`beat`), plus `projectLoop` (the engine's own loop) and
 * `transportLoop` (the transport's).
 */
export type EnginePlaybackSnapshot = {
  state: PlaybackState;
  positionMs: number;
  beat: number;
  playbackRate: number;
  projectLoop: boolean;
  transportLoop: boolean;
  buffering: boolean;
};

/** A {@link SequencerEngine} playback snapshot; adds the current `stepIndex`. */
export type SequencerPlaybackSnapshot = EnginePlaybackSnapshot & {
  stepIndex: number;
};

/**
 * Emitted as `"playback"` on every engine playback transition. `error` is set
 * only for `type: "error"`, an asynchronous transport failure; a failed
 * command rejects its own promise instead.
 */
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

/** An {@link EnginePlaybackEvent} whose snapshot carries the step index. */
export type SequencerPlaybackEvent = Omit<EnginePlaybackEvent, "snapshot"> & {
  snapshot: SequencerPlaybackSnapshot;
};

/**
 * An engine's logical position: transport-relative milliseconds and the beat
 * they map to.
 */
export type ChannelPosition = {
  positionMs: number;
  beat: number;
};

/** Options for the {@link SequencerEngine} constructor. */
export type SequencerEngineOptions = {
  /**
   * The playback clock/transport driving this engine. Supply your own (e.g.
   * wrapping an `<audio>` element) to keep step and channel timing in sync
   * with an external clock. If omitted, the engine creates and owns a
   * transport backed by the browser clock (`browserClock`, via
   * `createClockTransport`) and disposes it automatically when the engine
   * itself is disposed.
   */
  transport?: PlaybackTransport;
  /**
   * How far ahead (in ms) the engine schedules its next internal tick.
   * Smaller values reduce worst-case step-emission latency at the cost of
   * more timer churn. Default 25.
   */
  lookaheadMs?: number;
  /**
   * How to handle a scheduling gap where more than one step boundary was
   * crossed since the last tick (e.g. after a slow frame or tab
   * backgrounding). `"emit"` (default) emits a `"step"` event for every
   * skipped step in order; `"skip"` emits only the most recent step and
   * drops the ones in between.
   */
  missedStepPolicy?: MissedStepPolicy;
  /** Convenience shorthand for `engine.on("step", onStep)`, registered during construction. */
  onStep?: SequencerEventHandler<"step">;
  /**
   * Called when a `"step"`, `"playback"`, or `"project"` listener throws.
   * If omitted (or if this callback itself throws), the error is routed to
   * `globalThis.reportError` when available, otherwise `console.error`.
   */
  onListenerError?: (error: unknown, context: ListenerErrorContext) => void;
};

/**
 * One problem found by a `validate*` function: where (`path`, such as
 * `"tracks.0.steps.3"`) and what.
 */
export type ValidationIssue = {
  path: string;
  message: string;
};

/**
 * Result of a `validate*` function: `ok: true` with no errors, or `ok: false`
 * with at least one {@link ValidationIssue}.
 */
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
 * A warning or error from a `migrate*` function, with a stable `code` and the
 * `path` of the offending field when there is one.
 */
export type MigrationIssue = {
  code: string;
  message: string;
  path?: string;
};

/**
 * Result of a `migrate*` function: the migrated project with any warnings, or
 * the errors that blocked migration.
 */
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
  sampleChannelsAt(positionMs: number, easing?: EasingFunction): Record<string, number>;
  getPosition(): ChannelPosition;
  getPlaybackState(): PlaybackState;
  on(eventName: "playback", handler: (event: EnginePlaybackEvent) => void): Unsubscribe;
  on(eventName: "project", handler: (event: ChannelProjectEvent) => void): Unsubscribe;
};
