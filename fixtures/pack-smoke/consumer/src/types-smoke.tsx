import {
  createProject,
  migrateArrangementProject,
  migrateTimelineProject,
  validateArrangement,
  validateTimelineProject,
  type ArrangementMigrationOptions,
  type ArrangementProjectV1,
  type PlaybackState,
  type SequenceProject,
  type TimelineMigrationOptions,
  type TimelineProjectV1,
} from "@vixeq/core";
import {
  useSequencerEngine,
  type SequencerEngineHookState,
} from "@vixeq/react";
import {
  SequencePlayer,
  type SequencePlayerProps,
} from "@vixeq/player-react";
import type { ReactElement } from "react";

const project: SequenceProject = createProject({
  bpm: 96,
  stepCount: 16,
  trackCount: 2,
});

const playbackState: PlaybackState = "stopped";

const timelineV1: TimelineProjectV1 = {
  version: 1,
  timing: { tempos: [{ beat: 0, bpm: 120 }], offsetMs: 0 },
  tracks: [{ id: "packed-track", name: "Packed Track", enabled: true }],
  events: [{ id: "packed-event", trackId: "global", beat: 0 }],
};
const timelineOptions: TimelineMigrationOptions = { durationBeats: 4 };
const timelineMigration = migrateTimelineProject(timelineV1, timelineOptions);
if (timelineMigration.ok) {
  validateTimelineProject(timelineMigration.project);
}

const arrangementV1: ArrangementProjectV1 = {
  version: 1,
  bpm: 120,
  patterns: { packed: project },
  sections: [{ id: "packed-section", patternId: "packed", startBeat: 0, endBeat: 4 }],
};
const arrangementOptions: ArrangementMigrationOptions = { durationBeats: 4 };
const arrangementMigration = migrateArrangementProject(arrangementV1, arrangementOptions);
if (arrangementMigration.ok) {
  validateArrangement(arrangementMigration.project);
}

const props: SequencePlayerProps = {
  project,
  onProjectChange: (change) => {
    const nextProject: SequenceProject = change.project;
    void nextProject;
  },
  showTransportControls: playbackState === "stopped",
};

export function HookSmoke(): PlaybackState {
  const state: SequencerEngineHookState = useSequencerEngine({ project });
  return state.playbackState;
}

export const element: ReactElement = <SequencePlayer {...props} />;
