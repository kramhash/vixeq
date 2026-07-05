import type { SequenceProject, StepEvent, Unsubscribe } from "../types";

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

/** Emitted whenever the active section changes (including transitions to/from a gap, represented as `null`). */
export type ArrangementSectionEvent = {
  section: ArrangementSection | null;
  timestamp: number;
};

export type ArrangementTransportEvent =
  | { type: "start"; timestamp: number }
  | { type: "stop"; timestamp: number }
  | { type: "reset"; beat: 0; timestamp: number }
  | { type: "seek"; beat: number; timestamp: number }
  | { type: "end"; timestamp: number };

export type ArrangementEventMap = {
  step: StepEvent;
  transport: ArrangementTransportEvent;
  section: ArrangementSectionEvent;
};

export type ArrangementEventName = keyof ArrangementEventMap;

export type ArrangementEventHandler<TEventName extends ArrangementEventName> = (
  event: ArrangementEventMap[TEventName],
) => void;

export type { Unsubscribe };
