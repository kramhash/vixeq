import type {
  EnginePlaybackEvent,
  EnginePlaybackSnapshot,
  MigrationResult,
  SequenceProject,
  StepEvent,
  StepEventCause,
  Unsubscribe,
} from "../types";
import type { CreateTimingMapOptions, TimingMap } from "../timeline/types";

/**
 * A single region on the arrangement's beat timeline: play `patternId`
 * (looping it as many times as fit) from `startBeat` up to (excluding)
 * `endBeat`.
 */
export type ArrangementSection = {
  id: string;
  patternId: string;
  startBeat: number;
  endBeat: number;
};

/**
 * A song-level structure: a library of patterns plus sections on a shared
 * tempo-mapped beat timeline. Pattern-local `bpm` values are ignored;
 * `timing` is authoritative for beat-to-position conversion.
 */
export type ArrangementProject = {
  version: 2;
  timing: TimingMap;
  durationBeats: number;
  patterns: Record<string, SequenceProject>;
  sections: ArrangementSection[];
};

/**
 * Options for {@link createArrangement}. Patterns and sections are taken as
 * given; check the result with {@link validateArrangement}.
 */
export type CreateArrangementOptions = {
  timing?: CreateTimingMapOptions | TimingMap;
  durationBeats?: number;
  patterns?: Record<string, SequenceProject>;
  sections?: ArrangementSection[];
};

/**
 * A v1 arrangement (before 0.8), the input of {@link migrateArrangementProject}.
 * Its single `bpm` becomes a one-tempo `timing` in v2.
 */
export type ArrangementProjectV1 = {
  version: 1;
  bpm: number;
  patterns: Record<string, SequenceProject>;
  sections: ArrangementSection[];
};

/**
 * Options for {@link migrateArrangementProject}. v1 has no length, so
 * `durationBeats` is required for a successful migration and must cover the
 * last section's `endBeat`.
 */
export type ArrangementMigrationOptions = {
  durationBeats?: number;
};

/** Result of {@link migrateArrangementProject}. */
export type ArrangementMigrationResult = MigrationResult<ArrangementProject>;

/**
 * An {@link ArrangementEngine} playback snapshot; adds the active `section`,
 * or `null` in a gap.
 */
export type ArrangementPlaybackSnapshot = EnginePlaybackSnapshot & {
  section: ArrangementSection | null;
};

/** An {@link EnginePlaybackEvent} whose snapshot carries the active section. */
export type ArrangementPlaybackEvent = Omit<EnginePlaybackEvent, "snapshot"> & {
  snapshot: ArrangementPlaybackSnapshot;
};

/**
 * Emitted as `"project"` by {@link ArrangementEngine.setProject}: the new and
 * previous project, the preserved position, and the channels whose output
 * changed there.
 */
export type ArrangementProjectEvent = {
  project: ArrangementProject;
  previousProject: ArrangementProject;
  changedChannelIds: string[];
  previousChannels: Record<string, number>;
  channels: Record<string, number>;
  positionMs: number;
  beat: number;
};

/** Emitted whenever the active section changes (including transitions to/from a gap, represented as `null`). */
export type ArrangementSectionEvent = {
  section: ArrangementSection | null;
  beat: number;
  positionMs: number;
  transportPositionMs: number;
  lateByMs: number;
  cause: StepEventCause;
};

/** Payload type of each {@link ArrangementEngine} event, keyed by event name. */
export type ArrangementEventMap = {
  step: StepEvent;
  playback: ArrangementPlaybackEvent;
  project: ArrangementProjectEvent;
  section: ArrangementSectionEvent;
};

/** Event names accepted by {@link ArrangementEngine.on}. */
export type ArrangementEventName = keyof ArrangementEventMap;

/** Listener for one {@link ArrangementEngine} event. */
export type ArrangementEventHandler<TEventName extends ArrangementEventName> = (
  event: ArrangementEventMap[TEventName],
) => void;

export type { Unsubscribe };
