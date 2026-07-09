import {
  createProject,
  type PlaybackState,
  type SequenceProject,
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
