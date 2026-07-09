import type { ValidationIssue, ValidationResult } from "../types";
import { normalizeTimingMap, validateTimingMap } from "./timing";
import type {
  CreateTimelineProjectOptions,
  JsonObject,
  JsonValue,
  TimelineEvent,
  TimelineEventValidator,
  TimelineProject,
  TimelineTrack,
  TimingMap,
} from "./types";

const DEFAULT_DURATION_BEATS = 4;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * True when `value` is representable in JSON: primitives, `null`, arrays,
 * and plain objects, recursively, with every numeric leaf finite.
 */
export const isJsonCompatible = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonCompatible);
  }

  if (isRecord(value)) {
    return Object.values(value).every(isJsonCompatible);
  }

  return false;
};

/**
 * Best-effort repair: keeps only the JSON-compatible parts of `value`,
 * recursively dropping incompatible array entries and object keys. Returns
 * `undefined` when nothing JSON-compatible survives (or the input itself is
 * not JSON-compatible at all, e.g. a function or `undefined`).
 */
export const toJsonCompatible = (value: unknown): JsonValue | undefined => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const entry of value) {
      const converted = toJsonCompatible(entry);
      if (converted !== undefined) {
        result.push(converted);
      }
    }
    return result;
  }

  if (isRecord(value)) {
    const result: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      const converted = toJsonCompatible(entry);
      if (converted !== undefined) {
        result[key] = converted;
      }
    }
    return result;
  }

  return undefined;
};

/**
 * Deterministic, Project-local id generation: the first unused `${prefix}-N`
 * suffix given the collection's current ids. A pure function of
 * `existingIds` — never a module-global counter, so the same input always
 * produces the same result (spec §2).
 */
export const nextAvailableId = (prefix: string, existingIds: Iterable<string>): string => {
  const used = new Set(existingIds);
  let counter = 1;
  while (used.has(`${prefix}-${counter}`)) {
    counter += 1;
  }
  return `${prefix}-${counter}`;
};

export const sortTimelineEvents = (events: TimelineEvent[]): TimelineEvent[] =>
  // Stable sort by beat only: Timeline imposes no secondary sort key, so
  // same-beat events must keep their original relative (array) order.
  [...events].sort((a, b) => a.beat - b.beat);

const buildTrackFields = (track: Partial<TimelineTrack>, index: number): Omit<TimelineTrack, "id"> => ({
  name: typeof track.name === "string" && track.name.trim() ? track.name.trim() : `Track ${index + 1}`,
  enabled: typeof track.enabled === "boolean" ? track.enabled : true,
  ...(isRecord(track.data) ? { data: toJsonCompatible(track.data) as JsonObject } : {}),
});

/**
 * Normalizes a single track in isolation. When `id` is missing, this
 * generates `"track-1"` every time (no sibling context) — safe as a
 * standalone utility, but do not use it to normalize multiple items in a
 * batch (they would collide). `normalizeTimelineProject()`'s own batch loop
 * does not call this function for exactly that reason; it dedupes ids
 * across the whole collection instead.
 */
export const normalizeTimelineTrack = (track: Partial<TimelineTrack> = {}, index = 0): TimelineTrack => ({
  id: typeof track.id === "string" && track.id.trim() ? track.id.trim() : nextAvailableId("track", []),
  ...buildTrackFields(track, index),
});

const buildEventFields = (event: Partial<TimelineEvent>, index: number): Omit<TimelineEvent, "id" | "trackId"> => ({
  beat: Math.max(0, Number.isFinite(event.beat) ? Number(event.beat) : index),
  type: typeof event.type === "string" && event.type.trim() ? event.type : "event",
  ...(isRecord(event.data) ? { data: toJsonCompatible(event.data) as JsonObject } : {}),
});

/**
 * Normalizes a single event in isolation. Same single-item caveat as
 * `normalizeTimelineTrack`: do not use it to normalize a batch of sibling
 * events that omit `id` (they would all collide on `"event-1"`).
 */
export const normalizeTimelineEvent = (event: Partial<TimelineEvent> = {}, index = 0): TimelineEvent => ({
  id: typeof event.id === "string" && event.id.trim() ? event.id.trim() : nextAvailableId("event", []),
  trackId: typeof event.trackId === "string" && event.trackId.trim() ? event.trackId : null,
  ...buildEventFields(event, index),
});

export const createTimelineProject = (options: CreateTimelineProjectOptions = {}): TimelineProject =>
  normalizeTimelineProject({
    version: 2,
    timing: normalizeTimingMap(options.timing),
    durationBeats: options.durationBeats,
    tracks: options.tracks ?? [],
    events: options.events ?? [],
  });

