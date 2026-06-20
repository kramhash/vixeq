import type { SequenceProject } from "./types";

const makeSteps = (active: number[], values?: Record<number, number>): number[] =>
  Array.from({ length: 16 }, (_, index) => (active.includes(index) ? values?.[index] ?? 1 : 0));

export const presets: Record<string, SequenceProject> = {
  pulse: {
    version: 1,
    bpm: 120,
    stepCount: 16,
    stepsPerBeat: 4,
    tracks: [
      { id: "kick-energy", name: "Kick / Energy", enabled: true, steps: makeSteps([0, 4, 8, 12]) },
      { id: "flow-motion", name: "Flow / Motion", enabled: true, steps: makeSteps([2, 6, 10, 14], { 2: 0.5, 10: 0.5 }) },
      { id: "glow-accent", name: "Glow / Accent", enabled: true, steps: makeSteps([7, 15], { 7: 0.75, 15: 1 }) },
      { id: "hue-color", name: "Hue / Color", enabled: true, steps: Array.from({ length: 16 }, (_, index) => index / 15) },
    ],
  },
  alternating: {
    version: 1,
    bpm: 100,
    stepCount: 16,
    stepsPerBeat: 4,
    tracks: [
      { id: "kick-energy", name: "Kick / Energy", enabled: true, steps: Array.from({ length: 16 }, (_, index) => (index % 2 ? 0 : 1)) },
      { id: "flow-motion", name: "Flow / Motion", enabled: true, steps: Array.from({ length: 16 }, (_, index) => (index % 2 ? 1 : 0)) },
      {
        id: "glow-accent",
        name: "Glow / Accent",
        enabled: true,
        steps: Array.from({ length: 16 }, (_, index) => Number((index / 15).toFixed(2))),
      },
      {
        id: "hue-color",
        name: "Hue / Color",
        enabled: true,
        steps: Array.from({ length: 16 }, (_, index) => Number((1 - index / 15).toFixed(2))),
      },
    ],
  },
};
