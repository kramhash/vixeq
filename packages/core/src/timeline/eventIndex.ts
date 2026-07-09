import type { TimelineEvent, TimelineProject, TimelineQueryOptions } from "./types";

export type TimelineEventIndex<TEvent extends TimelineEvent = TimelineEvent> = {
  project: TimelineProject<TEvent>;
  events: readonly TEvent[];
  getEventsInBeatRange(fromBeat: number, toBeat: number, options?: TimelineQueryOptions): TEvent[];
  getEventsInBeatRangeInclusiveEnd(fromBeat: number, toBeat: number, options?: TimelineQueryOptions): TEvent[];
  getEventsAtBeat(beat: number, toleranceBeats?: number, options?: TimelineQueryOptions): TEvent[];
  getNextEvents(beat: number, count: number, options?: TimelineQueryOptions): TEvent[];
};

const lowerBoundBeat = (events: readonly TimelineEvent[], beat: number): number => {
  let low = 0;
  let high = events.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].beat < beat) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
};

const upperBoundBeat = (events: readonly TimelineEvent[], beat: number): number => {
  let low = 0;
  let high = events.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].beat <= beat) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
};

const getEnabledTrackIds = (project: TimelineProject, options: TimelineQueryOptions = {}): Set<string> => {
  if (options.includeDisabledTracks) {
    return new Set(project.tracks.map((track) => track.id));
  }

  return new Set(project.tracks.filter((track) => track.enabled).map((track) => track.id));
};

const matchesQueryOptions = (
  project: TimelineProject,
  event: TimelineEvent,
  options: TimelineQueryOptions = {},
): boolean => {
  if (options.eventTypes && !options.eventTypes.includes(event.type)) {
    return false;
  }

  if (event.trackId === null) {
    return options.includeGlobalEvents ?? true;
  }

  if (options.trackIds && !options.trackIds.includes(event.trackId)) {
    return false;
  }

  return getEnabledTrackIds(project, options).has(event.trackId);
};

export const createTimelineEventIndex = <TEvent extends TimelineEvent>(
  project: TimelineProject<TEvent>,
): TimelineEventIndex<TEvent> => {
  const events = project.events;

  const filterRange = (
    fromIndex: number,
    toIndex: number,
    options: TimelineQueryOptions = {},
    maxCount = Number.POSITIVE_INFINITY,
  ): TEvent[] => {
    const result: TEvent[] = [];
    for (let index = fromIndex; index < toIndex && result.length < maxCount; index += 1) {
      const event = events[index];
      if (matchesQueryOptions(project, event, options)) {
        result.push(event);
      }
    }
    return result;
  };

  return {
    project,
    events,

    getEventsInBeatRange(fromBeat, toBeat, options = {}) {
      if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat)) {
        throw new RangeError("fromBeat and toBeat must be finite numbers.");
      }

      if (fromBeat < 0 || fromBeat > toBeat || toBeat > project.durationBeats) {
        throw new RangeError(
          `fromBeat and toBeat must satisfy 0 <= fromBeat <= toBeat <= ${project.durationBeats}.`,
        );
      }

      const fromIndex = lowerBoundBeat(events, fromBeat);
      const toIndex = lowerBoundBeat(events, toBeat);
      return filterRange(fromIndex, toIndex, options);
    },

    getEventsInBeatRangeInclusiveEnd(fromBeat, toBeat, options = {}) {
      if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat)) {
        throw new RangeError("fromBeat and toBeat must be finite numbers.");
      }

      if (fromBeat < 0 || fromBeat > toBeat || toBeat > project.durationBeats) {
        throw new RangeError(
          `fromBeat and toBeat must satisfy 0 <= fromBeat <= toBeat <= ${project.durationBeats}.`,
        );
      }

      const fromIndex = lowerBoundBeat(events, fromBeat);
      const toIndex = upperBoundBeat(events, toBeat);
      return filterRange(fromIndex, toIndex, options);
    },

    getEventsAtBeat(beat, toleranceBeats = 0, options = {}) {
      if (!Number.isFinite(beat)) {
        return [];
      }

      // Deliberately not Number.isFinite-guarded: a non-finite toleranceBeats
      // (e.g. NaN) propagates into an always-empty result, matching the
      // pre-eventIndex behavior this function replaces.
      const tolerance = Math.max(0, toleranceBeats);
      const fromIndex = lowerBoundBeat(events, beat - tolerance);
      const toIndex = upperBoundBeat(events, beat + tolerance);
      return filterRange(fromIndex, toIndex, options);
    },

    getNextEvents(beat, count, options = {}) {
      if (!Number.isFinite(beat)) {
        return [];
      }

      const maxCount = Math.max(0, count);
      if (maxCount === 0) {
        return [];
      }

      const fromIndex = lowerBoundBeat(events, beat);
      return filterRange(fromIndex, events.length, options, maxCount);
    },
  };
};
