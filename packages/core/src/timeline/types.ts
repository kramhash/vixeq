export type TempoEvent = {
  beat: number;
  bpm: number;
};

export type TimingMap = {
  tempos: TempoEvent[];
  startPositionMs: number;
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type TimelineTrack = {
  id: string;
  name: string;
  enabled: boolean;
  data?: JsonObject;
};

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

export type TimelineProject<TEvent extends TimelineEvent = TimelineEvent> = {
  version: 2;
  timing: TimingMap;
  durationBeats: number;
  tracks: TimelineTrack[];
  events: TEvent[];
};

/**
 * Optional domain-validation callback (spec §2.1). Runs once per event,
 * after Core's own structural/JSON-compatibility checks pass. Throws to
 * reject a domain-invalid event; a non-throwing call accepts it.
 */
export type TimelineEventValidator<TEvent extends TimelineEvent = TimelineEvent> = (
  event: TEvent,
) => void;

export type CreateTimingMapOptions =
  | {
      bpm: number;
      startPositionMs?: number;
    }
  | {
      tempos: TempoEvent[];
      startPositionMs?: number;
    };

export type CreateTimelineProjectOptions = {
  timing?: CreateTimingMapOptions | TimingMap;
  durationBeats?: number;
  tracks?: Partial<TimelineTrack>[];
  events?: Partial<TimelineEvent>[];
};

export type TimelineQueryOptions = {
  trackIds?: string[];
  includeDisabledTracks?: boolean;
  /** Independent global-event gate. Defaults to `true`. Unaffected by `trackIds`. */
  includeGlobalEvents?: boolean;
  eventTypes?: string[];
};
