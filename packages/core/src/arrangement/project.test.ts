import { describe, expect, it } from "vitest";
import { createProject } from "../project";
import { createArrangement, normalizeArrangement, validateArrangement } from "./project";

const validPattern = () => createProject({ stepCount: 4, trackCount: 1 });

describe("createArrangement", () => {
  it("AR-001 fills in minimal v2 defaults", () => {
    const arrangement = createArrangement();

    expect(arrangement).toEqual({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      patterns: {},
      sections: [],
    });
  });

  it("accepts TimingMap-style options", () => {
    const arrangement = createArrangement({ timing: { bpm: 90, startPositionMs: 250 }, durationBeats: 8 });

    expect(arrangement.timing).toEqual({ tempos: [{ beat: 0, bpm: 90 }], startPositionMs: 250 });
    expect(arrangement.durationBeats).toBe(8);
  });

  it("falls back to default duration for invalid duration options", () => {
    expect(createArrangement({ durationBeats: Number.NaN }).durationBeats).toBe(4);
    expect(createArrangement({ durationBeats: -1 }).durationBeats).toBe(4);
  });
});

describe("validateArrangement", () => {
  it("accepts a well-formed v2 arrangement with a trailing gap", () => {
    const intro = validPattern();
    const result = validateArrangement({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 8,
      patterns: { intro },
      sections: [{ id: "s1", patternId: "intro", startBeat: 0, endBeat: 4 }],
    });

    expect(result.ok).toBe(true);
  });

  it("AR-002 rejects a legacy bpm field instead of migrating it", () => {
    const result = validateArrangement({
      version: 2,
      bpm: 120,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      patterns: {},
      sections: [],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((issue) => issue.path === "bpm")).toBe(true);
  });

  it("AR-003 rejects missing, non-positive, or non-finite durationBeats", () => {
    const missing = validateArrangement({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      patterns: {},
      sections: [],
    });
    const zero = validateArrangement({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 0,
      patterns: {},
      sections: [],
    });

    expect(missing.ok).toBe(false);
    expect(zero.ok).toBe(false);
  });

  it("rejects non-object input, malformed collections, duplicate ids, and invalid section ranges", () => {
    const intro = validPattern();
    const nonObject = validateArrangement(null);
    const malformedCollections = validateArrangement({
      version: 2,
      timing: "bad",
      durationBeats: "four",
      patterns: "bad",
      sections: "bad",
    });
    const duplicateAndInvalidSections = validateArrangement({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 8,
      patterns: { intro },
      sections: [
        { id: "", patternId: "intro", startBeat: -1, endBeat: 1 },
        { id: "dup", patternId: "intro", startBeat: 1, endBeat: 1 },
        { id: "dup", patternId: "intro", startBeat: Number.NaN, endBeat: Number.NaN },
      ],
    });

    expect(nonObject.ok).toBe(false);
    expect(!nonObject.ok && nonObject.errors[0].path).toBe("$");
    expect(malformedCollections.ok).toBe(false);
    expect(!malformedCollections.ok && malformedCollections.errors.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "timing",
      "durationBeats",
      "patterns",
      "sections",
    ]));
    expect(duplicateAndInvalidSections.ok).toBe(false);
    expect(!duplicateAndInvalidSections.ok && duplicateAndInvalidSections.errors.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "sections.0.id",
      "sections.0.startBeat",
      "sections.1.endBeat",
      "sections.2.id",
      "sections.2.startBeat",
      "sections.2.endBeat",
    ]));
  });

  it("AR-005 rejects sections outside [0, durationBeats]", () => {
    const intro = validPattern();
    const result = validateArrangement({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      patterns: { intro },
      sections: [{ id: "s1", patternId: "intro", startBeat: 0, endBeat: 5 }],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((issue) => issue.path === "sections.0.endBeat")).toBe(true);
  });

  it("AR-006 rejects overlapping sections", () => {
    const intro = validPattern();
    const result = validateArrangement({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 12,
      patterns: { intro },
      sections: [
        { id: "s1", patternId: "intro", startBeat: 0, endBeat: 8 },
        { id: "s2", patternId: "intro", startBeat: 4, endBeat: 12 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((issue) => issue.message.includes("overlaps"))).toBe(true);
  });

  it("rejects unknown patterns and invalid nested SequenceProject data", () => {
    const unknown = validateArrangement({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      patterns: {},
      sections: [{ id: "s1", patternId: "missing", startBeat: 0, endBeat: 4 }],
    });
    const badPattern = validateArrangement({
      version: 2,
      timing: { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      patterns: { intro: { version: 1, bpm: 120, stepCount: "not-a-number", tracks: [] } },
      sections: [],
    });

    expect(unknown.ok).toBe(false);
    expect(badPattern.ok).toBe(false);
  });

  it("rejects invalid timing", () => {
    const result = validateArrangement({
      version: 2,
      timing: { tempos: [{ beat: 1, bpm: 120 }], startPositionMs: 0 },
      durationBeats: 4,
      patterns: {},
      sections: [],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((issue) => issue.path === "timing")).toBe(true);
  });
});

describe("normalizeArrangement", () => {
  it("MIG-009 returns a default v2 arrangement for non-object or wrong-version input", () => {
    expect(normalizeArrangement(null)).toEqual(createArrangement());
    expect(normalizeArrangement({ version: 1, bpm: 120 })).toEqual(createArrangement());
  });

  it("repairs only v2 schema fields", () => {
    const intro = validPattern();
    const result = normalizeArrangement({
      version: 2,
      timing: { tempos: [{ beat: 1, bpm: 90 }], startPositionMs: -1 },
      durationBeats: 8,
      patterns: { intro },
      sections: [
        { id: "s1", patternId: "intro", startBeat: 0, endBeat: 4 },
        { id: "too-long", patternId: "intro", startBeat: 7, endBeat: 9 },
        { id: "missing", patternId: "missing", startBeat: 0, endBeat: 1 },
      ],
    });

    expect(result.version).toBe(2);
    expect(result.timing).toEqual({ tempos: [{ beat: 0, bpm: 90 }, { beat: 1, bpm: 90 }], startPositionMs: 0 });
    expect(result.sections.map((section) => section.id)).toEqual(["s1"]);
  });

  it("normalizes malformed patterns and sections without preserving invalid section data", () => {
    const result = normalizeArrangement({
      version: 2,
      durationBeats: Number.NaN,
      patterns: {
        intro: { version: 1, bpm: 999, stepCount: 2, tracks: [] },
      },
      sections: [
        null,
        { patternId: "intro", startBeat: -1, endBeat: 1 },
        { id: "bad-end", patternId: "intro", startBeat: 2, endBeat: 1 },
      ],
    });

    expect(result.durationBeats).toBe(4);
    expect(result.patterns.intro.stepCount).toBe(2);
    expect(result.sections).toEqual([
      { id: "section-1", patternId: "intro", startBeat: 0, endBeat: 1 },
    ]);
  });
});
