import { describe, expect, it } from "vitest";
import { createProject, setStepValue } from "../project";
import {
  addTimelineEvent,
  createTimelineProject,
  getEventsAtBeat,
  getEventsInBeatRange,
  getNextEvents,
  sequenceProjectToTimeline,
  setTimelineTrackEnabled,
  updateTimelineEvent,
} from "./index";

describe("timeline project and query", () => {
  it("keeps events sorted and queries half-open beat ranges", () => {
    const project = createTimelineProject({
      timing: { bpm: 120 },
      tracks: [{ id: "a", name: "A", enabled: true }],
      events: [
        { id: "e2", trackId: "a", beat: 1, value: 1 },
        { id: "e1", trackId: "a", beat: 0, value: 0.5 },
        { id: "e3", trackId: "a", beat: 2, value: 1 },
      ],
    });

    expect(project.events.map((event) => event.id)).toEqual(["e1", "e2", "e3"]);
    expect(getEventsInBeatRange(project, 0, 1).map((event) => event.id)).toEqual(["e1"]);
    expect(getEventsInBeatRange(project, 1, 2).map((event) => event.id)).toEqual(["e2"]);
  });

  it("filters disabled tracks by default", () => {
    const project = setTimelineTrackEnabled(
      createTimelineProject({
        tracks: [{ id: "a", name: "A", enabled: true }],
        events: [{ id: "e1", trackId: "a", beat: 0 }],
      }),
      "a",
      false,
    );

    expect(getEventsAtBeat(project, 0)).toEqual([]);
    expect(getEventsAtBeat(project, 0, 0, { includeDisabledTracks: true })).toHaveLength(1);
  });

  it("adds and updates events immutably", () => {
    const project = createTimelineProject({
      tracks: [{ id: "a", name: "A", enabled: true }],
    });
    const withEvent = addTimelineEvent(project, { id: "e1", trackId: "a", beat: 2, value: 2 });
    const updated = updateTimelineEvent(withEvent, "e1", { beat: 1, value: 0.25 });

    expect(project.events).toHaveLength(0);
    expect(withEvent.events[0].value).toBe(1);
    expect(getNextEvents(updated, 0, 1)[0]).toMatchObject({ beat: 1, value: 0.25 });
  });
});

describe("sequenceProjectToTimeline", () => {
  it("converts active sequence steps to beat-based timeline events", () => {
    let sequence = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
    sequence = setStepValue(sequence, sequence.tracks[0].id, 0, 1);
    sequence = setStepValue(sequence, sequence.tracks[0].id, 2, 0.5);

    const timeline = sequenceProjectToTimeline(sequence);

    expect(timeline.timing.tempos).toEqual([{ beat: 0, bpm: 120 }]);
    expect(timeline.events).toEqual([
      {
        id: `${sequence.tracks[0].id}-step-0`,
        trackId: sequence.tracks[0].id,
        beat: 0,
        durationBeats: 0.25,
        value: 1,
        type: "step",
      },
      {
        id: `${sequence.tracks[0].id}-step-2`,
        trackId: sequence.tracks[0].id,
        beat: 0.5,
        durationBeats: 0.25,
        value: 0.5,
        type: "step",
      },
    ]);
  });
});
