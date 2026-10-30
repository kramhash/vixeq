import { lerp, linear, type EasingFunction } from "./easing";
import { beatAtTransportPosition, sampleArrangement, unionTrackIds } from "./arrangement/resolve";
import type { ArrangementProject, ArrangementSection } from "./arrangement/types";
import { clamp01 } from "./smoothing";
import { beatToMs, msToBeat } from "./timeline/timing";
import type { SequenceProject, Track } from "./types";

/**
 * Options shared by the time-based evaluation functions.
 */
export type TimeEvaluationOptions = {
  /**
   * Arrangement only: wrap positions into the local loop
   * (`0` to `beatToMs(timing, durationBeats)`), as `ArrangementEngine` does
   * with local loop on. Defaults to `false`. A `SequenceProject` always loops,
   * so it ignores this option.
   */
  loop?: boolean;
};

/**
 * A step returned by {@link lastStepAt}: the step's value and where it
 * starts, measured from the queried position.
 */
export type StepHit = {
  /** The step's value (greater than 0). */
  value: number;
  /**
   * Where the step starts, in the same position coordinates as the query.
   * Across a loop wrap this can be negative.
   */
  positionMs: number;
  /** Milliseconds from the step's start to the queried position (`>= 0`). */
  elapsedMs: number;
};

/**
 * A step returned by {@link nextStepAt}: the step's value and where it
 * starts, measured from the queried position.
 */
export type NextStepHit = {
  /** The step's value (greater than 0). */
  value: number;
  /** Where the step starts, in the same position coordinates as the query. */
  positionMs: number;
  /** Milliseconds from the queried position to the step's start (`> 0`). */
  remainingMs: number;
};

/**
 * Options for {@link envelopeAt}.
 */
export type EnvelopeAtOptions = TimeEvaluationOptions & {
  /**
   * How long before a step the envelope starts rising, in ms, so that it
   * peaks exactly on the step. `0` (the default) jumps to the peak on the step.
   */
  leadMs?: number;
  /** How long the envelope takes to fall from the peak to 0, in ms. Default 300. */
  decayMs?: number;
  /** Easing applied to the rise and the fall. Default {@link linear}. */
  curve?: EasingFunction;
  /** Maximum output, 0–1, multiplied by the step's value. Default 1. */
  peak?: number;
};

type GridStep = { startMs: number; value: number };

const assertFinitePosition = (positionMs: number): void => {
  if (!Number.isFinite(positionMs)) {
    throw new RangeError("positionMs must be a finite number.");
  }
};

const mod = (value: number, length: number): number => ((value % length) + length) % length;

const isArrangement = (source: SequenceProject | ArrangementProject): source is ArrangementProject =>
  source.version === 2;

const sequenceStepDurationMs = (project: SequenceProject): number => 60_000 / project.bpm / project.stepsPerBeat;

/**
 * The absolute step under way at `positionMs` on a grid of `stepMs`: step `k`
 * starts at `k * stepMs`. `positionMs / stepMs` can round just below `k` at
 * that exact position, so the boundary is decided in ms.
 */
export const sequenceStepAt = (stepMs: number, positionMs: number): number => {
  let step = Math.floor(positionMs / stepMs);
  if ((step + 1) * stepMs <= positionMs) step += 1;
  if (step * stepMs > positionMs) step -= 1;
  return step;
};

const enabledTrack = (project: SequenceProject, trackId: string): Track | undefined => {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  return track?.enabled ? track : undefined;
};

/**
 * Samples every track at a position, as a pure function: no engine, and the
 * same result for the same arguments.
 *
 * - A `SequenceProject` loops forever, so any finite position is valid:
 *   positions past the last step and negative positions wrap around the
 *   pattern. For non-negative positions the result equals
 *   `SequencerEngine#sampleChannelsAt`. Step boundaries are decided in ms, as
 *   in {@link lastStepAt}, so at a step's exact start both report that step.
 * - An `ArrangementProject` is sampled at a transport position, with the same
 *   keys as {@link sampleArrangement} (every pattern's track ids). Without
 *   `options.loop`, a negative position or one past the end samples 0; with
 *   it, positions wrap into the local loop, as in `ArrangementEngine` with
 *   local loop on, except that a position less than 1e-9 ms before the loop
 *   end samples the next iteration's start (the Engine samples 0 there). For non-negative positions without loop the result equals
 *   `ArrangementEngine#sampleChannelsAt`. Prefer this to converting with
 *   `msToBeat` and calling `sampleArrangement`: `msToBeat` clamps negative
 *   positions and can land an ulp before a step start at odd tempos.
 *
 * @param source - The pattern or arrangement to sample.
 * @param positionMs - Position in ms: from the start of the pattern, or the
 *   arrangement's transport position.
 * @param easing - Easing curve applied to the interpolation phase between
 *   steps. Defaults to {@link linear}; use {@link hold} to keep each step's
 *   own value.
 * @param options - See {@link TimeEvaluationOptions}.
 * @returns A record of trackId → 0–1 value; disabled tracks sample to 0.
 * @throws RangeError if `positionMs` is not finite.
 */
