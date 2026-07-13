import { describe, expect, it } from "vitest";
import {
  addTimelineEvent,
  addTimelineTrack,
  createTimelineProject,
  normalizeTimelineProject,
  removeTimelineTrack,
  updateTimelineEvent,
  removeTimelineEvent,
  setTimelineTrackEnabled,
  validateTimelineProject,
} from "./index";
import * as timelineModule from "./index";
import type { TimelineEvent, TimelineProject } from "./types";

const validProject = (): TimelineProject =>
  createTimelineProject({
    tracks: [{ id: "a", name: "A", enabled: true }],
    events: [{ id: "e1", trackId: "a", beat: 0, type: "cue" }],
    durationBeats: 8,
  });

describe("TimelineProject v2 construction", () => {
  it("TL-001 createTimelineProject with no options produces a minimal valid v2 project", () => {
    const project = createTimelineProject();

    expect(project.version).toBe(2);
    expect(project.durationBeats).toBeGreaterThan(0);
    expect(project.tracks).toEqual([]);
    expect(project.events).toEqual([]);
    expect(validateTimelineProject(project).ok).toBe(true);
  });

  it("TL-002 an event with trackId null is a global event and validates", () => {
    const project = addTimelineEvent(createTimelineProject({ durationBeats: 4 }), {
      trackId: null,
      beat: 1,
      type: "marker",
    });

    expect(project.events[0].trackId).toBeNull();
    expect(validateTimelineProject(project).ok).toBe(true);
  });

  it("normalizes malformed tracks, events, ids, and JSON data deterministically", () => {
    const project = normalizeTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: Number.NaN,
      tracks: [
        null,
        { id: " track-a ", name: "  Track A  ", enabled: false, data: { keep: true, drop: () => 1 } },
        { id: "track-a", name: "", enabled: "yes", data: { nested: [1, undefined, 2] } },
      ],
      events: [
        null,
        { id: " event-a ", trackId: " track-a ", beat: Number.NaN, type: "", data: { keep: 1, drop: undefined } },
        { id: "event-a", trackId: "", beat: 0.5, type: " cue " },
      ],
    });

    expect(project.durationBeats).toBe(4);
    expect(project.tracks).toMatchObject([
      { id: "track-a", name: "Track A", enabled: false, data: { keep: true } },
      { id: "track-1", name: "Track 2", enabled: true, data: { nested: [1, 2] } },
    ]);
    expect(project.events.map((event) => [event.id, event.trackId, event.beat, event.type])).toEqual([
      ["event-a", " track-a ", 0, "event"],
      ["event-1", null, 0.5, " cue "],
    ]);
  });

  it("single-item normalizers generate deterministic standalone ids", () => {
    expect(timelineModule.normalizeTimelineTrack({ name: "A" }).id).toBe("track-1");
    expect(timelineModule.normalizeTimelineEvent({ beat: 2, type: "cue" }).id).toBe("event-1");
  });
});