export const normalizeTimelineProject = (input: unknown): TimelineProject => {
  const source = isRecord(input) ? input : {};

  const tracksInput = Array.isArray(source.tracks) ? source.tracks.filter(isRecord) : [];
  const usedTrackIds = new Set<string>();
  const tracks: TimelineTrack[] = tracksInput.map((track, index) => {
    const requestedId = typeof track.id === "string" ? track.id.trim() : "";
    const id = requestedId && !usedTrackIds.has(requestedId) ? requestedId : nextAvailableId("track", usedTrackIds);
    usedTrackIds.add(id);
    return { id, ...buildTrackFields(track, index) };
  });

  const eventsInput = Array.isArray(source.events) ? source.events.filter(isRecord) : [];
  const usedEventIds = new Set<string>();
  const events: TimelineEvent[] = eventsInput.map((event, index) => {
    const requestedId = typeof event.id === "string" ? event.id.trim() : "";
    const id = requestedId && !usedEventIds.has(requestedId) ? requestedId : nextAvailableId("event", usedEventIds);
    usedEventIds.add(id);
    const trackId = typeof event.trackId === "string" && event.trackId.trim() ? event.trackId : null;
    return { id, trackId, ...buildEventFields(event, index) };
  });

  const durationBeats =
    typeof source.durationBeats === "number" && Number.isFinite(source.durationBeats) && source.durationBeats > 0
      ? source.durationBeats
      : DEFAULT_DURATION_BEATS;

  return {
    version: 2,
    timing: normalizeTimingMap(isRecord(source.timing) ? source.timing : undefined),
    durationBeats,
    tracks,
    events: sortTimelineEvents(events),
  };
};

