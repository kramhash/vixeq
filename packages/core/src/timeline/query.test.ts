import { describe, expect, it } from "vitest";
import {
  addTimelineEvent,
  addTimelineTrack,
  createTimelineProject,
  getEventsAtBeat,
  getEventsInBeatRange,
  getNextEvents,
  setTimelineTrackEnabled,
} from "./index";

const buildProject = () => {
  let project = createTimelineProject({ durationBeats: 8 });
  project = addTimelineTrack(project, { id: "a", name: "A", enabled: true });
  project = addTimelineTrack(project, { id: "b", name: "B", enabled: false });
  project = addTimelineEvent(project, { id: "track-a", trackId: "a", beat: 1, type: "cue" });
  project = addTimelineEvent(project, { id: "track-b", trackId: "b", beat: 2, type: "cue" });
  project = addTimelineEvent(project, { id: "global", trackId: null, beat: 3, type: "marker" });
  return project;
};

describe("TimelineQueryOptions", () => {
  it("TL-Q-001 default options: global events included, disabled-track events excluded", () => {
    const project = buildProject();
    const ids = getEventsInBeatRange(project, 0, 8).map((event) => event.id);

    expect(ids).toContain("global");
    expect(ids).toContain("track-a");
    expect(ids).not.toContain("track-b");
  });

  it("TL-Q-002 includeGlobalEvents false excludes global events regardless of trackIds", () => {
    const project = buildProject();
    const withoutGlobal = getEventsInBeatRange(project, 0, 8, { includeGlobalEvents: false });
    const withoutGlobalAndTrackIds = getEventsInBeatRange(project, 0, 8, {
      includeGlobalEvents: false,
      trackIds: ["a"],
    });

    expect(withoutGlobal.map((event) => event.id)).not.toContain("global");
    expect(withoutGlobalAndTrackIds.map((event) => event.id)).not.toContain("global");
  });

  it("TL-Q-003 trackIds has no effect on global-event inclusion", () => {
    const project = buildProject();
    const ids = getEventsInBeatRange(project, 0, 8, { trackIds: ["a"] }).map((event) => event.id);

    expect(ids).toContain("global");
    expect(ids).toContain("track-a");
    expect(ids).not.toContain("track-b");
  });

  it("TL-Q-004 includeDisabledTracks true includes disabled-track events", () => {
    const project = buildProject();
    const ids = getEventsInBeatRange(project, 0, 8, { includeDisabledTracks: true }).map((event) => event.id);

    expect(ids).toContain("track-b");
  });

  it("TL-Q-005 eventTypes filters across global and track-scoped events alike", () => {
    const project = buildProject();
    const ids = getEventsInBeatRange(project, 0, 8, { eventTypes: ["marker"] }).map((event) => event.id);

    expect(ids).toEqual(["global"]);
  });

  it("getEventsAtBeat and getNextEvents honor the same trackId:null/includeGlobalEvents semantics", () => {
    const project = buildProject();

    expect(getEventsAtBeat(project, 3).map((event) => event.id)).toEqual(["global"]);
    expect(getEventsAtBeat(project, 3, 0, { includeGlobalEvents: false })).toEqual([]);
    expect(getNextEvents(project, 0, 10).map((event) => event.id)).toEqual(["track-a", "global"]);
  });

  it("re-enabling a track surfaces its events again through the default query", () => {
    const project = setTimelineTrackEnabled(buildProject(), "b", true);
    const ids = getEventsInBeatRange(project, 0, 8).map((event) => event.id);

    expect(ids).toContain("track-b");
  });
});

describe("getEventsInBeatRange strict half-open range", () => {
  it("TL-Q-006 returns events in [fromBeat, toBeat)", () => {
    const project = buildProject();

    expect(getEventsInBeatRange(project, 0, 1).map((event) => event.id)).toEqual([]);
    expect(getEventsInBeatRange(project, 1, 2).map((event) => event.id)).toEqual(["track-a"]);
    expect(getEventsInBeatRange(project, 3, 4).map((event) => event.id)).toEqual(["global"]);
  });

  it("TL-Q-007 throws RangeError for a reversed range instead of reordering it", () => {
    const project = buildProject();

    expect(() => getEventsInBeatRange(project, 4, 1)).toThrow(RangeError);
  });

  it("TL-Q-008 throws RangeError for an out-of-bounds or non-finite range instead of clamping it", () => {
    const project = buildProject();

    expect(() => getEventsInBeatRange(project, -1, 4)).toThrow(RangeError);
    expect(() => getEventsInBeatRange(project, 0, project.durationBeats + 1)).toThrow(RangeError);
    expect(() => getEventsInBeatRange(project, 0, Number.NaN)).toThrow(RangeError);
  });
});
