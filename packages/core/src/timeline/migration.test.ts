import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrateTimelineProject, normalizeTimelineProject, validateTimelineProject } from "./index";
import type { TimelineMigrationOptions, TimelineProjectV1 } from "./migration";

type TimelineMigrationFixtures = {
  timeline: {
    valid: {
      project: TimelineProjectV1;
      options: TimelineMigrationOptions;
    };
    removedFields: {
      project: TimelineProjectV1;
      options: TimelineMigrationOptions;
      warningCodes: string[];
    };
    invalidOffset: {
      project: TimelineProjectV1;
      options: TimelineMigrationOptions;
      errorCodes: string[];
    };
  };
};

const migrationFixtures = JSON.parse(
  readFileSync(new URL("../../../../fixtures/migration/v1-to-v2.json", import.meta.url), "utf8"),
) as TimelineMigrationFixtures;

const v1Project = (overrides: Partial<TimelineProjectV1> = {}): TimelineProjectV1 => ({
  version: 1,
  timing: { tempos: [{ beat: 0, bpm: 120 }], offsetMs: 250 },
  tracks: [{ id: "a", name: "A", enabled: true }],
  events: [{ id: "e1", trackId: "a", beat: 0 }],
  ...overrides,
});

describe("migrateTimelineProject", () => {
  it("MIG-001 maps a valid v1 offsetMs to startPositionMs unchanged", () => {
    const result = migrateTimelineProject(v1Project(), { durationBeats: 4 });

    expect(result.ok).toBe(true);
    expect(result.ok && result.project.timing.startPositionMs).toBe(250);
  });

  it("MIG-002 returns ok:false with a MigrationIssue for an invalid v1 offsetMs", () => {
    const result = migrateTimelineProject(
      v1Project({ timing: { tempos: [{ beat: 0, bpm: 120 }], offsetMs: -1 } }),
      { durationBeats: 4 },
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((issue) => issue.path === "timing.offsetMs")).toBe(true);
  });

  it("MIG-003 rewrites trackId \"global\" to null with no warning", () => {
    const result = migrateTimelineProject(
      v1Project({ events: [{ id: "e1", trackId: "global", beat: 0 }] }),
      { durationBeats: 4 },
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.project.events[0].trackId).toBeNull();
    expect(result.ok && result.warnings).toHaveLength(0);
  });

  it("MIG-004 event durationBeats/value present: ok:true with one warning per affected event by default", () => {
    const result = migrateTimelineProject(
      v1Project({
        events: [
          { id: "e1", trackId: "a", beat: 0, durationBeats: 0.5 },
          { id: "e2", trackId: "a", beat: 1, value: 1 },
        ],
      }),
      { durationBeats: 4 },
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings).toHaveLength(2);
    expect(result.ok && result.warnings.every((issue) => issue.code === "TIMELINE_EVENT_REMOVED_FIELD_DROPPED")).toBe(
      true,
    );
    // Migration output must itself satisfy strict v2 validation.
    expect(result.ok && validateTimelineProject(result.project).ok).toBe(true);
  });

  it("MIG-004 onRemovedField can fold the removed fields into data instead of dropping them", () => {
    const result = migrateTimelineProject(
      v1Project({ events: [{ id: "e1", trackId: "a", beat: 0, value: 0.75 }] }),
      {
        durationBeats: 4,
        onRemovedField: (event) => ({ legacyValue: event.value ?? null }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings).toHaveLength(0);
    expect(result.ok && result.project.events[0].data).toEqual({ legacyValue: 0.75 });
    expect(result.ok && validateTimelineProject(result.project).ok).toBe(true);
  });

  it("MIG-004 onRemovedField returning undefined blocks migration with ok:false", () => {
    const result = migrateTimelineProject(
      v1Project({ events: [{ id: "e1", trackId: "a", beat: 0, value: 0.75 }] }),
      { durationBeats: 4, onRemovedField: () => undefined },
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0].code).toBe("TIMELINE_EVENT_REMOVED_FIELD_UNRESOLVED");
  });

  it("MIG-005 track type present: ok:true with one warning per affected track", () => {
    const result = migrateTimelineProject(
      v1Project({ tracks: [{ id: "a", name: "A", enabled: true, type: "sequence" }] }),
      { durationBeats: 4 },
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings).toHaveLength(1);
    expect(result.ok && result.warnings[0].code).toBe("TIMELINE_TRACK_TYPE_DROPPED");
    expect(result.ok && result.project.tracks[0]).not.toHaveProperty("type");
  });

  it("durationBeats is required and cannot be derived from v1 data", () => {
    // @ts-expect-error durationBeats is deliberately omitted to test the required-option guard.
    const result = migrateTimelineProject(v1Project(), {});

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((issue) => issue.code === "TIMELINE_DURATION_BEATS_REQUIRED")).toBe(
      true,
    );
  });

  it("a fully valid migration produces output that satisfies strict validateTimelineProject", () => {
    const result = migrateTimelineProject(v1Project(), { durationBeats: 4 });

    expect(result.ok).toBe(true);
    expect(result.ok && validateTimelineProject(result.project).ok).toBe(true);
  });
});

