import type { TimelineEvent, TimelineProject, TimelineQueryOptions } from "./types";
import { createTimelineEventIndex } from "./eventIndex";

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
): TimelineEvent[] =>
  createTimelineEventIndex(project).getEventsInBeatRange(fromBeat, toBeat, options);

/**
 * Returns the events within `toleranceBeats` of `beat`, inclusive, in order.
 *
 * @param project - The project to query.
 * @param beat - The beat to look at; a non-finite beat returns no events.
 * @param toleranceBeats - How far either side of `beat` counts (default 0).
 * @param options - Track, type, and global-event filters.
 * @returns Matching events.
 */
export const getEventsAtBeat = (
  project: TimelineProject,
  beat: number,
  toleranceBeats = 0,
  options: TimelineQueryOptions = {},
): TimelineEvent[] =>
  createTimelineEventIndex(project).getEventsAtBeat(beat, toleranceBeats, options);

/**
 * Returns up to `count` events at or after `beat`, in order.
 *
 * @param project - The project to query.
 * @param beat - Where to start; a non-finite beat returns no events.
 * @param count - The maximum number of events.
 * @param options - Track, type, and global-event filters.
 * @returns Matching events.
 */
export const getNextEvents = (
  project: TimelineProject,
  beat: number,
  count: number,
  options: TimelineQueryOptions = {},
): TimelineEvent[] =>
  createTimelineEventIndex(project).getNextEvents(beat, count, options);
