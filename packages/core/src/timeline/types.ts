export type TempoEvent = {
  beat: number;
  bpm: number;
};

export type TimingMap = {
  tempos: TempoEvent[];
  startPositionMs: number;
};

export type TimelineTrack = {
  id: string;
  name: string;
  enabled: boolean;
  type?: string;
  data?: Record<string, unknown>;
};

export type TimelineEvent = {
  id: string;
  trackId: string;
  beat: number;
  durationBeats?: number;
  value?: number;
  type?: string;
  data?: Record<string, unknown>;
};

export type TimelineProject = {
  version: 1;
  timing: TimingMap;
  tracks: TimelineTrack[];
  events: TimelineEvent[];
};

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
  tracks?: Partial<TimelineTrack>[];
  events?: Partial<TimelineEvent>[];
};

export type TimelineQueryOptions = {
  trackIds?: string[];
  includeDisabledTracks?: boolean;
  eventTypes?: string[];
};

export type SequenceToTimelineOptions = {
  threshold?: number;
  eventType?: string;
};
