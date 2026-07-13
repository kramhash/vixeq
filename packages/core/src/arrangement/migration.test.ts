import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProject } from "../project";
import { validateArrangement } from "./project";
import { migrateArrangementProject } from "./migration";
import type { ArrangementMigrationOptions, ArrangementProjectV1 } from "./types";

type ArrangementMigrationFixtures = {
  arrangement: {
    valid: {
      project: ArrangementProjectV1;
      options: ArrangementMigrationOptions;
    };
    missingDuration: {
      project: ArrangementProjectV1;
      errorCodes: string[];
    };
  };
};

const migrationFixtures = JSON.parse(
  readFileSync(new URL("../../../../fixtures/migration/v1-to-v2.json", import.meta.url), "utf8"),
) as ArrangementMigrationFixtures;

const validV1 = (): ArrangementProjectV1 => ({
  version: 1,
  bpm: 128,
  patterns: { intro: createProject({ stepCount: 4, trackCount: 1 }) },
  sections: [{ id: "s1", patternId: "intro", startBeat: 0, endBeat: 4 }],
});

describe("migrateArrangementProject", () => {
  it("MIG-006 MIG-008 maps v1 bpm to TimingMap and uses explicit durationBeats", () => {
    const result = migrateArrangementProject(validV1(), { durationBeats: 8 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toMatchObject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 128 }], startPositionMs: 0 },
      durationBeats: 8,
    });
    expect(result.project).not.toHaveProperty("bpm");
    expect(validateArrangement(result.project).ok).toBe(true);
  });

  it("MIG-007 returns ok:false without explicit durationBeats", () => {
    const result = migrateArrangementProject(validV1());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatchObject({
      code: "ARRANGEMENT_DURATION_REQUIRED",
      path: "durationBeats",
    });
  });

  it("rejects durationBeats shorter than the largest section endBeat", () => {
    const result = migrateArrangementProject(validV1(), { durationBeats: 2 });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatchObject({
      code: "ARRANGEMENT_DURATION_TOO_SHORT",
      path: "durationBeats",
    });
  });

  it("rejects invalid v1 bpm instead of clamping at the migration boundary", () => {
    const result = migrateArrangementProject({ ...validV1(), bpm: 9999 }, { durationBeats: 8 });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((issue) => issue.path === "bpm")).toBe(true);
  });

  it("rejects invalid v1 patterns and sections", () => {
    const invalidPattern = migrateArrangementProject(
      {
        ...validV1(),
        patterns: { intro: { version: 1, bpm: 120, stepCount: "bad", tracks: [] } },
      },
      { durationBeats: 8 },
    );
    const invalidSection = migrateArrangementProject(
      {
        ...validV1(),
        sections: [{ id: "s1", patternId: "missing", startBeat: 0, endBeat: 4 }],
      },
      { durationBeats: 8 },
    );

    expect(invalidPattern.ok).toBe(false);
    expect(invalidSection.ok).toBe(false);
  });

  it("rejects non-object and wrong-version v1 inputs", () => {
    const nonObject = migrateArrangementProject(null, { durationBeats: 8 });
    const wrongVersion = migrateArrangementProject({ ...validV1(), version: 2 }, { durationBeats: 8 });

    expect(nonObject.ok).toBe(false);
    expect(!nonObject.ok && nonObject.errors[0]).toMatchObject({
      code: "ARRANGEMENT_INVALID",
      path: "$",
    });
    expect(wrongVersion.ok).toBe(false);
    expect(!wrongVersion.ok && wrongVersion.errors.some((issue) => issue.code === "ARRANGEMENT_VERSION")).toBe(
      true,
    );
  });

  it("rejects missing pattern collections and non-array sections", () => {
    const missingPatterns = migrateArrangementProject(
      { ...validV1(), patterns: null } as unknown as ArrangementProjectV1,
      { durationBeats: 8 },
    );
    const nonArraySections = migrateArrangementProject(
      { ...validV1(), sections: "bad" } as unknown as ArrangementProjectV1,
      { durationBeats: 8 },
    );

    expect(missingPatterns.ok).toBe(false);
    expect(!missingPatterns.ok && missingPatterns.errors.some((issue) => issue.code === "ARRANGEMENT_PATTERNS")).toBe(
      true,
    );
    expect(nonArraySections.ok).toBe(false);
    expect(!nonArraySections.ok && nonArraySections.errors.some((issue) => issue.code === "ARRANGEMENT_SECTIONS")).toBe(
      true,
    );
  });

  it("rejects malformed, duplicate, and overlapping sections", () => {
    const malformedSections = migrateArrangementProject(
      {
        ...validV1(),
        sections: [
          "bad",
          { id: "", patternId: "intro", startBeat: -1, endBeat: Number.NaN },
          { id: "dup", patternId: "intro", startBeat: 0, endBeat: 1 },
          { id: "dup", patternId: "intro", startBeat: 2, endBeat: 1 },
        ],
      } as unknown as ArrangementProjectV1,
      { durationBeats: 8 },
    );
    const overlapping = migrateArrangementProject(
      {
        ...validV1(),
        sections: [
          { id: "a", patternId: "intro", startBeat: 0, endBeat: 4 },
          { id: "b", patternId: "intro", startBeat: 3, endBeat: 5 },
        ],
      },
      { durationBeats: 8 },
    );

    expect(malformedSections.ok).toBe(false);
    expect(!malformedSections.ok && malformedSections.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["ARRANGEMENT_SECTION", "ARRANGEMENT_SECTION_ID", "ARRANGEMENT_SECTION_RANGE"]),
    );
    expect(overlapping.ok).toBe(false);
    expect(!overlapping.ok && overlapping.errors.some((issue) => issue.code === "ARRANGEMENT_SECTION_OVERLAP")).toBe(
      true,
    );
  });
});

describe("v1-to-v2 migration fixtures", () => {
  it("migrates the reusable Arrangement success fixture into strict v2 output", () => {
    const result = migrateArrangementProject(
      migrationFixtures.arrangement.valid.project,
      migrationFixtures.arrangement.valid.options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toMatchObject({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 132 }], startPositionMs: 0 },
      durationBeats: 8,
    });
    expect(result.project).not.toHaveProperty("bpm");
    expect(result.warnings).toEqual([]);
    expect(validateArrangement(result.project).ok).toBe(true);
  });

  it("keeps missing-duration Arrangement fixture errors stable", () => {
    const result = migrateArrangementProject(migrationFixtures.arrangement.missingDuration.project);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(migrationFixtures.arrangement.missingDuration.errorCodes),
    );
  });
});
