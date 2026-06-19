import { describe, expect, it } from "vitest";
import { SEQUENCER_LIMITS } from "./limits";
import { addTrack, createProject, removeTrack, setStepValue, setTrackEnabled, toggleStep } from "./project";
import { normalizeProject, validateProject } from "./validation";

describe("project utilities", () => {
  it("creates a normalized default project", () => {
    const project = createProject();

    expect(project.bpm).toBe(SEQUENCER_LIMITS.defaultBpm);
    expect(project.stepCount).toBe(16);
    expect(project.tracks).toHaveLength(4);
    expect(project.tracks[0].steps).toHaveLength(16);
  });

  it("updates step values immutably and clamps values", () => {
    const project = createProject({ trackCount: 1 });
    const trackId = project.tracks[0].id;
    const next = setStepValue(project, trackId, 0, 1.5);

    expect(next).not.toBe(project);
    expect(next.tracks[0].steps[0]).toBe(1);
    expect(project.tracks[0].steps[0]).toBe(0);
  });

  it("toggles any positive value back to zero", () => {
    const project = createProject({ trackCount: 1 });
    const trackId = project.tracks[0].id;

    const on = toggleStep(project, trackId, 2);
    const off = toggleStep(on, trackId, 2);

    expect(on.tracks[0].steps[2]).toBe(1);
    expect(off.tracks[0].steps[2]).toBe(0);
  });

  it("adds, removes, and disables tracks", () => {
    const project = createProject({ trackCount: 1 });
    const withTrack = addTrack(project, "Control");
    const disabled = setTrackEnabled(withTrack, withTrack.tracks[1].id, false);
    const removed = removeTrack(disabled, withTrack.tracks[1].id);

    expect(withTrack.tracks).toHaveLength(2);
    expect(disabled.tracks[1].enabled).toBe(false);
    expect(removed.tracks).toHaveLength(1);
  });

  it("validates project shape and normalizes importable data", () => {
    const input = {
      version: 1,
      bpm: 999,
      stepCount: 4,
      tracks: [
        {
          id: "a",
          name: "",
          enabled: true,
          steps: [-1, 0.25, 2],
        },
      ],
    };

    expect(validateProject(input).ok).toBe(true);

    const normalized = normalizeProject(input);
    expect(normalized.bpm).toBe(SEQUENCER_LIMITS.maxBpm);
    expect(normalized.tracks[0].name).toBe("Track 1");
    expect(normalized.tracks[0].steps).toEqual([0, 0.25, 1, 0]);
  });
});
