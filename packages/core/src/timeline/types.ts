import type {
  EnginePlaybackEvent,
  EnginePlaybackSnapshot,
  MissedStepPolicy,
  Unsubscribe,
} from "../types";
import type { ListenerErrorContext, PlaybackTransport } from "../playbackTransport";

/** A tempo that takes effect instantly at `beat` and holds until the next one. */
export type TempoEvent = {
  beat: number;
  bpm: number;
};

/**
 * Maps beats to transport positions. `tempos` starts at beat 0 with strictly
 * increasing beats. `startPositionMs` is the transport position of beat 0: a
 * positive value is pre-roll, and a negative one puts beat 0 before the start
 * of the transport (an audio file with a clipped head, or a pickup).
 * Check one with {@link validateTimingMap}; build one with
 * {@link createTimingMap}.
 */
export type TimingMap = {
  tempos: TempoEvent[];
  startPositionMs: number;
};

/** A JSON scalar. */
export type JsonPrimitive = string | number | boolean | null;
/** Any JSON value. */
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
/** A JSON object. Timeline `data` must be one, with finite numbers only. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * A Timeline track. Events refer to it by `id`; when it is disabled, its
 * events are not dispatched. `data` holds your own JSON metadata.
 */
export type TimelineTrack = {
  id: string;
  name: string;
  enabled: boolean;
  data?: JsonObject;
};

/**
 * A point event on the timeline at `beat` (0 or more, less than the project's
 * `durationBeats`), dispatched as a cue when playback reaches it. `trackId`
 * is a track's id, or `null` for a global event. Narrow `TType` and `TData`
 * to type your events; a union of several is supported.
 */
export type TimelineEvent<
  TType extends string = string,
  TData extends JsonObject = JsonObject,
> = {
  id: string;
  trackId: string | null;
  beat: number;
  type: TType;
  data?: TData;
};

/**
 * A timeline of point events over `durationBeats` beats, with its own
 * {@link TimingMap}. Events are sorted by beat, and events on the same beat
 * dispatch in array order. Check one with {@link validateTimelineProject} and
 * edit it with the immutable helpers such as {@link addTimelineEvent}.
 */
export type TimelineProject<TEvent extends TimelineEvent = TimelineEvent> = {
  version: 2;
  timing: TimingMap;
  durationBeats: number;
  tracks: TimelineTrack[];
  events: TEvent[];
};

/**
 * Input of `addTimelineEvent`: every required field except `id`, checked
 * against each member when `TEvent` is a union. A missing `id` gets the first
 * unused `event-N`.
 */
export type TimelineEventInput<TEvent extends TimelineEvent = TimelineEvent> = TEvent extends TimelineEvent
  ? Omit<TEvent, "id"> & { id?: string }
  : never;

/**
 * Patch of `updateTimelineEvent`: any field except `id`. When `TEvent` is a
 * union of several members, `type` and `data` change only together, as a
 * pair from one member, so a patch cannot leave an event with one member's
 * `type` and another member's `data` (pass `data: undefined` to drop it).
 * Other fields may be patched alone.
 *
 * @typeParam TUnion - Leave at its default.
 */
export type TimelineEventPatch<
  TEvent extends TimelineEvent = TimelineEvent,
  TUnion extends TimelineEvent = TEvent,
> = TEvent extends TimelineEvent
  ? [Exclude<TUnion, TEvent>] extends [never]
    ? Partial<Omit<TEvent, "id">>
    : Partial<Omit<TEvent, "id" | "type" | "data">> &
        ({ type?: never; data?: undefined } | { type: TEvent["type"]; data: TEvent["data"] })
  : never;

/**
 * Optional domain-validation callback (spec §2.1). Runs once per event,
 * after Core's own structural/JSON-compatibility checks pass. Throws to
 * reject a domain-invalid event; a non-throwing call accepts it.
 */
export type TimelineEventValidator<TEvent extends TimelineEvent = TimelineEvent> = (
  event: TEvent,
) => void;

/**
 * Options for {@link createTimingMap}: one tempo (`bpm`) or a tempo list, and
 * an optional `startPositionMs` (default 0).
 */
