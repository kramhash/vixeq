import type { SequenceProject, StepEvent } from "@vixeq/core";

export type SelectedStep = {
  trackId: string;
  stepIndex: number;
};

export type VisualizerState = {
  stepIndex: number;
  stepPhase: number;
  energy: number;
  accent: number;
  complexity: number;
  tracks: [number, number, number, number];
  isPlaying: boolean;
};

const TRACK_COMPLEXITY_WEIGHTS = [0.55, 0.8, 1.15, 0.65];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const getStepValues = (project: SequenceProject, stepIndex: number): number[] =>
  project.tracks.map((track) => (track.enabled ? clamp01(track.steps[stepIndex] ?? 0) : 0));

const getSelectedStepIndex = (project: SequenceProject, selected: SelectedStep | null): number => {
  if (!selected) {
    return 0;
  }

  return Math.min(project.stepCount - 1, Math.max(0, selected.stepIndex));
};

const getWeightedStepActivity = (project: SequenceProject, stepIndex: number): number => {
  const totalWeight = project.tracks.reduce(
    (total, track, trackIndex) => total + (track.enabled ? TRACK_COMPLEXITY_WEIGHTS[trackIndex] ?? 0.7 : 0),
    0,
  );

  if (totalWeight === 0 || project.stepCount === 0) {
    return 0;
  }

  const normalizedStep = ((stepIndex % project.stepCount) + project.stepCount) % project.stepCount;
  const weighted = project.tracks.reduce((total, track, trackIndex) => {
    if (!track.enabled) {
      return total;
    }

    return total + clamp01(track.steps[normalizedStep] ?? 0) * (TRACK_COMPLEXITY_WEIGHTS[trackIndex] ?? 0.7);
  }, 0);

  return clamp01(weighted / totalWeight);
};

const getGlobalComplexity = (project: SequenceProject): number => {
  if (project.stepCount === 0 || project.tracks.length === 0) {
    return 0;
  }

  const activities = Array.from({ length: project.stepCount }, (_, stepIndex) =>
    getWeightedStepActivity(project, stepIndex),
  );
  const density = activities.reduce((total, value) => total + value, 0) / activities.length;
  const variation =
    activities.reduce((total, value, index) => {
      const previous = activities[(index - 1 + activities.length) % activities.length];
      return total + Math.abs(value - previous);
    }, 0) / activities.length;
  const syncopation =
    activities.reduce((total, value, index) => total + value * (index % 2 === 1 ? 1 : 0.35), 0) /
    activities.length;

  return clamp01(density * 0.5 + variation * 0.28 + syncopation * 0.22);
};

const getLocalComplexity = (project: SequenceProject, stepIndex: number): number => {
  if (project.stepCount === 0) {
    return 0;
  }

  const offsets = [-2, -1, 0, 1, 2];
  const activities = offsets.map((offset) => getWeightedStepActivity(project, stepIndex + offset));
  const center = activities[2];
  const neighborhood = activities.reduce((total, value) => total + value, 0) / activities.length;
  const localVariation =
    activities.reduce((total, value, index) => {
      if (index === 0) {
        return total;
      }

      return total + Math.abs(value - activities[index - 1]);
    }, 0) /
    (activities.length - 1);

  return clamp01(center * 0.45 + neighborhood * 0.3 + localVariation * 0.25);
};

export const getPatternComplexity = (project: SequenceProject, stepIndex = 0): number => {
  const global = getGlobalComplexity(project);
  const local = getLocalComplexity(project, stepIndex);
  return clamp01(global * 0.65 + local * 0.35);
};

export const createVisualizerState = (options: {
  project: SequenceProject;
  latestEvent: StepEvent | null;
  selected: SelectedStep | null;
  isPlaying: boolean;
}): VisualizerState => {
  const { project, latestEvent, selected, isPlaying } = options;
  const stepIndex = isPlaying && latestEvent ? latestEvent.stepIndex : getSelectedStepIndex(project, selected);
  const values =
    isPlaying && latestEvent
      ? latestEvent.tracks.map((track) => clamp01(track.value))
      : getStepValues(project, stepIndex);
  const firstFour = [0, 1, 2, 3].map((index) => clamp01(values[index] ?? 0)) as [number, number, number, number];
  const complexity = getPatternComplexity(project, stepIndex);

  return {
    stepIndex,
    stepPhase: project.stepCount > 0 ? stepIndex / project.stepCount : 0,
    energy: firstFour[0],
    accent: firstFour[2],
    complexity,
    tracks: firstFour,
    isPlaying,
  };
};
