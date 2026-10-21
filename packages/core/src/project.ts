import { nextAvailableId } from "./ids";
import { SEQUENCER_LIMITS } from "./limits";
import type { SequenceProject, StepValue, Track } from "./types";

export type CreateTrackOptions = {
  /** Track id; trimmed. Blank or omitted means "generate one". */
  id?: string;
  name?: string;
  stepCount?: number;
  steps?: number[];
  enabled?: boolean;
};

export type CreateProjectOptions = {
  bpm?: number;
  stepCount?: number;
  stepsPerBeat?: number;
  /** Number of generated tracks. Cannot be combined with `tracks`. */
  trackCount?: number;
  /** Names of the generated tracks. Cannot be combined with `tracks`. */
  trackNames?: string[];
  /**
   * Track definitions, one per track, sized to the project's `stepCount`.
   * Cannot be combined with `trackCount` / `trackNames`.
   */
  tracks?: Omit<CreateTrackOptions, "stepCount">[];
};

export type RandomizeTrackOptions = {
  probability?: number;
  min?: number;
  max?: number;
  random?: () => number;
};

export const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
};

export const clampStepValue = (value: number): StepValue => clamp(value, 0, 1);

const requestedTrackId = (id: unknown): string | undefined =>
  typeof id === "string" && id.trim() ? id.trim() : undefined;

/**
 * Create a single {@link Track}. `stepCount` is clamped to
 * `SEQUENCER_LIMITS`; any `steps` values beyond that count are ignored,
 * missing steps default to 0, and every value is clamped to [0, 1].
 *
 * Without an `id` the track is `"track-1"` every time: it has no sibling
 * context, so give each track an id yourself when you build several, or use
 * {@link createProject} / {@link addTrack}, which pick the first unused id.
 *
 * @param options - Optional id, name, stepCount, initial steps, and enabled flag.
 * @returns A new `Track`, not yet attached to any project.
 */
export const createTrack = (options: CreateTrackOptions = {}): Track => {
  const stepCount = clamp(
    Math.trunc(options.stepCount ?? SEQUENCER_LIMITS.defaultStepCount),
    SEQUENCER_LIMITS.minStepCount,
    SEQUENCER_LIMITS.maxStepCount,
  );

  return {
    id: requestedTrackId(options.id) ?? nextAvailableId("track", []),
    name: options.name?.trim() || "Track",
    enabled: options.enabled ?? true,
    steps: Array.from({ length: stepCount }, (_, index) => clampStepValue(options.steps?.[index] ?? 0)),
  };
};

/**
 * Create a new {@link SequenceProject} with default or custom dimensions.
 * All numeric options are truncated to integers and clamped to the ranges
 * in `SEQUENCER_LIMITS` (bpm, step count, steps-per-beat, track count).
 *
 * Tracks come either from `trackCount` / `trackNames` (named from
 * `trackNames`, falling back to `Track ${n}`, every step at 0) or from
 * `tracks` (one definition per track, normalized like {@link createTrack}).
 * Track ids are Project-local: a track without a caller-supplied id gets the
 * first unused `track-N`, so the same options always produce the same ids.
 *
 * @param options - Optional overrides for bpm, stepCount, stepsPerBeat, and
 *   either trackCount/trackNames or tracks.
 * @returns A fresh `SequenceProject` (version 1).
 * @throws TypeError if `tracks` is combined with `trackCount` or
 *   `trackNames`, has fewer than `SEQUENCER_LIMITS.minTracks` or more than
 *   `SEQUENCER_LIMITS.maxTracks` entries, or repeats an id.
 *
 * @example
 * ```ts
 * const project = createProject({ bpm: 128, trackCount: 4, trackNames: ["Kick", "Bass"] });
 * const pattern = createProject({
 *   stepCount: 4,
 *   tracks: [{ id: "kick", steps: [1, 0, 0, 0] }, { id: "hat", steps: [0, 0.5, 0, 0.5] }],
 * });
 * ```
 */
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

  return {
    version: 1,
    bpm: clamp(options.bpm ?? SEQUENCER_LIMITS.defaultBpm, SEQUENCER_LIMITS.minBpm, SEQUENCER_LIMITS.maxBpm),
    stepCount,
    stepsPerBeat,
    tracks: options.tracks === undefined ? createGeneratedTracks(options, stepCount) : createDefinedTracks(options, stepCount),
  };
};

const createGeneratedTracks = (options: CreateProjectOptions, stepCount: number): Track[] => {
  const trackCount = clamp(
    Math.trunc(options.trackCount ?? SEQUENCER_LIMITS.defaultTrackCount),
    SEQUENCER_LIMITS.minTracks,
    SEQUENCER_LIMITS.maxTracks,
  );

  return Array.from({ length: trackCount }, (_, index) =>
    createTrack({
      id: `track-${index + 1}`,
      name: options.trackNames?.[index] ?? `Track ${index + 1}`,
      stepCount,
    }),
  );
};