export type CreateTimingMapOptions =
  | {
      bpm: number;
      startPositionMs?: number;
    }
  | {
      tempos: TempoEvent[];
      startPositionMs?: number;
    };

/**
 * Options for {@link createTimelineProject}. Everything is optional and
 * repaired as by {@link normalizeTimelineProject}.
 */
export type CreateTimelineProjectOptions = {
  timing?: CreateTimingMapOptions | TimingMap;
  durationBeats?: number;
  tracks?: Partial<TimelineTrack>[];
  events?: Partial<TimelineEvent>[];
};

/**
 * Filters for the Timeline query functions.
 *
 * `trackIds` keeps only events on those tracks; `includeDisabledTracks`
 * (default false) keeps events on disabled tracks; `eventTypes` keeps only
 * those types. Global events (`trackId: null`) are governed by
 * `includeGlobalEvents` alone.
 */
export type TimelineQueryOptions = {
  trackIds?: string[];
  includeDisabledTracks?: boolean;
  /** Independent global-event gate. Defaults to `true`. Unaffected by `trackIds`. */
  includeGlobalEvents?: boolean;
  eventTypes?: string[];
};

/**
 * Emitted as `"cue"` when playback reaches an event. `iteration` counts local
 * loops from 0. `scheduledPositionMs`, `transportPositionMs`, and `lateByMs`
 * have the same meaning as on {@link StepEvent}.
 */
export type TimelineCueEvent<TEvent extends TimelineEvent = TimelineEvent> = {
  event: TEvent;
  iteration: number;
  scheduledPositionMs: number;
  transportPositionMs: number;
  lateByMs: number;
};

/** A {@link TimelineEngine} playback snapshot. */
export type TimelinePlaybackSnapshot = EnginePlaybackSnapshot;

/** An {@link EnginePlaybackEvent} from a {@link TimelineEngine}. */
export type TimelinePlaybackEvent = Omit<EnginePlaybackEvent, "snapshot"> & {
  snapshot: TimelinePlaybackSnapshot;
};

/**
 * Emitted as `"project"` by {@link TimelineEngine.setProject}: the new and
 * previous project and the preserved position.
 */
export type TimelineProjectEvent<TEvent extends TimelineEvent = TimelineEvent> = {
  project: TimelineProject<TEvent>;
  previousProject: TimelineProject<TEvent>;
  positionMs: number;
  beat: number;
};

/** Payload type of each {@link TimelineEngine} event, keyed by event name. */
export type TimelineEventMap<TEvent extends TimelineEvent = TimelineEvent> = {
  cue: TimelineCueEvent<TEvent>;
  playback: TimelinePlaybackEvent;
  project: TimelineProjectEvent<TEvent>;
};

/** Event names accepted by {@link TimelineEngine.on}. */
export type TimelineEventName = keyof TimelineEventMap;

/** Listener for one {@link TimelineEngine} event. */
export type TimelineEventHandler<
  TEventName extends TimelineEventName,
  TEvent extends TimelineEvent = TimelineEvent,
> = (event: TimelineEventMap<TEvent>[TEventName]) => void;

/**
 * Options for the {@link TimelineEngine} constructor. `transport`,
 * `onListenerError`, and `missedCuePolicy` work as `transport`,
 * `onListenerError`, and `missedStepPolicy` do in
 * {@link SequencerEngineOptions}; `onCue` is shorthand for
 * `engine.on("cue", onCue)`, and `eventValidator` checks every event of each
 * project the engine is given.
 */
export type TimelineEngineOptions<TEvent extends TimelineEvent = TimelineEvent> = {
  transport?: PlaybackTransport;
  /** Max ms between polls while playing. Default 25. */
  lookaheadMs?: number;
  /** Repeat from beat 0 at the timeline end. Default false. */
  loop?: boolean;
  missedCuePolicy?: MissedStepPolicy;
  eventValidator?: TimelineEventValidator<TEvent>;
  onCue?: TimelineEventHandler<"cue", TEvent>;
  onListenerError?: (error: unknown, context: ListenerErrorContext) => void;
};

export type { Unsubscribe };
