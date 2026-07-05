import type { SequenceProject } from "@vixeq/core";

const steps16 = (values: Partial<Record<number, number>>): number[] =>
  Array.from({ length: 16 }, (_, i) => values[i] ?? 0);

/**
 * Fixed track ids shared by every pattern in this arrangement. Patterns are
 * authored as plain data (not via createProject) specifically so "pulse"
 * and "glow" resolve to the same track id in every pattern — that's what
 * lets sampleChannels() report a stable, continuous value for the same CSS
 * variable across section boundaries. "burst" only exists in the chorus
 * pattern, on purpose: watch it read 0 during every Intro section.
 */
export const TRACK_IDS = { pulse: "pulse", glow: "glow", burst: "burst" } as const;

// 16 steps, 4 steps/beat -> 4 beats per pattern. Each 8-beat section
// (see arrangement.ts) loop-fills this pattern twice.
export const introPattern: SequenceProject = {
  version: 1,
  bpm: 120, // ignored — ArrangementEngine uses the arrangement's own bpm
  stepCount: 16,
  stepsPerBeat: 4,
  tracks: [
    {
      id: TRACK_IDS.pulse,
      name: "Pulse",
      enabled: true,
      steps: steps16({ 0: 0.55, 4: 0.5, 8: 0.55, 12: 0.5 }),
    },
    {
      id: TRACK_IDS.glow,
      name: "Glow",
      enabled: true,
      steps: steps16({ 0: 0.3, 8: 0.4 }),
    },
  ],
};

export const chorusPattern: SequenceProject = {
  version: 1,
  bpm: 120,
  stepCount: 16,
  stepsPerBeat: 4,
  tracks: [
    {
      id: TRACK_IDS.pulse,
      name: "Pulse",
      enabled: true,
      steps: steps16({ 0: 1, 2: 0.6, 4: 1, 6: 0.6, 8: 1, 10: 0.6, 12: 1, 14: 0.6 }),
    },
    {
      id: TRACK_IDS.glow,
      name: "Glow",
      enabled: true,
      steps: steps16({ 0: 0.95, 4: 0.75, 8: 0.95, 12: 0.75 }),
    },
    {
      id: TRACK_IDS.burst,
      name: "Burst",
      enabled: true,
      steps: steps16({ 0: 1, 2: 1, 4: 1, 6: 1, 8: 1, 10: 1, 12: 1, 14: 1 }),
    },
  ],
};