describe("TimelineProject v2 strict validation", () => {
  it("TL-003 rejects an event whose trackId references a missing track", () => {
    const result = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [{ id: "e1", trackId: "missing", beat: 0, type: "cue" }],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0].path).toBe("events.0.trackId");
  });

  it("TL-004 rejects an event with a missing or empty type", () => {
    const missing = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [{ id: "e1", trackId: null, beat: 0 }],
    });
    const empty = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [{ id: "e1", trackId: null, beat: 0, type: "" }],
    });

    expect(missing.ok).toBe(false);
    expect(empty.ok).toBe(false);
  });

  it("TL-005 rejects an event carrying the removed durationBeats or value fields", () => {
    const withDurationBeats = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [{ id: "e1", trackId: null, beat: 0, type: "cue", durationBeats: 1 }],
    });
    const withValue = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [{ id: "e1", trackId: null, beat: 0, type: "cue", value: 1 }],
    });

    expect(withDurationBeats.ok).toBe(false);
    expect(withValue.ok).toBe(false);
  });

  it("TL-006 rejects a track carrying the removed type field", () => {
    const result = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [{ id: "a", name: "A", enabled: true, type: "sequence" }],
      events: [],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0].path).toBe("tracks.0.type");
  });

  it("TL-007 rejects an event beat outside [0, durationBeats)", () => {
    const atBoundary = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [{ id: "e1", trackId: null, beat: 4, type: "cue" }],
    });
    const negative = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [{ id: "e1", trackId: null, beat: -1, type: "cue" }],
    });

    expect(atBoundary.ok).toBe(false);
    expect(negative.ok).toBe(false);
  });

  it("TL-008 rejects duplicate event ids", () => {
    const result = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [
        { id: "e1", trackId: null, beat: 0, type: "cue" },
        { id: "e1", trackId: null, beat: 1, type: "cue" },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("TL-009 rejects duplicate track ids", () => {
    const result = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [
        { id: "a", name: "A", enabled: true },
        { id: "a", name: "B", enabled: true },
      ],
      events: [],
    });

    expect(result.ok).toBe(false);
  });

  it("TL-013 rejects non-JSON-compatible data, and strict helpers throw for it", () => {
    const result = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [{ id: "e1", trackId: null, beat: 0, type: "cue", data: { fn: () => 1 } }],
    });

    expect(result.ok).toBe(false);

    const project = validProject();
    const invalidData = { trackId: null, beat: 1, type: "cue", data: { fn: () => 1 } } as unknown as Partial<TimelineEvent>;
    expect(() => addTimelineEvent(project, invalidData)).toThrow(TypeError);
  });

  it("TL-013 rejects a non-object data value (data must be a JsonObject, not any JsonValue)", () => {
    const stringData = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [{ id: "e1", trackId: null, beat: 0, type: "cue", data: "not-an-object" }],
    });
    const arrayData = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [{ id: "a", name: "A", enabled: true, data: [1, 2, 3] }],
      events: [],
    });

    expect(stringData.ok).toBe(false);
    expect(arrayData.ok).toBe(false);
  });

  it("TL-014 rejects a non-finite numeric leaf nested inside data", () => {
    const result = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [{ id: "e1", trackId: null, beat: 0, type: "cue", data: { nested: { value: Number.NaN } } }],
    });

    expect(result.ok).toBe(false);
  });

  it("TL-017 rejects non-positive or non-finite durationBeats", () => {
    const zero = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 0,
      tracks: [],
      events: [],
    });
    const nonFinite = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: Number.POSITIVE_INFINITY,
      tracks: [],
      events: [],
    });

    expect(zero.ok).toBe(false);
    expect(nonFinite.ok).toBe(false);
  });

  it("rejects events that are not pre-sorted by beat", () => {
    const result = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [
        { id: "e1", trackId: null, beat: 2, type: "cue" },
        { id: "e2", trackId: null, beat: 1, type: "cue" },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("accepts a fully valid v2 project with a nested TimingMap", () => {
    expect(validateTimelineProject(validProject()).ok).toBe(true);
  });

  it("propagates a nested invalid TimingMap as a path: 'timing' issue", () => {
    const result = validateTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 1, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((issue) => issue.path === "timing")).toBe(true);
  });

  it("rejects non-object projects, malformed arrays, and malformed item fields with precise paths", () => {
    const nonObject = validateTimelineProject(null);
    const malformed = validateTimelineProject({
      version: 2,
      timing: "bad",
      durationBeats: "four",
      tracks: [null, { id: "", enabled: "yes" }],
      events: [null, { id: "", trackId: 123, beat: "zero", type: "" }],
    });

    expect(nonObject.ok).toBe(false);
    expect(!nonObject.ok && nonObject.errors[0].path).toBe("$");
    expect(malformed.ok).toBe(false);
    expect(!malformed.ok && malformed.errors.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "timing",
      "durationBeats",
      "tracks.0",
      "tracks.1.id",
      "tracks.1.name",
      "tracks.1.enabled",
      "events.0",
      "events.1.id",
      "events.1.trackId",
      "events.1.beat",
      "events.1.type",
    ]));
  });
});

describe("TL-010 event ordering", () => {
  it("preserves original array order for events sharing a beat (no secondary sort key)", () => {
    const project = normalizeTimelineProject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      tracks: [],
      events: [
        { id: "z", trackId: null, beat: 0, type: "cue" },
        { id: "a", trackId: null, beat: 0, type: "cue" },
        { id: "m", trackId: null, beat: 0, type: "cue" },
      ],
    });

    expect(project.events.map((event) => event.id)).toEqual(["z", "a", "m"]);
  });
});

