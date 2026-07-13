import { describe, expect, it } from "vitest";
import { SEQUENCER_LIMITS } from "./limits";
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

  it("reports malformed track fields and step values precisely", () => {
    const result = validateProject({
      version: 2,
      bpm: "fast",
      stepCount: 2.5,
      stepsPerBeat: 1.5,
      tracks: [
        null,
        { id: "", name: 123, enabled: "yes", steps: "bad" },
        { id: "a", name: "A", enabled: true, steps: [0, Number.NaN, 2] },
        { id: "a", name: "A2", enabled: true, steps: [0] },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((issue) => issue.path)).toEqual(expect.arrayContaining([
        "version",
        "bpm",
        "stepCount",
        "stepsPerBeat",
        "tracks.0",
        "tracks.1.id",
        "tracks.1.name",
        "tracks.1.enabled",
        "tracks.1.steps",
        "tracks.2.steps.1",
        "tracks.2.steps.2",
        "tracks.3.id",
      ]));
    }
  });
});

describe("normalizeProject", () => {
  it("returns a valid project from malformed imported data", () => {
    const normalized = normalizeProject({ bpm: Infinity, stepCount: -4, tracks: "bad" });
    expect(validateProject(normalized).ok).toBe(true);
  });

  it("normalizes missing and malformed tracks to the minimum valid project shape", () => {
    const normalized = normalizeProject({
      version: 1,
      bpm: "bad",
      stepCount: Number.NaN,
      stepsPerBeat: Number.NaN,
      tracks: [
        null,
        { id: "", name: "", enabled: "yes", steps: [1, "bad", -1] },
        { id: "", name: "Second", enabled: false, steps: [0.5] },
      ],
    });

    expect(normalized.bpm).toBe(120);
    expect(normalized.stepCount).toBe(SEQUENCER_LIMITS.minStepCount);
    expect(normalized.stepsPerBeat).toBe(SEQUENCER_LIMITS.minStepsPerBeat);
    expect(normalized.tracks).toHaveLength(2);
    expect(normalized.tracks[0]).toMatchObject({ id: "track-1", name: "Track 1", enabled: true });
    expect(normalized.tracks[1]).toMatchObject({ id: "track-2", name: "Second", enabled: false });
    expect(validateProject(normalized).ok).toBe(true);
  });
});
