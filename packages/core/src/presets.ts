import type { SequenceProject } from "./types";

const makeSteps = (active: number[], values?: Record<number, number>): number[] =>
  Array.from({ length: 16 }, (_, index) => (active.includes(index) ? values?.[index] ?? 1 : 0));

/**
 * Built-in example {@link SequenceProject}s, keyed by name (`"default"`,
 * `"pulse"`, `"alternating"`). Useful as starting points for demos, tests, or
 * a "load preset" UI — pass one directly to `new SequencerEngine(...)`, or as
 * the seed state for the `project.ts` editing helpers.
 *
 * @example
 * ```ts
 * const engine = new SequencerEngine(presets.pulse);
 * ```
 */
export const presets: Record<string, SequenceProject> = {
  default: {
    version: 1,
    bpm: 120,
    stepCount: 16,
    stepsPerBeat: 4,
    tracks: [
      {
        id: "kick-energy",
        name: "Kick / Energy",
        enabled: true,
        steps: [1, 0, 0, 0, 1, 0, 0, 0.3427220394736842, 1, 0, 0.6311677631578947, 0, 1, 0, 1, 0],
      },
      {
        id: "depth-motion",
        name: "Depth / Motion",
        enabled: true,
        steps: [0, 0, 0, 0, 0.4867393092105263, 0, 0, 0, 0, 0, 0, 0, 0.5127467105263157, 0, 0, 0],
      },
      {
        id: "glow-accent",
        name: "Glow / Accent",
        enabled: true,
        steps: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0.33449835526315785, 1, 0, 0, 0.6932565789473684],
      },
      {
        id: "color-shift",
        name: "Color Shift",
        enabled: true,
        steps: [
          0, 0, 0, 0.6639597039473684, 1, 0, 0.40738075657894735, 0.4986636513157895,
          0.3555715460526315, 0.1575863486842105, 0.42074424342105265, 0.7347861842105263,
          0.9950657894736842, 0, 0, 0.3472450657894737,
        ],
      },
    ],
  },
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