const createDefinedTracks = (options: CreateProjectOptions, stepCount: number): Track[] => {
  const definitions = options.tracks ?? [];
  if (options.trackCount !== undefined || options.trackNames !== undefined) {
    throw new TypeError("createProject: pass either tracks or trackCount/trackNames, not both.");
  }
  if (definitions.length < SEQUENCER_LIMITS.minTracks || definitions.length > SEQUENCER_LIMITS.maxTracks) {
    throw new TypeError(
      `Invalid SequenceProject: tracks Track count must be between ${SEQUENCER_LIMITS.minTracks} and ${SEQUENCER_LIMITS.maxTracks}.`,
    );
  }

  // Reserve every caller-supplied id first, so a generated id never takes
  // one that a later definition asks for.
  const requestedIds = definitions.map((definition) => requestedTrackId(definition.id));
  const usedIds = new Set<string>();
  requestedIds.forEach((id, index) => {
    if (id === undefined) {
      return;
    }
    if (usedIds.has(id)) {
      throw new TypeError(`Invalid SequenceProject: tracks.${index}.id Track id must be non-empty and unique.`);
    }
    usedIds.add(id);
  });

  return definitions.map((definition, index) => {
    const id = requestedIds[index] ?? nextAvailableId("track", usedIds);
    usedIds.add(id);
    return createTrack({
      ...definition,
      id,
      name: definition.name?.trim() || `Track ${index + 1}`,
      stepCount,
    });
  });
};

const updateTrack = (
  project: SequenceProject,
  trackId: string,
  updater: (track: Track) => Track,
): SequenceProject => ({
  ...project,
  tracks: project.tracks.map((track) => (track.id === trackId ? updater(track) : track)),
});

/**
 * Set a single step's value on a track, clamped to [0, 1].
 *
 * Returns the original `project` unchanged if `trackId` doesn't match any
 * track, or if `stepIndex` is out of range — it never throws.
 *
 * @param project   - The project to update.
 * @param trackId   - Id of the track to modify.
 * @param stepIndex - Index into the track's step array.
 * @param value     - New value; clamped to [0, 1].
 * @returns A new `SequenceProject` with the step updated, or the original
 *   `project` if the track/step doesn't exist.
 */
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

/**
 * Toggle a step between 0 and 1: if its current value is greater than 0 it
 * becomes 0, otherwise it becomes 1 (any partial "on" value counts as on).
 *
 * Returns the original `project` unchanged if `trackId` doesn't exist.
 *
 * @param project   - The project to update.
 * @param trackId   - Id of the track containing the step.
 * @param stepIndex - Index of the step to toggle.
 * @returns A new `SequenceProject` with the step toggled, or the original
 *   `project` if the track doesn't exist.
 *
 * @example
 * ```ts
 * const next = toggleStep(project, "kick-energy", 4);
 * ```
 */
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

/**
 * Rotate a track's steps by `offset` positions (positive rotates so step
 * `i` moves to `i + offset`, wrapping around).
 *
 * Returns the original `project` unchanged if `trackId` doesn't exist, the
 * track has 1 or fewer steps, or the normalized offset is 0 (a full-length
 * rotation, which is a no-op).
 *
 * @param project - The project to update.
 * @param trackId - Id of the track to rotate.
 * @param offset  - Number of steps to rotate by; any integer, including
 *   negative or out-of-range values (normalized modulo the step count).
 * @returns A new `SequenceProject` with the track's steps rotated, or the
 *   original `project` if the track doesn't exist or nothing would change.
 */
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

/**
 * Randomize a track's step values. For each step, with probability
 * `options.probability` (default 0.5) a random value in `[min, max]`
 * (defaults `[0, 1]`) is assigned; otherwise the step is set to 0.
 *
 * Returns the original `project` unchanged if `trackId` doesn't exist.
 *
 * @param project - The project to update.
 * @param trackId - Id of the track to randomize.
 * @param options - `probability` of a step being non-zero, `min`/`max`
 *   value range, and an optional `random` source (defaults to
 *   `Math.random`) for deterministic testing.
 * @returns A new `SequenceProject` with the track randomized, or the
 *   original `project` if the track doesn't exist.
 */
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

/**
 * Append a new track (via {@link createTrack}) to the project, sized to
 * match the project's `stepCount`. Its id is the first `track-N` not used
 * by the project's tracks, so an id freed by {@link removeTrack} is reused.
 *
 * Returns the original `project` unchanged if it already has
 * `SEQUENCER_LIMITS.maxTracks` tracks.
 *
 * @param project - The project to update.
 * @param name    - Optional track name; defaults to `Track ${n}`.
 * @returns A new `SequenceProject` with the track appended, or the
 *   original `project` if the track limit has been reached.
 */
export const addTrack = (project: SequenceProject, name?: string): SequenceProject => {
  if (project.tracks.length >= SEQUENCER_LIMITS.maxTracks) {
    return project;
  }

  return {
    ...project,
    tracks: [
      ...project.tracks,
      createTrack({
        id: nextAvailableId("track", project.tracks.map((track) => track.id)),
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
