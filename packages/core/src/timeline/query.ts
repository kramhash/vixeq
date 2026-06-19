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
  if (options.trackIds && !options.trackIds.includes(event.trackId)) {
    return false;
  }

  if (options.eventTypes && !options.eventTypes.includes(event.type ?? "")) {
    return false;
  }

  if (event.trackId === "global") {
    return true;
  }

  return getEnabledTrackIds(project, options).has(event.trackId);
};

export const getEventsInBeatRange = (
  project: TimelineProject,
  fromBeat: number,
  toBeat: number,
  options: TimelineQueryOptions = {},
): TimelineEvent[] => {
  const start = Math.min(fromBeat, toBeat);
  const end = Math.max(fromBeat, toBeat);

  return project.events.filter(
    (event) => event.beat >= start && event.beat < end && matchesQueryOptions(project, event, options),
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
