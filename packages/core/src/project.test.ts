import { describe, expect, it } from "vitest";
import { SEQUENCER_LIMITS } from "./limits";
import {
  addTrack,
  clearTrack,
  createProject,
  randomizeTrack,
  removeTrack,
  rotateTrackSteps,
  setStepValue,
  setTrackEnabled,
  toggleStep,
} from "./project";
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

  it("clears a track without changing track metadata", () => {
    let project = createProject({ trackCount: 1, trackNames: ["Gate"] });
    const trackId = project.tracks[0].id;
    project = setTrackEnabled(setStepValue(setStepValue(project, trackId, 0, 1), trackId, 1, 0.5), trackId, false);

    const next = clearTrack(project, trackId);

    expect(next).not.toBe(project);
    expect(next.tracks[0]).toMatchObject({
      id: trackId,
      name: "Gate",
      enabled: false,
    });
    expect(next.tracks[0].steps).toEqual(Array.from({ length: project.stepCount }, () => 0));
  });

  it("returns the same project when clearing a missing track", () => {
    const project = createProject();

    expect(clearTrack(project, "missing")).toBe(project);
  });

  it("rotates track steps right for positive offsets and left for negative offsets", () => {
    let project = createProject({ stepCount: 4, trackCount: 1 });
    const trackId = project.tracks[0].id;
    project = setStepValue(project, trackId, 0, 1);
    project = setStepValue(project, trackId, 1, 0.5);

    const rotatedRight = rotateTrackSteps(project, trackId, 1);
    const rotatedLeft = rotateTrackSteps(project, trackId, -1);

    expect(rotatedRight.tracks[0].steps).toEqual([0, 1, 0.5, 0]);
    expect(rotatedLeft.tracks[0].steps).toEqual([0.5, 0, 0, 1]);
  });

  it("returns the same project when rotating by a full cycle or a missing track", () => {
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const trackId = project.tracks[0].id;

    expect(rotateTrackSteps(project, trackId, 4)).toBe(project);
    expect(rotateTrackSteps(project, "missing", 1)).toBe(project);
  });

  it("randomizes track values with deterministic random input", () => {
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const trackId = project.tracks[0].id;
    const values = [0.2, 0.5, 0.7, 0.1, 0.9, 0.8];
    const next = randomizeTrack(project, trackId, {
      probability: 0.6,
      min: 0.25,
      max: 0.75,
      random: () => values.shift() ?? 0,
    });

    expect(next.tracks[0].steps).toEqual([0.5, 0, 0.7, 0]);
  });

  it("clamps randomize options and swaps inverted ranges", () => {
    const project = createProject({ stepCount: 2, trackCount: 1 });
    const trackId = project.tracks[0].id;
    const values = [0, 0.5, 0, 0.5];
    const next = randomizeTrack(project, trackId, {
      probability: 2,
      min: 0.8,
      max: 0.2,
      random: () => values.shift() ?? 0,
    });

    expect(next.tracks[0].steps).toEqual([0.5, 0.5]);
  });

  it("returns the same project when randomizing a missing track", () => {
    const project = createProject();

    expect(randomizeTrack(project, "missing")).toBe(project);
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

  it("createProject defaults stepsPerBeat to 4", () => {
    const project = createProject();
    expect(project.stepsPerBeat).toBe(4);
  });

  it("createProject accepts and clamps stepsPerBeat", () => {
    expect(createProject({ stepsPerBeat: 2 }).stepsPerBeat).toBe(2);
    expect(createProject({ stepsPerBeat: 8 }).stepsPerBeat).toBe(8);
    expect(createProject({ stepsPerBeat: 0 }).stepsPerBeat).toBe(1);
    expect(createProject({ stepsPerBeat: 999 }).stepsPerBeat).toBe(SEQUENCER_LIMITS.maxStepsPerBeat);
  });

  it("normalizeProject defaults stepsPerBeat to 4 when missing", () => {
    const input = { version: 1, bpm: 120, stepCount: 4, tracks: [] };
    const normalized = normalizeProject(input);
    expect(normalized.stepsPerBeat).toBe(4);
  });

  it("normalizeProject clamps stepsPerBeat", () => {
    const input = { version: 1, bpm: 120, stepCount: 4, stepsPerBeat: 0, tracks: [] };
    expect(normalizeProject(input).stepsPerBeat).toBe(1);

    const input2 = { version: 1, bpm: 120, stepCount: 4, stepsPerBeat: 999, tracks: [] };
    expect(normalizeProject(input2).stepsPerBeat).toBe(SEQUENCER_LIMITS.maxStepsPerBeat);
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

    expect(validateProject(input).ok).toBe(false);

    const normalized = normalizeProject(input);
    expect(normalized.bpm).toBe(SEQUENCER_LIMITS.maxBpm);
    expect(normalized.tracks[0].name).toBe("Track 1");
    expect(normalized.tracks[0].steps).toEqual([0, 0.25, 1, 0]);
    expect(validateProject(normalized).ok).toBe(true);
  });

  it("normalizeProject dedupes duplicate track ids", () => {
    const input = {
      version: 1,
      bpm: 120,
      stepCount: 4,
      tracks: [
        { id: "kick", name: "Kick", enabled: true, steps: [1, 0, 0, 0] },
        { id: "kick", name: "Kick 2", enabled: true, steps: [0, 1, 0, 0] },
      ],
    };

    expect(validateProject(input).ok).toBe(false);

    const normalized = normalizeProject(input);
    const ids = normalized.tracks.map((track) => track.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateProject(normalized).ok).toBe(true);
  });
});
