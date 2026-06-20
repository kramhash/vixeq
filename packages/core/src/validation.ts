import { SEQUENCER_LIMITS } from "./limits";
import { clamp, clampStepValue, createProject } from "./project";
import type { SequenceProject, Track, ValidationIssue, ValidationResult } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const validateProject = (input: unknown): ValidationResult => {
  const errors: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ path: "$", message: "Project must be an object." }],
    };
  }

  if (input.version !== 1) {
    errors.push({ path: "version", message: "Version must be 1." });
  }

  if (typeof input.bpm !== "number" || Number.isNaN(input.bpm)) {
    errors.push({ path: "bpm", message: "BPM must be a number." });
  }

  if (!Number.isInteger(input.stepCount)) {
    errors.push({ path: "stepCount", message: "Step count must be an integer." });
  }

  if (input.stepsPerBeat !== undefined && !Number.isInteger(input.stepsPerBeat)) {
    errors.push({ path: "stepsPerBeat", message: "Steps per beat must be an integer." });
  }

  if (!Array.isArray(input.tracks)) {
    errors.push({ path: "tracks", message: "Tracks must be an array." });
  } else {
    input.tracks.forEach((track, trackIndex) => {
      if (!isRecord(track)) {
        errors.push({ path: `tracks.${trackIndex}`, message: "Track must be an object." });
        return;
      }

      if (typeof track.id !== "string") {
        errors.push({ path: `tracks.${trackIndex}.id`, message: "Track id must be a string." });
      }

      if (typeof track.name !== "string") {
        errors.push({ path: `tracks.${trackIndex}.name`, message: "Track name must be a string." });
      }

      if (typeof track.enabled !== "boolean") {
        errors.push({ path: `tracks.${trackIndex}.enabled`, message: "Track enabled must be a boolean." });
      }

      if (!Array.isArray(track.steps)) {
        errors.push({ path: `tracks.${trackIndex}.steps`, message: "Track steps must be an array." });
      } else {
        track.steps.forEach((step, stepIndex) => {
          if (typeof step !== "number" || Number.isNaN(step)) {
            errors.push({
              path: `tracks.${trackIndex}.steps.${stepIndex}`,
              message: "Step value must be a number.",
            });
          }
        });
      }
    });
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
};

export const normalizeProject = (input: unknown): SequenceProject => {
  if (!isRecord(input)) {
    return createProject();
  }

  const stepCount = clamp(
    Math.trunc(typeof input.stepCount === "number" ? input.stepCount : SEQUENCER_LIMITS.defaultStepCount),
    SEQUENCER_LIMITS.minStepCount,
    SEQUENCER_LIMITS.maxStepCount,
  );

  const stepsPerBeat = clamp(
    Math.trunc(typeof input.stepsPerBeat === "number" ? input.stepsPerBeat : SEQUENCER_LIMITS.defaultStepsPerBeat),
    SEQUENCER_LIMITS.minStepsPerBeat,
    SEQUENCER_LIMITS.maxStepsPerBeat,
  );

  const rawTracks = Array.isArray(input.tracks) ? input.tracks : [];
  const tracks = rawTracks
    .filter(isRecord)
    .slice(0, SEQUENCER_LIMITS.maxTracks)
    .map((track, index): Track => {
      const rawSteps = Array.isArray(track.steps) ? track.steps : [];

      return {
        id: typeof track.id === "string" && track.id.trim() ? track.id : `track-${index + 1}`,
        name: typeof track.name === "string" && track.name.trim() ? track.name.trim() : `Track ${index + 1}`,
        enabled: typeof track.enabled === "boolean" ? track.enabled : true,
        steps: Array.from({ length: stepCount }, (_, stepIndex) => {
          const rawStep = rawSteps[stepIndex];
          return typeof rawStep === "number" ? clampStepValue(rawStep) : 0;
        }),
      };
    });

  const fallback = createProject({ stepCount });

  return {
    version: 1,
    bpm: clamp(
      typeof input.bpm === "number" ? input.bpm : SEQUENCER_LIMITS.defaultBpm,
      SEQUENCER_LIMITS.minBpm,
      SEQUENCER_LIMITS.maxBpm,
    ),
    stepCount,
    stepsPerBeat,
    tracks:
      tracks.length >= SEQUENCER_LIMITS.minTracks
        ? tracks
        : fallback.tracks.slice(0, SEQUENCER_LIMITS.minTracks),
  };
};
