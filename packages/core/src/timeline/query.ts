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

export const getEventsAtBeat = (
  project: TimelineProject,
  beat: number,
  toleranceBeats = 0,
  options: TimelineQueryOptions = {},
): TimelineEvent[] =>
  createTimelineEventIndex(project).getEventsAtBeat(beat, toleranceBeats, options);

export const getNextEvents = (
  project: TimelineProject,
  beat: number,
  count: number,
  options: TimelineQueryOptions = {},
): TimelineEvent[] =>
  createTimelineEventIndex(project).getNextEvents(beat, count, options);