export const validateTimelineProject = (
  input: unknown,
  eventValidator?: TimelineEventValidator,
): ValidationResult => {
  const errors: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: "$", message: "Timeline project must be an object." }] };
  }

  if (input.version !== 2) {
    errors.push({ path: "version", message: "Version must be 2." });
  }

  let durationBeats: number | undefined;
  if (typeof input.durationBeats !== "number") {
    errors.push({ path: "durationBeats", message: "durationBeats must be a number." });
  } else if (!Number.isFinite(input.durationBeats) || input.durationBeats <= 0) {
    errors.push({ path: "durationBeats", message: "durationBeats must be a finite number greater than 0." });
  } else {
    durationBeats = input.durationBeats;
  }

  if (!isRecord(input.timing)) {
    errors.push({ path: "timing", message: "Timing must be an object." });
  } else {
    try {
      validateTimingMap(input.timing as TimingMap);
    } catch (error) {
      errors.push({ path: "timing", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const trackIds = new Set<string>();
  if (!Array.isArray(input.tracks)) {
    errors.push({ path: "tracks", message: "Tracks must be an array." });
  } else {
    input.tracks.forEach((track, index) => {
      if (!isRecord(track)) {
        errors.push({ path: `tracks.${index}`, message: "Track must be an object." });
        return;
      }

      if (typeof track.id !== "string" || !track.id.trim()) {
        errors.push({ path: `tracks.${index}.id`, message: "Track id must be a non-empty string." });
      } else if (trackIds.has(track.id)) {
        errors.push({ path: `tracks.${index}.id`, message: `Duplicate track id "${track.id}".` });
      } else {
        trackIds.add(track.id);
      }

      if (typeof track.name !== "string") {
        errors.push({ path: `tracks.${index}.name`, message: "Track name must be a string." });
      }

      if (typeof track.enabled !== "boolean") {
        errors.push({ path: `tracks.${index}.enabled`, message: "Track enabled must be a boolean." });
      }

      if (track.data !== undefined && (!isRecord(track.data) || !isJsonCompatible(track.data))) {
        errors.push({ path: `tracks.${index}.data`, message: "Track data must be a JSON-compatible object." });
      }

      if (track.type !== undefined) {
        errors.push({
          path: `tracks.${index}.type`,
          message: "Track must not include the removed type field.",
        });
      }
    });
  }

  const eventIds = new Set<string>();
  let previousBeat: number | undefined;
  let eventsOutOfOrder = false;

  if (!Array.isArray(input.events)) {
    errors.push({ path: "events", message: "Events must be an array." });
  } else {
    input.events.forEach((event, index) => {
      if (!isRecord(event)) {
        errors.push({ path: `events.${index}`, message: "Event must be an object." });
        return;
      }

      let structurallyValid = true;

      if (typeof event.id !== "string" || !event.id.trim()) {
        errors.push({ path: `events.${index}.id`, message: "Event id must be a non-empty string." });
        structurallyValid = false;
      } else if (eventIds.has(event.id)) {
        errors.push({ path: `events.${index}.id`, message: `Duplicate event id "${event.id}".` });
        structurallyValid = false;
      } else {
        eventIds.add(event.id);
      }

      if (event.trackId !== null) {
        if (typeof event.trackId !== "string") {
          errors.push({ path: `events.${index}.trackId`, message: "Event trackId must be a string or null." });
          structurallyValid = false;
        } else if (!trackIds.has(event.trackId)) {
          errors.push({ path: `events.${index}.trackId`, message: `Unknown track id "${event.trackId}".` });
          structurallyValid = false;
        }
      }

      if (typeof event.beat !== "number") {
        errors.push({ path: `events.${index}.beat`, message: "Event beat must be a number." });
        structurallyValid = false;
      } else if (
        !Number.isFinite(event.beat) ||
        event.beat < 0 ||
        (durationBeats !== undefined && event.beat >= durationBeats)
      ) {
        errors.push({
          path: `events.${index}.beat`,
          message:
            durationBeats !== undefined
              ? `Event beat must be a finite number from 0 up to (but not including) ${durationBeats}.`
              : "Event beat must be a finite, non-negative number.",
        });
        structurallyValid = false;
      } else {
        if (previousBeat !== undefined && event.beat < previousBeat) {
          eventsOutOfOrder = true;
        }
        previousBeat = event.beat;
      }

      if (typeof event.type !== "string" || !event.type.trim()) {
        errors.push({ path: `events.${index}.type`, message: "Event type must be a non-empty string." });
        structurallyValid = false;
      }

      if (event.data !== undefined && (!isRecord(event.data) || !isJsonCompatible(event.data))) {
        errors.push({ path: `events.${index}.data`, message: "Event data must be a JSON-compatible object." });
        structurallyValid = false;
      }

      if (event.durationBeats !== undefined || event.value !== undefined) {
        errors.push({
          path: `events.${index}`,
          message: "Event must not include the removed durationBeats/value fields.",
        });
        structurallyValid = false;
      }

      if (structurallyValid && eventValidator) {
        try {
          eventValidator(event as TimelineEvent);
        } catch (error) {
          errors.push({
            path: `events.${index}`,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    if (eventsOutOfOrder) {
      errors.push({ path: "events", message: "Events must be sorted by beat in non-decreasing order." });
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
};

// Immutable update helpers are strict (spec §2): they validate the resulting
// Project and throw rather than silently repairing it. A rejected update
// leaves the input Project value untouched — the candidate is always built
// as a new object via spread, and thrown errors never mutate `project`.
// The one deliberate leniency, explicitly sanctioned by spec §2, is that
// omitting `id` on an added track/event auto-generates one; every other
// defect (duplicate id, dangling trackId, out-of-range beat, non-JSON data,
// removed fields, ...) is rejected by `validateTimelineProject`.

const assertValidTimelineProject = (
  candidate: unknown,
  eventValidator?: TimelineEventValidator,
): TimelineProject => {
  const result = validateTimelineProject(candidate, eventValidator);
  if (!result.ok) {
    throw new TypeError(
      `Invalid TimelineProject: ${result.errors[0]?.path ?? "$"} ${result.errors[0]?.message ?? ""}`.trim(),
    );
  }
  return candidate as TimelineProject;
};

export const addTimelineTrack = (project: TimelineProject, track: Partial<TimelineTrack>): TimelineProject => {
  const id =
    typeof track.id === "string" && track.id.trim().length > 0
      ? track.id.trim()
      : nextAvailableId("track", project.tracks.map((existing) => existing.id));

  return assertValidTimelineProject({
    ...project,
    tracks: [...project.tracks, { ...track, id }],
  });
};

export const removeTimelineTrack = (project: TimelineProject, trackId: string): TimelineProject =>
  assertValidTimelineProject({
    ...project,
    tracks: project.tracks.filter((track) => track.id !== trackId),
    events: project.events.filter((event) => event.trackId !== trackId),
  });

export const setTimelineTrackEnabled = (
  project: TimelineProject,
  trackId: string,
  enabled: boolean,
): TimelineProject =>
  assertValidTimelineProject({
    ...project,
    tracks: project.tracks.map((track) => (track.id === trackId ? { ...track, enabled } : track)),
  });

export const addTimelineEvent = (
  project: TimelineProject,
  event: Partial<TimelineEvent>,
  eventValidator?: TimelineEventValidator,
): TimelineProject => {
  const id =
    typeof event.id === "string" && event.id.trim().length > 0
      ? event.id.trim()
      : nextAvailableId("event", project.events.map((existing) => existing.id));

  return assertValidTimelineProject(
    {
      ...project,
      // Re-sort: validateTimelineProject requires non-decreasing beat order,
      // and the new event is appended, not inserted in beat order.
      events: sortTimelineEvents([...project.events, { ...event, id } as TimelineEvent]),
    },
    eventValidator,
  );
};

export const updateTimelineEvent = (
  project: TimelineProject,
  eventId: string,
  patch: Partial<TimelineEvent>,
  eventValidator?: TimelineEventValidator,
): TimelineProject =>
  assertValidTimelineProject(
    {
      ...project,
      // Re-sort: a beat patch can break the non-decreasing order invariant.
      events: sortTimelineEvents(
        project.events.map((event) => (event.id === eventId ? { ...event, ...patch, id: event.id } : event)),
      ),
    },
    eventValidator,
  );

export const removeTimelineEvent = (project: TimelineProject, eventId: string): TimelineProject =>
  assertValidTimelineProject({
    ...project,
    events: project.events.filter((event) => event.id !== eventId),
  });