export const sampleProject = (
  source: SequenceProject | ArrangementProject,
  positionMs: number,
  easing: EasingFunction = linear,
  options: TimeEvaluationOptions = {},
): Record<string, number> => {
  assertFinitePosition(positionMs);
  if (isArrangement(source)) {
    const ids = unionTrackIds(source);
    const beat = beatAtTransportPosition(source, positionMs, options.loop ?? false);
    return sampleArrangement(source, beat ?? -1, easing, ids);
  }

  const project = source;
  const stepDurationMs = sequenceStepDurationMs(project);
  const stepCount = Math.max(1, project.stepCount);
  const position = positionMs < 0 ? mod(positionMs, stepDurationMs * stepCount) : positionMs;
  const absoluteStep = Math.max(0, sequenceStepAt(stepDurationMs, position));
  const phase = clamp01((position - absoluteStep * stepDurationMs) / stepDurationMs);
  const index = absoluteStep % stepCount;
  const nextIndex = (index + 1) % stepCount;

  const result: Record<string, number> = {};
  for (const track of project.tracks) {
    result[track.id] = track.enabled ? lerp(track.steps[index], track.steps[nextIndex], easing(phase)) : 0;
  }
  return result;
};

const sequenceLastStep = (project: SequenceProject, track: Track, positionMs: number): GridStep | null => {
  const stepDurationMs = sequenceStepDurationMs(project);
  const stepCount = Math.max(1, project.stepCount);
  const step = sequenceStepAt(stepDurationMs, positionMs);

  for (let back = 0; back < stepCount; back += 1) {
    const value = track.steps[mod(step - back, stepCount)];
    if (value > 0) {
      return { startMs: (step - back) * stepDurationMs, value };
    }
  }
  return null;
};

const sequenceNextStep = (project: SequenceProject, track: Track, positionMs: number): GridStep | null => {
  const stepDurationMs = sequenceStepDurationMs(project);
  const stepCount = Math.max(1, project.stepCount);
  const step = sequenceStepAt(stepDurationMs, positionMs) + 1;

  for (let ahead = 0; ahead < stepCount; ahead += 1) {
    const value = track.steps[mod(step + ahead, stepCount)];
    if (value > 0) {
      return { startMs: (step + ahead) * stepDurationMs, value };
    }
  }
  return null;
};

/**
 * One section's step grid: step `j` starts at beat
 * `startBeat + j / stepsPerBeat` and plays the pattern's step `j % stepCount`
 * (loop-fill), as `resolveArrangementStep` resolves it.
 */
type SectionGrid = {
  section: ArrangementSection;
  pattern: SequenceProject;
  track: Track | undefined;
  stepCount: number;
  steps: number;
  stepMs: (step: number) => number;
  startMs: number;
  endMs: number;
};

// Projects are immutable (SUPPORT.md), so the grids can be cached per project
// and track: per-frame callers then pay for a lookup, not a rebuild.
const gridCache = new WeakMap<ArrangementProject, Map<string, SectionGrid[]>>();

const sectionGrids = (arrangement: ArrangementProject, trackId: string): SectionGrid[] => {
  let byTrack = gridCache.get(arrangement);
  if (!byTrack) {
    byTrack = new Map();
    gridCache.set(arrangement, byTrack);
  }
  let grids = byTrack.get(trackId);
  if (!grids) {
    grids = buildSectionGrids(arrangement, trackId);
    byTrack.set(trackId, grids);
  }
  return grids;
};

const buildSectionGrids = (arrangement: ArrangementProject, trackId: string): SectionGrid[] =>
  [...arrangement.sections]
    .sort((a, b) => a.startBeat - b.startBeat)
    .flatMap((section) => {
      const pattern = arrangement.patterns[section.patternId];
      if (!pattern) return [];
      const stepsPerBeat = pattern.stepsPerBeat;
      return [
        {
          section,
          pattern,
          track: enabledTrack(pattern, trackId),
          stepCount: Math.max(1, pattern.stepCount),
          steps: Math.ceil((section.endBeat - section.startBeat) * stepsPerBeat - 1e-9),
          stepMs: (step: number) => beatToMs(arrangement.timing, section.startBeat + step / stepsPerBeat),
          startMs: beatToMs(arrangement.timing, section.startBeat),
          endMs: beatToMs(arrangement.timing, section.endBeat),
        },
      ];
    });

