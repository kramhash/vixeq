import { lerp, linear, type EasingFunction } from "../easing";
import { beatToMs, msToBeat } from "../timeline/timing";
import type { TimeEvaluationOptions } from "../timeEvaluation";
import type { ArrangementProject, ArrangementSection } from "./types";

/** Every track id that appears in any pattern in the arrangement, in first-seen order. Used to keep sampleChannels' key set stable across section boundaries. */
export const unionTrackIds = (arrangement: ArrangementProject): string[] => {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const pattern of Object.values(arrangement.patterns)) {
    for (const track of pattern.tracks) {
      if (!seen.has(track.id)) {
        seen.add(track.id);
        ids.push(track.id);
      }
    }
  }

  return ids;
};

/** Returns the arrangement's length in beats (`durationBeats`). */
export const arrangementDurationBeats = (arrangement: ArrangementProject): number =>
  arrangement.durationBeats;

/**
 * The section active at a beat, and the beat measured from that section's
 * start.
 */
export type SectionLookup = {
  section: ArrangementSection;
  /** Beat position relative to the section's own start (always `>= 0`). */
  localBeat: number;
};

/** Resolves which section (if any) is active at `beat`. Returns null for gaps, before-start, and past-the-end (when not looping). */
export const sectionAtBeat = (arrangement: ArrangementProject, beat: number): SectionLookup | null => {
  if (beat < 0) {
    return null;
  }

  const section = arrangement.sections.find(
    (candidate) => beat >= candidate.startBeat && beat < candidate.endBeat,
  );

  if (!section) {
    return null;
  }

  return { section, localBeat: beat - section.startBeat };
};

/** The section and pattern step active at a beat, as resolved by the engine. */
export type ResolvedArrangementStep = {
  section: ArrangementSection;
  /** Step index within the active pattern, wrapped modulo the pattern's stepCount (loop-fill). */
  stepIndex: number;
  nextStepIndex: number;
  /** 0..1 position within the current step, for value → nextValue interpolation. */
  phase: number;
};

/** Resolves the active section and its pattern-local step position at `beat`. Returns null when no section is active (gap, before start, or past the end without loop). */
export const resolveArrangementStep = (
  arrangement: ArrangementProject,
  beat: number,
): ResolvedArrangementStep | null => {
  const lookup = sectionAtBeat(arrangement, beat);
  if (!lookup) {
    return null;
  }

  const pattern = arrangement.patterns[lookup.section.patternId];
  if (!pattern) {
    return null;
  }

  const stepCount = Math.max(1, pattern.stepCount);
  const rawStep = lookup.localBeat * pattern.stepsPerBeat;
  const absoluteStep = Math.floor(rawStep);
  const phase = rawStep - absoluteStep;
  const stepIndex = ((absoluteStep % stepCount) + stepCount) % stepCount;
  const nextStepIndex = (stepIndex + 1) % stepCount;

  return { section: lookup.section, stepIndex, nextStepIndex, phase };
};

const POSITION_EPSILON_MS = 1e-9;

/**
 * The beat at a transport position, snapped up to the next section edge or
 * step start when that lies within POSITION_EPSILON_MS: an ms-to-beat round
 * trip can land an ulp below it (at odd tempos, or at transport position 0
 * when a negative startPositionMs puts a section or step start exactly there).
 * Shared by ArrangementEngine and the loop option of sampleArrangement.
 */
export const beatAtPosition = (arrangement: ArrangementProject, positionMs: number): number => {
  const beat = msToBeat(arrangement.timing, positionMs);
  let nextBeat = Number.POSITIVE_INFINITY;
  for (const section of arrangement.sections) {
    const pattern = arrangement.patterns[section.patternId];
    if (!pattern) continue;
    if (section.startBeat >= beat) {
      nextBeat = Math.min(nextBeat, section.startBeat);
    } else if (section.endBeat > beat) {
      const { stepsPerBeat } = pattern;
      const stepBeat = section.startBeat + Math.ceil((beat - section.startBeat) * stepsPerBeat) / stepsPerBeat;
      nextBeat = Math.min(nextBeat, stepBeat, section.endBeat);
    }
  }
  return beatToMs(arrangement.timing, nextBeat) - positionMs <= POSITION_EPSILON_MS ? nextBeat : beat;
};

// Wrap in ms, as ArrangementEngine's local loop does: with tempo changes a
// beat-space modulo would land elsewhere. Beats before 0 extend the first tempo.
const loopBeat = (arrangement: ArrangementProject, beat: number): number => {
  const { timing } = arrangement;
  const positionMs =
    beat >= 0 ? beatToMs(timing, beat) : timing.startPositionMs + beat * (60_000 / timing.tempos[0].bpm);
  const loopMs = beatToMs(timing, arrangement.durationBeats);
  if (positionMs >= 0 && positionMs < loopMs) {
    return beat;
  }
  const wrapped = beatAtPosition(arrangement, ((positionMs % loopMs) + loopMs) % loopMs);
  // An ulp below the loop end snaps to the end itself, which is the next
  // iteration's start.
  return wrapped >= arrangement.durationBeats ? beatAtPosition(arrangement, 0) : wrapped;
};

/**
 * Samples the interpolated 0-1 value for every track across the whole
 * arrangement at an arbitrary beat position. Always returns the full
 * union of track ids (see unionTrackIds) so consumers get a stable key
 * set across section boundaries — tracks not in the active pattern (or
 * positions in a gap / past the end) read 0.
 *
 * With `options.loop`, a beat outside the local loop wraps into it, as in
 * `ArrangementEngine` with local loop on: the loop runs from transport
 * position 0 to `durationBeats`, and positions wrap in milliseconds, so tempo
 * changes are respected. With a negative `startPositionMs`, beats before
 * transport position 0 wrap to the end of the loop.
 */
export const sampleArrangement = (
  arrangement: ArrangementProject,
  beat: number,
  easing: EasingFunction = linear,
  trackIds: string[] = unionTrackIds(arrangement),
  options: TimeEvaluationOptions = {},
): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const id of trackIds) {
    result[id] = 0;
  }

  const resolved = resolveArrangementStep(arrangement, options.loop ? loopBeat(arrangement, beat) : beat);
  if (!resolved) {
    return result;
  }

  const pattern = arrangement.patterns[resolved.section.patternId];
  for (const track of pattern.tracks) {
    if (!track.enabled) {
      result[track.id] = 0;
      continue;
    }

    const value = track.steps[resolved.stepIndex] ?? 0;
    const nextValue = track.steps[resolved.nextStepIndex] ?? 0;
    result[track.id] = lerp(value, nextValue, easing(resolved.phase));
  }

  return result;
};
