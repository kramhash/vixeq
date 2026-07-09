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

export type CreateArrangementOptions = {
  timing?: CreateTimingMapOptions | TimingMap;
  durationBeats?: number;
  patterns?: Record<string, SequenceProject>;
  sections?: ArrangementSection[];
};

export type ArrangementProjectV1 = {
  version: 1;
  bpm: number;
  patterns: Record<string, SequenceProject>;
  sections: ArrangementSection[];
};

export type ArrangementMigrationOptions = {
  durationBeats?: number;
};

export type ArrangementMigrationResult = MigrationResult<ArrangementProject>;

export type ArrangementPlaybackSnapshot = EnginePlaybackSnapshot & {
  section: ArrangementSection | null;
};

export type ArrangementPlaybackEvent = Omit<EnginePlaybackEvent, "snapshot"> & {
  snapshot: ArrangementPlaybackSnapshot;
};

export type ArrangementProjectEvent = {
  arrangement: ArrangementProject;
  previousArrangement: ArrangementProject;
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

export type ArrangementEventMap = {
  step: StepEvent;
  playback: ArrangementPlaybackEvent;
  project: ArrangementProjectEvent;
  section: ArrangementSectionEvent;
};

export type ArrangementEventName = keyof ArrangementEventMap;

export type ArrangementEventHandler<TEventName extends ArrangementEventName> = (
  event: ArrangementEventMap[TEventName],
) => void;

export type { Unsubscribe };