/** The index of the first grid for which `before` is false (grids are in time order). */
const partition = (grids: SectionGrid[], before: (grid: SectionGrid) => boolean): number => {
  let low = 0;
  let high = grids.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (before(grids[middle])) low = middle + 1;
    else high = middle;
  }
  return low;
};

const stepEndMs = (grid: SectionGrid, step: number): number =>
  step + 1 < grid.steps ? grid.stepMs(step + 1) : grid.endMs;

/** The step under way at `positionMs` (-1 before the first, `steps - 1` after the last). */
const stepAtOrBefore = (grid: SectionGrid, arrangement: ArrangementProject, positionMs: number): number => {
  const beat = Number.isFinite(positionMs) ? msToBeat(arrangement.timing, positionMs) : positionMs;
  let step = Math.min(grid.steps - 1, Math.max(-1, Math.floor((beat - grid.section.startBeat) * grid.pattern.stepsPerBeat)));
  // The ms -> beat round trip can land one step off; decide in ms.
  while (step + 1 < grid.steps && grid.stepMs(step + 1) <= positionMs) step += 1;
  while (step >= 0 && grid.stepMs(step) > positionMs) step -= 1;
  return step;
};

/**
 * The last triggering step at or before `positionMs` in the arrangement's own
 * (non-wrapped) coordinates. With `clampToZero`, as in a local loop, steps
 * that end before transport position 0 do not exist and the step under way at
 * 0 starts at 0.
 */
const arrangementLastStep = (
  arrangement: ArrangementProject,
  grids: SectionGrid[],
  positionMs: number,
  clampToZero: boolean,
): GridStep | null => {
  // Sections are sorted and do not overlap: start from the last one that has
  // begun by `positionMs`.
  for (let index = partition(grids, (grid) => grid.startMs <= positionMs) - 1; index >= 0; index -= 1) {
    const grid = grids[index];
    if (!grid.track) continue;
    const last = stepAtOrBefore(grid, arrangement, positionMs);
    for (let step = last; step >= 0 && step > last - grid.stepCount; step -= 1) {
      if (clampToZero && stepEndMs(grid, step) <= 0) return null;
      const value = grid.track.steps[step % grid.stepCount];
      if (value > 0) {
        const startMs = grid.stepMs(step);
        return { startMs: clampToZero ? Math.max(0, startMs) : startMs, value };
      }
    }
  }
  return null;
};

const arrangementNextStep = (
  arrangement: ArrangementProject,
  grids: SectionGrid[],
  positionMs: number,
  clampToZero: boolean,
): GridStep | null => {
  for (let index = partition(grids, (grid) => grid.endMs <= positionMs); index < grids.length; index += 1) {
    const grid = grids[index];
    if (!grid.track) continue;
    let first = Math.max(0, stepAtOrBefore(grid, arrangement, positionMs) + 1);
    // Skip steps that end before transport position 0 before counting a
    // pattern's worth of steps, so the loop-fill after them is still reached.
    while (clampToZero && first < grid.steps && stepEndMs(grid, first) <= 0) first += 1;
    for (let step = first; step < grid.steps && step < first + grid.stepCount; step += 1) {
      const value = grid.track.steps[step % grid.stepCount];
      if (value > 0) {
        const startMs = grid.stepMs(step);
        return { startMs: clampToZero ? Math.max(0, startMs) : startMs, value };
      }
    }
  }
  return null;
};

const findStep = (
  source: SequenceProject | ArrangementProject,
  positionMs: number,
  trackId: string,
  options: TimeEvaluationOptions,
  direction: "last" | "next",
): GridStep | null => {
  assertFinitePosition(positionMs);

  if (!isArrangement(source)) {
    const track = enabledTrack(source, trackId);
    if (!track) return null;
    return direction === "last"
      ? sequenceLastStep(source, track, positionMs)
      : sequenceNextStep(source, track, positionMs);
  }

  const grids = sectionGrids(source, trackId);
  if (!options.loop) {
    return direction === "last"
      ? arrangementLastStep(source, grids, positionMs, false)
      : arrangementNextStep(source, grids, positionMs, false);
  }

  const loopMs = beatToMs(source.timing, source.durationBeats);
  const iteration = Math.floor(positionMs / loopMs);
  const localMs = positionMs - iteration * loopMs;
  const offsetMs = iteration * loopMs;

  if (direction === "last") {
    const hit = arrangementLastStep(source, grids, localMs, true);
    if (hit) return { startMs: hit.startMs + offsetMs, value: hit.value };
    // Nothing yet in this iteration: the last step of the previous one.
    const previous = arrangementLastStep(source, grids, Number.POSITIVE_INFINITY, true);
    return previous && { startMs: previous.startMs + offsetMs - loopMs, value: previous.value };
  }

  const hit = arrangementNextStep(source, grids, localMs, true);
  if (hit) return { startMs: hit.startMs + offsetMs, value: hit.value };
  // Nothing left in this iteration: the first step of the next one.
  const following = arrangementNextStep(source, grids, Number.NEGATIVE_INFINITY, true);
  return following && { startMs: following.startMs + offsetMs + loopMs, value: following.value };
};

