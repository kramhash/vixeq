export { ArrangementEngine, type ArrangementEngineOptions } from "./ArrangementEngine";
export { createArrangement, normalizeArrangement, validateArrangement } from "./project";
export { arrangementDurationBeats, resolveArrangementStep, sampleArrangement, sectionAtBeat, unionTrackIds } from "./resolve";
export type { ResolvedArrangementStep, SectionLookup } from "./resolve";
export type {
  ArrangementEventHandler,
  ArrangementEventMap,
  ArrangementEventName,
  ArrangementPlaybackEvent,
  ArrangementPlaybackSnapshot,
  ArrangementProject,
  ArrangementProjectEvent,
  ArrangementSection,
  ArrangementSectionEvent,
  CreateArrangementOptions,
} from "./types";
