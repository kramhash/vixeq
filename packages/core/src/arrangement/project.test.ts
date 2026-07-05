import { describe, expect, it } from "vitest";
import { createProject } from "../project";
import { createArrangement, normalizeArrangement, validateArrangement } from "./project";

const validPattern = () => createProject({ stepCount: 4, trackCount: 1 });

describe("createArrangement", () => {
  it("fills in defaults", () => {
    const arrangement = createArrangement();
    expect(arrangement).toEqual({ version: 1, bpm: 120, patterns: {}, sections: [] });
  });

  it("clamps bpm to SEQUENCER_LIMITS", () => {
    const arrangement = createArrangement({ bpm: 10_000 });
    expect(arrangement.bpm).toBe(300);
  });
});

describe("validateArrangement", () => {
  it("accepts a well-formed arrangement", () => {
    const intro = validPattern();
    const result = validateArrangement({
      version: 1,
      bpm: 120,
      patterns: { intro },
      sections: [{ id: "s1", patternId: "intro", startBeat: 0, endBeat: 4 }],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a gap between sections", () => {
    const intro = validPattern();
    const result = validateArrangement({
      version: 1,
      bpm: 120,
      patterns: { intro },
      sections: [
        { id: "s1", patternId: "intro", startBeat: 0, endBeat: 4 },
        { id: "s2", patternId: "intro", startBeat: 8, endBeat: 12 },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects overlapping sections", () => {
    const intro = validPattern();
    const result = validateArrangement({
      version: 1,
      bpm: 120,
      patterns: { intro },
      sections: [
        { id: "s1", patternId: "intro", startBeat: 0, endBeat: 8 },
        { id: "s2", patternId: "intro", startBeat: 4, endBeat: 12 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("overlaps"))).toBe(true);
  });

  it("rejects a section referencing an unknown pattern", () => {
    const result = validateArrangement({
      version: 1,
      bpm: 120,
      patterns: {},
      sections: [{ id: "s1", patternId: "missing", startBeat: 0, endBeat: 4 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "sections.0.patternId")).toBe(true);
  });

  it("rejects startBeat >= endBeat", () => {
    const intro = validPattern();
    const result = validateArrangement({
      version: 1,
      bpm: 120,
      patterns: { intro },
      sections: [{ id: "s1", patternId: "intro", startBeat: 4, endBeat: 4 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "sections.0.endBeat")).toBe(true);
  });

  it("rejects bpm outside SEQUENCER_LIMITS", () => {
    const result = validateArrangement({ version: 1, bpm: 5, patterns: {}, sections: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "bpm")).toBe(true);
  });

  it("bubbles up invalid pattern errors with a patterns.<id>.<path> prefix", () => {
    const result = validateArrangement({
      version: 1,
      bpm: 120,
      patterns: { intro: { version: 1, bpm: 120, stepCount: "not-a-number", tracks: [] } },
      sections: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "patterns.intro.stepCount")).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(validateArrangement(null).ok).toBe(false);
    expect(validateArrangement("nope").ok).toBe(false);
  });
});

describe("normalizeArrangement", () => {
  it("returns a default arrangement for non-object input", () => {
    expect(normalizeArrangement(null)).toEqual(createArrangement());
  });

  it("clamps bpm and normalizes patterns", () => {
    const result = normalizeArrangement({
      version: 1,
      bpm: 99999,
      patterns: { intro: { version: 1, bpm: 120, stepCount: 4, tracks: [] } },
      sections: [],
    });
    expect(result.bpm).toBe(300);
    expect(result.patterns.intro.tracks.length).toBeGreaterThan(0);
  });

  it("drops sections referencing an unknown pattern", () => {
    const result = normalizeArrangement({
      version: 1,
      bpm: 120,
      patterns: {},
      sections: [{ id: "s1", patternId: "missing", startBeat: 0, endBeat: 4 }],
    });
    expect(result.sections).toEqual([]);
  });

  it("drops sections with an invalid beat range", () => {
    const intro = validPattern();
    const result = normalizeArrangement({
      version: 1,
      bpm: 120,
      patterns: { intro },
      sections: [{ id: "s1", patternId: "intro", startBeat: 4, endBeat: 2 }],
    });
    expect(result.sections).toEqual([]);
  });

});