/**
 * Finds the last step of a track that fires at or before a position: the
 * latest step whose value is greater than 0, in an enabled track.
 *
 * A pure function of its arguments, so it suits shaders and offline
 * rendering, where a frame can be evaluated at any time and in any order.
 * A `SequenceProject` loops forever, so the search wraps around the pattern
 * (back at most one pattern length). An `ArrangementProject` is searched
 * across sections and gaps, and with `options.loop` also across the loop
 * point (back at most one loop).
 *
 * @param source - A `SequenceProject` (positions from the start of the
 *   pattern) or an `ArrangementProject` (transport positions).
 * @param positionMs - The position to look back from, in ms.
 * @param trackId - The track's id. In an arrangement, each section's pattern
 *   is searched for a track with this id.
 * @param options - See {@link TimeEvaluationOptions}.
 * @returns The step, or `null` if the track never fires before the position.
 * @throws RangeError if `positionMs` is not finite.
 */
export const lastStepAt = (
  source: SequenceProject | ArrangementProject,
  positionMs: number,
  trackId: string,
  options: TimeEvaluationOptions = {},
): StepHit | null => {
  const step = findStep(source, positionMs, trackId, options, "last");
  return step && { value: step.value, positionMs: step.startMs, elapsedMs: Math.max(0, positionMs - step.startMs) };
};

/**
 * Finds the next step of a track that fires after a position: the earliest
 * step whose value is greater than 0, in an enabled track, starting strictly
 * after `positionMs`. The look-ahead counterpart of {@link lastStepAt}, with
 * the same search rules.
 *
 * @param source - A `SequenceProject` or an `ArrangementProject`.
 * @param positionMs - The position to look ahead from, in ms.
 * @param trackId - The track's id.
 * @param options - See {@link TimeEvaluationOptions}.
 * @returns The step, or `null` if the track does not fire again.
 * @throws RangeError if `positionMs` is not finite.
 */
export const nextStepAt = (
  source: SequenceProject | ArrangementProject,
  positionMs: number,
  trackId: string,
  options: TimeEvaluationOptions = {},
): NextStepHit | null => {
  const step = findStep(source, positionMs, trackId, options, "next");
  return step && { value: step.value, positionMs: step.startMs, remainingMs: step.startMs - positionMs };
};

/**
 * Evaluates a trigger envelope for a track at a position, as a pure function
 * of the position: the same arguments always give the same value, whatever
 * order positions are evaluated in. Unlike {@link createEnvelope}, it needs
 * no `trigger()` calls, so it survives seeking and offline export.
 *
 * Each step that fires (see {@link lastStepAt}) peaks at
 * `step value × peak` exactly on the step, after rising over `leadMs` before
 * it, and falls to 0 over `decayMs` after it. Where the fall of one step and
 * the rise of the next overlap, the larger value wins.
 *
 * @param source - A `SequenceProject` or an `ArrangementProject`.
 * @param positionMs - The position to evaluate at, in ms.
 * @param trackId - The track's id.
 * @param options - See {@link EnvelopeAtOptions}.
 * @returns A value from 0 to 1.
 * @throws RangeError if `positionMs` is not finite.
 */
export const envelopeAt = (
  source: SequenceProject | ArrangementProject,
  positionMs: number,
  trackId: string,
  options: EnvelopeAtOptions = {},
): number => {
  const leadMs = Math.max(0, options.leadMs ?? 0);
  const decayMs = Math.max(1, options.decayMs ?? 300);
  const curve = options.curve ?? linear;
  const peak = clamp01(options.peak ?? 1);

  let value = 0;
  const last = lastStepAt(source, positionMs, trackId, options);
  if (last && last.elapsedMs < decayMs) {
    value = lerp(clamp01(last.value) * peak, 0, curve(last.elapsedMs / decayMs));
  }

  if (leadMs > 0) {
    const next = nextStepAt(source, positionMs, trackId, options);
    if (next && next.remainingMs < leadMs) {
      value = Math.max(value, lerp(0, clamp01(next.value) * peak, curve(1 - next.remainingMs / leadMs)));
    }
  }

  return value;
};
