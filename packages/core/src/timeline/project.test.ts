import { describe, expect, it } from "vitest";
import {
  addTimelineEvent,
  addTimelineTrack,
  createTimelineProject,
  normalizeTimelineProject,
  removeTimelineTrack,
  updateTimelineEvent,
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
