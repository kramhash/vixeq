import { describe, expect, it } from "vitest";
import { createTimelineEventIndex } from "./eventIndex";
import {
  addTimelineEvent,
  addTimelineTrack,
  createTimelineProject,
  setTimelineTrackEnabled,
} from "./index";
import type { TimelineEvent } from "./types";

const buildProject = () => {
  let project = createTimelineProject({ durationBeats: 8 });
  project = addTimelineTrack(project, { id: "a", name: "A", enabled: true });
  project = addTimelineTrack(project, { id: "b", name: "B", enabled: false });
  project = addTimelineEvent(project, { id: "before", trackId: "a", beat: 0.5, type: "cue" });
  project = addTimelineEvent(project, { id: "same-1", trackId: "a", beat: 1, type: "cue" });
  project = addTimelineEvent(project, { id: "same-2", trackId: "a", beat: 1, type: "marker" });
  project = addTimelineEvent(project, { id: "disabled", trackId: "b", beat: 2, type: "cue" });
  project = addTimelineEvent(project, { id: "global", trackId: null, beat: 3, type: "marker" });
  return project;
};

describe("createTimelineEventIndex", () => {
  it("returns strict half-open ranges while preserving same-beat array order", () => {
    const index = createTimelineEventIndex(buildProject());

    expect(index.getEventsInBeatRange(1, 3).map((event) => event.id)).toEqual(["same-1", "same-2"]);
    expect(index.getEventsInBeatRange(3, 4).map((event) => event.id)).toEqual(["global"]);
    expect(index.getEventsInBeatRangeInclusiveEnd(1, 3).map((event) => event.id)).toEqual([
      "same-1",
      "same-2",
      "global",
    ]);
  });

  it("honors TimelineQueryOptions across indexed range, exact, and next queries", () => {
    const project = buildProject();
    const index = createTimelineEventIndex(project);

    expect(index.getEventsInBeatRange(0, 8).map((event) => event.id)).not.toContain("disabled");
    expect(index.getEventsInBeatRange(0, 8, { includeDisabledTracks: true }).map((event) => event.id)).toContain(
      "disabled",
    );
    expect(index.getEventsAtBeat(3, 0, { includeGlobalEvents: false })).toEqual([]);
    expect(index.getNextEvents(1, 2, { eventTypes: ["marker"] }).map((event) => event.id)).toEqual([
      "same-2",
      "global",
    ]);

    const reenabled = createTimelineEventIndex(setTimelineTrackEnabled(project, "b", true));
    expect(reenabled.getEventsAtBeat(2).map((event) => event.id)).toEqual(["disabled"]);
  });

  it("throws RangeError for invalid half-open range bounds", () => {
    const index = createTimelineEventIndex(buildProject());

    expect(() => index.getEventsInBeatRange(-1, 2)).toThrow(RangeError);
    expect(() => index.getEventsInBeatRange(4, 2)).toThrow(RangeError);
    expect(() => index.getEventsInBeatRange(0, Number.NaN)).toThrow(RangeError);
    expect(() => index.getEventsInBeatRange(0, 9)).toThrow(RangeError);
  });

  it("queries a 100,000 event fixture by beat range without relying on wall-clock thresholds", () => {
    const events: TimelineEvent[] = Array.from({ length: 100_000 }, (_, index) => ({
      id: `event-${index}`,
      trackId: null,
      beat: index / 100,
      type: index % 2 === 0 ? "even" : "odd",
    }));
    const project = createTimelineProject({
      durationBeats: 1_001,
      events,
    });
    const index = createTimelineEventIndex(project);

    const result = index.getEventsInBeatRange(499.95, 500.05);

    expect(result.map((event) => event.id)).toEqual([
      "event-49995",
      "event-49996",
      "event-49997",
      "event-49998",
      "event-49999",
      "event-50000",
      "event-50001",
      "event-50002",
      "event-50003",
      "event-50004",
    ]);
    expect(index.getNextEvents(999.9, 3).map((event) => event.id)).toEqual([
      "event-99990",
      "event-99991",
      "event-99992",
    ]);
  });
});
