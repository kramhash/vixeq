import type { MigrationIssue, MigrationResult } from "../types";
import { isRecord, sortTimelineEvents, toJsonCompatible } from "./project";
import type { JsonObject, TimelineEvent, TimelineProject, TimelineTrack } from "./types";

// Legacy v1 shapes: the v1 TimelineProject type itself no longer exists
// (replaced by v2). These describe only what migration needs to read from
// existing v1-schema data. Fields are trusted to already match this shape
// structurally; migration does not re-validate v1 structural correctness
// beyond the specific fields it transforms. Exported (rather than kept
// module-private) because they are reachable through the public
// `TimelineProjectV1` parameter type below, so callers can type their
// pre-migration data.

export type TempoEventV1 = { beat: number; bpm: number };
export type TimingMapV1 = { tempos: TempoEventV1[]; offsetMs: number };
export type TimelineTrackV1 = { id: string; name: string; enabled: boolean; type?: string; data?: Record<string, unknown> };
export type TimelineEventV1 = {
  id: string;
  trackId: string;
  beat: number;
  durationBeats?: number;
  value?: number;
  type?: string;
  data?: Record<string, unknown>;
};

export type TimelineProjectV1 = {
  version: 1;
  timing: TimingMapV1;
  tracks: TimelineTrackV1[];
  events: TimelineEventV1[];
};

export type TimelineMigrationOptions = {
  /** Required: v1 has no durationBeats field, so it can never be derived. */
  durationBeats: number;
  /**
   * Called once per event that carries a removed field (`durationBeats`
   * and/or `value`). Return a `JsonObject` to fold that data into the
   * migrated event's `data`. Return `undefined` (or omit this option) to
   * drop the removed fields with a warning instead of an error.
   */
  onRemovedField?: (event: TimelineEventV1) => JsonObject | undefined;
};

const migrateEvent = (
  event: TimelineEventV1,
  index: number,
  options: TimelineMigrationOptions,
): { event: TimelineEvent; warning?: MigrationIssue } | { error: MigrationIssue } => {
  const hasRemovedFields = event.durationBeats !== undefined || event.value !== undefined;
  let extraData: JsonObject | undefined;
  let warning: MigrationIssue | undefined;

  if (hasRemovedFields) {
    if (options.onRemovedField) {
      const converted = options.onRemovedField(event);
      if (converted === undefined) {
        return {
          error: {
            code: "TIMELINE_EVENT_REMOVED_FIELD_UNRESOLVED",
            message: `Event "${event.id}" carries removed fields (durationBeats/value) that onRemovedField could not resolve.`,
            path: `events.${index}`,
          },
        };
      }
      extraData = converted;
    } else {
      warning = {
        code: "TIMELINE_EVENT_REMOVED_FIELD_DROPPED",
        message: `Event "${event.id}"'s removed fields (durationBeats/value) were dropped.`,
        path: `events.${index}`,
      };
    }
  }

  const baseData = isRecord(event.data) ? (toJsonCompatible(event.data) as JsonObject) : undefined;
  const data = extraData ? { ...(baseData ?? {}), ...extraData } : baseData;

  const migratedEvent: TimelineEvent = {
    id: event.id,
    trackId: event.trackId === "global" ? null : event.trackId,
    beat: event.beat,
    type: typeof event.type === "string" && event.type.trim() ? event.type : "event",
    ...(data ? { data } : {}),
  };

  return { event: migratedEvent, warning };
};

/**
 * Migrates a v1 `TimelineProject` to v2 (spec §5). `offsetMs` maps to
 * `startPositionMs` only when valid; `"global"` maps to `null` with no
 * warning; `TimelineTrack.type` is dropped with a warning per affected
 * track; `TimelineEvent.durationBeats`/`value` are dropped with a warning
 * by default, or folded into `data` via `options.onRemovedField`, or block
 * migration with an error when that callback cannot resolve them.
 * `durationBeats` has no v1 source and always requires an explicit option.
 */
export const migrateTimelineProject = (
  project: TimelineProjectV1,
  options: TimelineMigrationOptions,
): MigrationResult<TimelineProject> => {
  const errors: MigrationIssue[] = [];
  const warnings: MigrationIssue[] = [];

  if (!Number.isFinite(options.durationBeats) || options.durationBeats <= 0) {
    errors.push({
      code: "TIMELINE_DURATION_BEATS_REQUIRED",
      message: "options.durationBeats must be a finite number greater than 0; it cannot be derived from a v1 TimelineProject.",
      path: "durationBeats",
    });
  }

  let startPositionMs: number | undefined;
  const offsetMs = project.timing?.offsetMs;
  if (typeof offsetMs === "number" && Number.isFinite(offsetMs) && offsetMs >= 0) {
    startPositionMs = offsetMs;
  } else {
    errors.push({
      code: "TIMELINE_INVALID_OFFSET_MS",
      message: "timing.offsetMs must be a finite, non-negative number to migrate to startPositionMs.",
      path: "timing.offsetMs",
    });
  }

  const migratedTracks: TimelineTrack[] = [];
  (project.tracks ?? []).forEach((track, index) => {
    if (track.type !== undefined) {
      warnings.push({
        code: "TIMELINE_TRACK_TYPE_DROPPED",
        message: `Track "${track.id}"'s removed type field ("${track.type}") was dropped.`,
        path: `tracks.${index}.type`,
      });
    }

    migratedTracks.push({
      id: track.id,
      name: track.name,
      enabled: track.enabled,
      ...(isRecord(track.data) ? { data: toJsonCompatible(track.data) as JsonObject } : {}),
    });
  });

  const migratedEvents: TimelineEvent[] = [];
  (project.events ?? []).forEach((event, index) => {
    const result = migrateEvent(event, index, options);
    if ("error" in result) {
      errors.push(result.error);
      return;
    }
    migratedEvents.push(result.event);
    if (result.warning) {
      warnings.push(result.warning);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const migrated: TimelineProject = {
    version: 2,
    timing: { tempos: project.timing.tempos, startPositionMs: startPositionMs as number },
    durationBeats: options.durationBeats,
    tracks: migratedTracks,
    events: sortTimelineEvents(migratedEvents),
  };

  return { ok: true, project: migrated, warnings };
};
