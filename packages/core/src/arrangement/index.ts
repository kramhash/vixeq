export { ArrangementEngine, type ArrangementEngineOptions } from "./ArrangementEngine";
export { createArrangement, normalizeArrangement, validateArrangement } from "./project";
export { arrangementDurationBeats, resolveArrangementStep, sampleArrangement, sectionAtBeat, unionTrackIds } from "./resolve";
export type { ResolvedArrangementStep, SectionLookup } from "./resolve";
export type {
  ArrangementEventHandler,
  ArrangementEventMap,
  ArrangementEventName,
  ArrangementProject,
  ArrangementSection,
  ArrangementSectionEvent,
  ArrangementTransportEvent,
  CreateArrangementOptions,
} from "./types";
