export { ArrangementEngine, type ArrangementEngineOptions } from "./ArrangementEngine";
export { migrateArrangementProject } from "./migration";
export { createArrangement, normalizeArrangement, validateArrangement } from "./project";
export { arrangementDurationBeats, resolveArrangementStep, sampleArrangement, sectionAtBeat, unionTrackIds } from "./resolve";
export type { ResolvedArrangementStep, SectionLookup } from "./resolve";
export type {
  ArrangementEventHandler,
  ArrangementEventMap,
  ArrangementEventName,
  ArrangementMigrationOptions,
  ArrangementMigrationResult,
  ArrangementPlaybackEvent,
  ArrangementPlaybackSnapshot,
  ArrangementProject,
  ArrangementProjectV1,
  ArrangementProjectEvent,
  ArrangementSection,
  ArrangementSectionEvent,
  CreateArrangementOptions,
} from "./types";
