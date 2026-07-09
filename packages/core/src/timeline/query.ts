import type { TimelineEvent, TimelineProject, TimelineQueryOptions } from "./types";

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
    // includeGlobalEvents is the only global-event control; trackIds has no
    // effect on it (spec §2.2).
    return options.includeGlobalEvents ?? true;
  }

  if (options.trackIds && !options.trackIds.includes(event.trackId)) {
    return false;
  }

  return getEnabledTrackIds(project, options).has(event.trackId);
};

/**
 * Strict, half-open range query: `0 <= fromBeat <= toBeat <= durationBeats`.
 * Throws `RangeError` for a reversed, out-of-bounds, or non-finite range
 * instead of reordering or clamping it (spec §2.2).
 */
export const getEventsInBeatRange = (
  project: TimelineProject,
  fromBeat: number,
  toBeat: number,
  options: TimelineQueryOptions = {},
): TimelineEvent[] => {
  if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat)) {
    throw new RangeError("fromBeat and toBeat must be finite numbers.");
  }

  if (fromBeat < 0 || fromBeat > toBeat || toBeat > project.durationBeats) {
    throw new RangeError(
      `fromBeat and toBeat must satisfy 0 <= fromBeat <= toBeat <= ${project.durationBeats}.`,
    );
  }

  return project.events.filter(
    (event) => event.beat >= fromBeat && event.beat < toBeat && matchesQueryOptions(project, event, options),
  );
};

export const getEventsAtBeat = (
  project: TimelineProject,
  beat: number,
  toleranceBeats = 0,
  options: TimelineQueryOptions = {},
): TimelineEvent[] => {
  const tolerance = Math.max(0, toleranceBeats);
  return project.events.filter(
    (event) => Math.abs(event.beat - beat) <= tolerance && matchesQueryOptions(project, event, options),
  );
};

export const getNextEvents = (
  project: TimelineProject,
  beat: number,
  count: number,
  options: TimelineQueryOptions = {},
): TimelineEvent[] =>
  project.events
    .filter((event) => event.beat >= beat && matchesQueryOptions(project, event, options))
    .slice(0, Math.max(0, count));
