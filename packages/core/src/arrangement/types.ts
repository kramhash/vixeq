import type {
  EnginePlaybackEvent,
  EnginePlaybackSnapshot,
  SequenceProject,
  StepEvent,
  StepEventCause,
  Unsubscribe,
} from "../types";

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
 * A song-level structure: a library of patterns plus a list of sections
 * that place them on a shared beat timeline. Unlike SequenceProject,
 * an ArrangementProject is not itself a single loop — sections are
 * resolved at runtime by ArrangementEngine.
 *
 * Each pattern's own `bpm` is ignored; the arrangement's `bpm` is the
 * single source of truth for beat→ms conversion. Sections must not
 * overlap (see validateArrangement); gaps between sections output 0 on
 * every channel.
 */
export type ArrangementProject = {
  version: 1;
  bpm: number;
  patterns: Record<string, SequenceProject>;
  sections: ArrangementSection[];
};

export type CreateArrangementOptions = {
  bpm?: number;
  patterns?: Record<string, SequenceProject>;
  sections?: ArrangementSection[];
};

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
