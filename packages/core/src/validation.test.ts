import { describe, expect, it } from "vitest";
import { createProject } from "./project";
import { normalizeProject, validateProject } from "./validation";

describe("validateProject", () => {
  it("accepts a generated project", () => {
    expect(validateProject(createProject()).ok).toBe(true);
  });

  it("reports invalid bounds and malformed tracks with paths", () => {
    const result = validateProject({ version: 1, bpm: 0, stepCount: 0, stepsPerBeat: 0, tracks: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((issue) => issue.path)).toEqual(expect.arrayContaining(["bpm", "stepCount", "stepsPerBeat", "tracks"]));
  });
});

describe("normalizeProject", () => {
  it("returns a valid project from malformed imported data", () => {
    const normalized = normalizeProject({ bpm: Infinity, stepCount: -4, tracks: "bad" });
    expect(validateProject(normalized).ok).toBe(true);
  });
});