describe("v1-to-v2 migration fixtures", () => {
  it("migrates the reusable Timeline success fixture into strict v2 output", () => {
    const result = migrateTimelineProject(
      migrationFixtures.timeline.valid.project,
      migrationFixtures.timeline.valid.options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toMatchObject({
      version: 2,
      timing: {
        tempos: migrationFixtures.timeline.valid.project.timing.tempos,
        startPositionMs: 250,
      },
      durationBeats: 8,
    });
    expect(result.project.events.find((event) => event.id === "cue-global")?.trackId).toBeNull();
    expect(result.warnings).toEqual([]);
    expect(validateTimelineProject(result.project).ok).toBe(true);
  });

  it("keeps removed-field migration warnings stable for beta smoke consumers", () => {
    const result = migrateTimelineProject(
      migrationFixtures.timeline.removedFields.project,
      migrationFixtures.timeline.removedFields.options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((warning) => warning.code).sort()).toEqual(
      [...migrationFixtures.timeline.removedFields.warningCodes].sort(),
    );
    expect(result.project.tracks[0]).not.toHaveProperty("type");
    expect(result.project.events[0]).not.toHaveProperty("durationBeats");
    expect(result.project.events[0]).not.toHaveProperty("value");
    expect(validateTimelineProject(result.project).ok).toBe(true);
  });

  it("keeps invalid v1 Timeline fixture errors stable", () => {
    const result = migrateTimelineProject(
      migrationFixtures.timeline.invalidOffset.project,
      migrationFixtures.timeline.invalidOffset.options,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(migrationFixtures.timeline.invalidOffset.errorCodes),
    );
  });
});

describe("MIG-009 normalize*() on already-v2 data", () => {
  it("normalizeTimelineProject does not change version and repairs stay within the v2 schema", () => {
    const v2Input = {
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 8,
      tracks: [{ id: "a", name: "A", enabled: true }],
      events: [{ id: "e1", trackId: "a", beat: 1, type: "cue" }],
    };

    const normalized = normalizeTimelineProject(v2Input);

    expect(normalized.version).toBe(2);
    expect(normalized.durationBeats).toBe(8);
    expect(normalized.events[0]).toMatchObject({ id: "e1", trackId: "a", beat: 1, type: "cue" });

    // Idempotent: normalizing already-valid v2 data twice yields the same result.
    expect(normalizeTimelineProject(normalized)).toEqual(normalized);
  });
});

describe("MIG-010 migrate*() is never invoked implicitly by strict construction", () => {
  it("validateTimelineProject rejects v1-shaped data instead of silently migrating it", () => {
    const result = validateTimelineProject(v1Project());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((issue) => issue.path === "version")).toBe(true);
  });
});
