import { SEQUENCER_LIMITS } from "./limits";
import type { SequenceProject, StepValue, Track } from "./types";

export type CreateProjectOptions = {
  bpm?: number;
  stepCount?: number;
  stepsPerBeat?: number;
  trackCount?: number;
  trackNames?: string[];
};

export type RandomizeTrackOptions = {
  probability?: number;
  min?: number;
  max?: number;
  random?: () => number;
};

let idCounter = 0;

export const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
};

export const clampStepValue = (value: number): StepValue => clamp(value, 0, 1);

export const createTrackId = (): string => {
  idCounter += 1;
  return `track-${idCounter}`;
};

export const createTrack = (options: {
  name?: string;
  stepCount?: number;
  steps?: number[];
  enabled?: boolean;
} = {}): Track => {
  const stepCount = clamp(
    Math.trunc(options.stepCount ?? SEQUENCER_LIMITS.defaultStepCount),
    SEQUENCER_LIMITS.minStepCount,
    SEQUENCER_LIMITS.maxStepCount,
  );

  return {
    id: createTrackId(),
    name: options.name?.trim() || "Track",
    enabled: options.enabled ?? true,
    steps: Array.from({ length: stepCount }, (_, index) => clampStepValue(options.steps?.[index] ?? 0)),
  };
};

export const createProject = (options: CreateProjectOptions = {}): SequenceProject => {
  const stepCount = clamp(
    Math.trunc(options.stepCount ?? SEQUENCER_LIMITS.defaultStepCount),
    SEQUENCER_LIMITS.minStepCount,
    SEQUENCER_LIMITS.maxStepCount,
  );
  const stepsPerBeat = clamp(
    Math.trunc(options.stepsPerBeat ?? SEQUENCER_LIMITS.defaultStepsPerBeat),
    SEQUENCER_LIMITS.minStepsPerBeat,
    SEQUENCER_LIMITS.maxStepsPerBeat,
  );
  const trackCount = clamp(
    Math.trunc(options.trackCount ?? SEQUENCER_LIMITS.defaultTrackCount),
    SEQUENCER_LIMITS.minTracks,
    SEQUENCER_LIMITS.maxTracks,
  );

  return {
    version: 1,
    bpm: clamp(options.bpm ?? SEQUENCER_LIMITS.defaultBpm, SEQUENCER_LIMITS.minBpm, SEQUENCER_LIMITS.maxBpm),
    stepCount,
    stepsPerBeat,
    tracks: Array.from({ length: trackCount }, (_, index) =>
      createTrack({
        name: options.trackNames?.[index] ?? `Track ${index + 1}`,
        stepCount,
      }),
    ),
  };
};

const updateTrack = (
  project: SequenceProject,
  trackId: string,
  updater: (track: Track) => Track,
): SequenceProject => ({
  ...project,
  tracks: project.tracks.map((track) => (track.id === trackId ? updater(track) : track)),
});

export const setStepValue = (
  project: SequenceProject,
  trackId: string,
  stepIndex: number,
  value: number,
): SequenceProject => {
  if (stepIndex < 0 || stepIndex >= project.stepCount) {
    return project;
  }

  return updateTrack(project, trackId, (track) => ({
    ...track,
    steps: track.steps.map((step, index) => (index === stepIndex ? clampStepValue(value) : step)),
  }));
};

export const toggleStep = (project: SequenceProject, trackId: string, stepIndex: number): SequenceProject => {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    return project;
  }

  return setStepValue(project, trackId, stepIndex, track.steps[stepIndex] > 0 ? 0 : 1);
};

export const clearTrack = (project: SequenceProject, trackId: string): SequenceProject => {
  if (!project.tracks.some((track) => track.id === trackId)) {
    return project;
  }

  return updateTrack(project, trackId, (track) => ({
    ...track,
    steps: track.steps.map(() => 0),
  }));
};

export const rotateTrackSteps = (project: SequenceProject, trackId: string, offset: number): SequenceProject => {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    return project;
  }

  const stepCount = track.steps.length;
  if (stepCount <= 1) {
    return project;
  }

  const normalizedOffset = ((Math.trunc(offset) % stepCount) + stepCount) % stepCount;
  if (normalizedOffset === 0) {
    return project;
  }

  return updateTrack(project, trackId, (currentTrack) => ({
    ...currentTrack,
    steps: currentTrack.steps.map((_, index) => currentTrack.steps[(index - normalizedOffset + stepCount) % stepCount]),
  }));
};

export const randomizeTrack = (
  project: SequenceProject,
  trackId: string,
  options: RandomizeTrackOptions = {},
): SequenceProject => {
  if (!project.tracks.some((track) => track.id === trackId)) {
    return project;
  }

  const probability = clamp(options.probability ?? 0.5, 0, 1);
  const random = options.random ?? Math.random;
  const first = clampStepValue(options.min ?? 0);
  const second = clampStepValue(options.max ?? 1);
  const min = Math.min(first, second);
  const max = Math.max(first, second);

  return updateTrack(project, trackId, (track) => ({
    ...track,
    steps: track.steps.map(() => {
      if (random() >= probability) {
        return 0;
      }

      return clampStepValue(min + random() * (max - min));
    }),
  }));
};

export const addTrack = (project: SequenceProject, name?: string): SequenceProject => {
  if (project.tracks.length >= SEQUENCER_LIMITS.maxTracks) {
    return project;
  }

  return {
    ...project,
    tracks: [
      ...project.tracks,
      createTrack({
        name: name ?? `Track ${project.tracks.length + 1}`,
        stepCount: project.stepCount,
      }),
    ],
  };
};

export const removeTrack = (project: SequenceProject, trackId: string): SequenceProject => {
  if (project.tracks.length <= SEQUENCER_LIMITS.minTracks) {
    return project;
  }

  const tracks = project.tracks.filter((track) => track.id !== trackId);
  return tracks.length === project.tracks.length ? project : { ...project, tracks };
};

export const renameTrack = (project: SequenceProject, trackId: string, name: string): SequenceProject =>
  updateTrack(project, trackId, (track) => ({
    ...track,
    name: name.trim() || track.name,
  }));

export const setTrackEnabled = (project: SequenceProject, trackId: string, enabled: boolean): SequenceProject =>
  updateTrack(project, trackId, (track) => ({
    ...track,
    enabled,
  }));

export const setProjectBpm = (project: SequenceProject, bpm: number): SequenceProject => ({
  ...project,
  bpm: clamp(bpm, SEQUENCER_LIMITS.minBpm, SEQUENCER_LIMITS.maxBpm),
});