describe("TL-011/TL-012 deterministic id generation", () => {
  it("TL-011 assigns event-N using the first unused numeric suffix", () => {
    const project = addTimelineTrack(createTimelineProject({ durationBeats: 4 }), { id: "a", name: "A", enabled: true });
    const withExplicit = addTimelineEvent(project, { id: "event-1", trackId: "a", beat: 0, type: "cue" });
    const withGenerated = addTimelineEvent(withExplicit, { trackId: "a", beat: 1, type: "cue" });

    expect(withGenerated.events.map((event) => event.id)).toEqual(["event-1", "event-2"]);
  });

  it("TL-012 assigns track-N using the first unused numeric suffix", () => {
    const project = addTimelineTrack(createTimelineProject({ durationBeats: 4 }), {
      id: "track-1",
      name: "A",
      enabled: true,
    });
    const withGenerated = addTimelineTrack(project, { name: "B", enabled: true });

    expect(withGenerated.tracks.map((track) => track.id)).toEqual(["track-1", "track-2"]);
  });

  it("id generation is deterministic across repeated calls with the same input (no module-global counter)", () => {
    const base = createTimelineProject({ durationBeats: 4 });
    const first = addTimelineTrack(base, { name: "A", enabled: true }).tracks[0].id;
    const second = addTimelineTrack(base, { name: "A", enabled: true }).tracks[0].id;

    expect(first).toBe(second);
  });
});

describe("TL-015 removing a track removes its events", () => {
  it("drops events belonging to the removed track, keeps others", () => {
    const project = addTimelineEvent(
      addTimelineEvent(
        addTimelineTrack(createTimelineProject({ durationBeats: 4 }), { id: "a", name: "A", enabled: true }),
        { id: "e1", trackId: "a", beat: 0, type: "cue" },
      ),
      { id: "e2", trackId: null, beat: 1, type: "cue" },
    );

    const removed = removeTimelineTrack(project, "a");

    expect(removed.tracks).toHaveLength(0);
    expect(removed.events.map((event) => event.id)).toEqual(["e2"]);
  });
});

describe("TL-016 strict update helpers reject invalid input without mutating the original", () => {
  it("throws and leaves the input Project value unchanged", () => {
    const project = validProject();
    const snapshot = JSON.parse(JSON.stringify(project));

    expect(() => addTimelineEvent(project, { trackId: "missing-track", beat: 0, type: "cue" })).toThrow(TypeError);
    expect(project).toEqual(snapshot);
  });

  it("updateTimelineEvent re-sorts and re-validates after a beat patch", () => {
    const project = addTimelineEvent(validProject(), { id: "e2", trackId: "a", beat: 5, type: "cue" });

    const updated = updateTimelineEvent(project, "e2", { beat: 0.5 });

    expect(updated.events.map((event) => event.id)).toEqual(["e1", "e2"]);
  });

  it("updateTimelineEvent throws when the patch produces an invalid event", () => {
    const project = validProject();

    expect(() => updateTimelineEvent(project, "e1", { beat: 100 })).toThrow(TypeError);
  });

  it("strict helpers validate track enablement and event removal results", () => {
    const disabled = setTimelineTrackEnabled(validProject(), "a", false);
    const removed = removeTimelineEvent(disabled, "e1");

    expect(disabled.tracks[0].enabled).toBe(false);
    expect(removed.events).toEqual([]);
    expect(() => setTimelineTrackEnabled(validProject(), "a", "no" as unknown as boolean)).toThrow(TypeError);
  });

  it("strict helpers pass domain validators through add/update event paths", () => {
    const project = validProject();
    const validator = (event: TimelineEvent): void => {
      if (event.type === "blocked") {
        throw new Error("blocked event");
      }
    };

    expect(() => addTimelineEvent(project, { trackId: "a", beat: 1, type: "blocked" }, validator)).toThrow(TypeError);
    expect(() => updateTimelineEvent(project, "e1", { type: "blocked" }, validator)).toThrow(TypeError);
  });
});

describe("TL-018 sequenceProjectToTimeline no longer exists on the v2 public surface", () => {
  it("has no sequenceProjectToTimeline export", () => {
    expect("sequenceProjectToTimeline" in timelineModule).toBe(false);
  });
});

describe("TL-019/TL-019A/TL-019B domain validation callback", () => {
  it("TL-019 a throwing validator rejects the event, propagating like a structural failure", () => {
    const result = validateTimelineProject(validProject(), (event: TimelineEvent) => {
      if (event.type === "cue") {
        throw new Error("domain-invalid cue");
      }
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0].message).toBe("domain-invalid cue");
  });

  it("TL-019A a non-throwing validator accepts the event", () => {
    const result = validateTimelineProject(validProject(), () => {
      /* accept */
    });

    expect(result.ok).toBe(true);
  });

  it("TL-019B omitting the validator performs no extra domain validation", () => {
    expect(validateTimelineProject(validProject()).ok).toBe(true);
  });

  it("the validator only runs on events that already passed structural checks", () => {
    let calls = 0;
    const result = validateTimelineProject(
      {
        version: 2,
        timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
        durationBeats: 4,
        tracks: [],
        events: [{ id: "e1", trackId: null, beat: 0 /* missing type: structurally invalid */ }],
      },
      () => {
        calls += 1;
      },
    );

    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });
});
