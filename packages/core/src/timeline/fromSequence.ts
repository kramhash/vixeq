import type { SequenceProject } from "../types";
import { createTimingMap } from "./timing";
import { normalizeTimelineProject } from "./project";
import type { SequenceToTimelineOptions, TimelineProject } from "./types";

export const sequenceProjectToTimeline = (
  project: SequenceProject,
  options: SequenceToTimelineOptions = {},
): TimelineProject => {
  const threshold = options.threshold ?? 0;
  const eventType = options.eventType ?? "step";
  const beatsPerStep = 4 / project.stepCount;

  return normalizeTimelineProject({
    version: 1,
    timing: createTimingMap({ bpm: project.bpm }),
    tracks: project.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      enabled: track.enabled,
      type: "sequence",
    })),
    events: project.tracks.flatMap((track) =>
      track.steps.flatMap((value, stepIndex) => {
        if (!track.enabled || value <= threshold) {
          return [];
        }

        return [
          {
            id: `${track.id}-step-${stepIndex}`,
            trackId: track.id,
            beat: stepIndex * beatsPerStep,
            durationBeats: beatsPerStep,
            value,
            type: eventType,
          },
        ];
      }),
    ),
  });
};
