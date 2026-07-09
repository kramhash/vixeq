import { lerp, linear, type EasingFunction } from "../easing";
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

export const arrangementDurationBeats = (arrangement: ArrangementProject): number =>
  arrangement.durationBeats;

export type SectionLookup = {
  section: ArrangementSection;
  /** Beat position relative to the section's own start (always >= 0). */
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

/**
 * Samples the interpolated 0-1 value for every track across the whole
 * arrangement at an arbitrary beat position. Always returns the full
 * union of track ids (see unionTrackIds) so consumers get a stable key
 * set across section boundaries — tracks not in the active pattern (or
 * positions in a gap / past the end) read 0.
 */
export const sampleArrangement = (
  arrangement: ArrangementProject,
  beat: number,
  easing: EasingFunction = linear,
  trackIds: string[] = unionTrackIds(arrangement),
): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const id of trackIds) {
    result[id] = 0;
  }

  const resolved = resolveArrangementStep(arrangement, beat);
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
