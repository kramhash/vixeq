import { clampStepValue } from "../project";
import type { ValidationIssue, ValidationResult } from "../types";
import { normalizeTimingMap } from "./timing";
import type {
  CreateTimelineProjectOptions,
  TimelineEvent,
  TimelineProject,
  TimelineTrack,
} from "./types";

let timelineIdCounter = 0;

const createTimelineId = (prefix: string): string => {
  timelineIdCounter += 1;
  return `${prefix}-${timelineIdCounter}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const sortTimelineEvents = (events: TimelineEvent[]): TimelineEvent[] =>
  [...events].sort((a, b) => a.beat - b.beat || a.trackId.localeCompare(b.trackId) || a.id.localeCompare(b.id));

export const normalizeTimelineTrack = (track: Partial<TimelineTrack>, index = 0): TimelineTrack => ({
  id: typeof track.id === "string" && track.id.trim() ? track.id : createTimelineId("track"),
  name: typeof track.name === "string" && track.name.trim() ? track.name.trim() : `Track ${index + 1}`,
  enabled: typeof track.enabled === "boolean" ? track.enabled : true,
  ...(typeof track.type === "string" && track.type.trim() ? { type: track.type } : {}),
  ...(isRecord(track.data) ? { data: track.data } : {}),
});

export const normalizeTimelineEvent = (event: Partial<TimelineEvent>, index = 0): TimelineEvent => ({
  id: typeof event.id === "string" && event.id.trim() ? event.id : createTimelineId("event"),
  trackId: typeof event.trackId === "string" && event.trackId.trim() ? event.trackId : "global",
  beat: Math.max(0, Number.isFinite(event.beat) ? Number(event.beat) : index),
  ...(event.durationBeats !== undefined
    ? { durationBeats: Math.max(0, Number.isFinite(event.durationBeats) ? Number(event.durationBeats) : 0) }
    : {}),
  ...(event.value !== undefined ? { value: clampStepValue(event.value) } : {}),
  ...(typeof event.type === "string" && event.type.trim() ? { type: event.type } : {}),
  ...(isRecord(event.data) ? { data: event.data } : {}),
});

export const createTimelineProject = (options: CreateTimelineProjectOptions = {}): TimelineProject =>
  normalizeTimelineProject({
    version: 1,
    timing: normalizeTimingMap(options.timing),
    tracks: options.tracks ?? [],
    events: options.events ?? [],
  });

export const normalizeTimelineProject = (input: unknown): TimelineProject => {
  const source = isRecord(input) ? input : {};
  const tracksInput = Array.isArray(source.tracks) ? source.tracks.filter(isRecord) : [];
  const eventsInput = Array.isArray(source.events) ? source.events.filter(isRecord) : [];
  const tracks = tracksInput.map((track, index) => normalizeTimelineTrack(track, index));

  return {
    version: 1,
    timing: normalizeTimingMap(isRecord(source.timing) ? source.timing : undefined),
    tracks,
    events: sortTimelineEvents(eventsInput.map((event, index) => normalizeTimelineEvent(event, index))),
  };
};

export const validateTimelineProject = (input: unknown): ValidationResult => {
  const errors: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ path: "$", message: "Timeline project must be an object." }],
    };
  }

  if (input.version !== 1) {
    errors.push({ path: "version", message: "Version must be 1." });
  }

  if (!isRecord(input.timing)) {
    errors.push({ path: "timing", message: "Timing must be an object." });
  }

  if (!Array.isArray(input.tracks)) {
    errors.push({ path: "tracks", message: "Tracks must be an array." });
  }

  if (!Array.isArray(input.events)) {
    errors.push({ path: "events", message: "Events must be an array." });
  } else {
    input.events.forEach((event, index) => {
      if (!isRecord(event)) {
        errors.push({ path: `events.${index}`, message: "Event must be an object." });
        return;
      }

      if (typeof event.trackId !== "string") {
        errors.push({ path: `events.${index}.trackId`, message: "Event trackId must be a string." });
      }

      if (typeof event.beat !== "number" || Number.isNaN(event.beat)) {
        errors.push({ path: `events.${index}.beat`, message: "Event beat must be a number." });
      }
    });
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
};

export const addTimelineTrack = (project: TimelineProject, track: Partial<TimelineTrack>): TimelineProject =>
  normalizeTimelineProject({
    ...project,
    tracks: [...project.tracks, track],
  });

export const removeTimelineTrack = (project: TimelineProject, trackId: string): TimelineProject =>
  normalizeTimelineProject({
    ...project,
    tracks: project.tracks.filter((track) => track.id !== trackId),
    events: project.events.filter((event) => event.trackId !== trackId),
  });

export const setTimelineTrackEnabled = (
  project: TimelineProject,
  trackId: string,
  enabled: boolean,
): TimelineProject =>
  normalizeTimelineProject({
    ...project,
    tracks: project.tracks.map((track) => (track.id === trackId ? { ...track, enabled } : track)),
  });

export const addTimelineEvent = (project: TimelineProject, event: Partial<TimelineEvent>): TimelineProject =>
  normalizeTimelineProject({
    ...project,
    events: [...project.events, event],
  });

export const updateTimelineEvent = (
  project: TimelineProject,
  eventId: string,
  patch: Partial<TimelineEvent>,
): TimelineProject =>
  normalizeTimelineProject({
    ...project,
    events: project.events.map((event) => (event.id === eventId ? { ...event, ...patch, id: event.id } : event)),
  });

export const removeTimelineEvent = (project: TimelineProject, eventId: string): TimelineProject =>
  normalizeTimelineProject({
    ...project,
    events: project.events.filter((event) => event.id !== eventId),
  });
