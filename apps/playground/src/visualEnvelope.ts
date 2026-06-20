import { clamp01, decaySmoothedValue, exciteSmoothedValue, type SmoothingConfig } from "@vixeq/core";
import type { VisualizerState } from "./visualizerState";

export type VisualEnvelopeState = {
  energy: number;
  accent: number;
  complexity: number;
  tracks: [number, number, number, number];
  colorPhase: number;
  colorFlash: number;
};

const CHANNELS = {
  energy: { decayRate: 2.4, impact: 0.42, lift: 0.06 },
  accent: { decayRate: 7.2, impact: 0.58, lift: 0.03 },
  track0: { decayRate: 1.8, impact: 0.48, lift: 0.03 },
  track1: { decayRate: 2.2, impact: 0.72, lift: 0.08, rest: 0.5, holdWhenInputZero: true },
  track2: { decayRate: 5.6, impact: 0.56, lift: 0.04 },
  track3: { decayRate: 8.5, impact: 0.9, lift: 0.03 },
  complexity: { decayRate: 1.4, impact: 0.72, lift: 0.04 },
} satisfies Record<string, SmoothingConfig>;

const COLOR_DRIFT_SECONDS = 72;

const wrap01 = (value: number): number => ((value % 1) + 1) % 1;

const exciteColorPhase = (current: number, input: number): number => {
  const normalizedInput = clamp01(input);
  if (normalizedInput === 0) {
    return current;
  }

  return wrap01(current + 0.08 + normalizedInput * 0.34);
};

export const createVisualEnvelope = (): VisualEnvelopeState => ({
  energy: 0,
  accent: 0,
  complexity: 0,
  tracks: [0, 0.5, 0, 0],
  colorPhase: 0,
  colorFlash: 0,
});

export const exciteEnvelope = (
  envelope: VisualEnvelopeState,
  input: Pick<VisualizerState, "energy" | "accent" | "complexity" | "tracks">,
): VisualEnvelopeState => {
  const colorInput = clamp01(input.tracks[3]);

  return {
    energy: exciteSmoothedValue(envelope.energy, input.energy, CHANNELS.energy),
    accent: exciteSmoothedValue(envelope.accent, input.accent, CHANNELS.accent),
    complexity: exciteSmoothedValue(envelope.complexity, input.complexity, CHANNELS.complexity),
    tracks: [
      exciteSmoothedValue(envelope.tracks[0], input.tracks[0], CHANNELS.track0),
      exciteSmoothedValue(envelope.tracks[1], input.tracks[1], CHANNELS.track1),
      exciteSmoothedValue(envelope.tracks[2], input.tracks[2], CHANNELS.track2),
      exciteSmoothedValue(envelope.tracks[3], colorInput, CHANNELS.track3),
    ],
    colorPhase: exciteColorPhase(envelope.colorPhase, colorInput),
    colorFlash: colorInput > 0 ? clamp01(Math.max(envelope.colorFlash, colorInput * 0.9)) : envelope.colorFlash,
  };
};

export const decayEnvelope = (envelope: VisualEnvelopeState, deltaSeconds: number): VisualEnvelopeState => {
  const safeDelta = Math.max(0, deltaSeconds);

  return {
    energy: decaySmoothedValue(envelope.energy, safeDelta, CHANNELS.energy),
    accent: decaySmoothedValue(envelope.accent, safeDelta, CHANNELS.accent),
    complexity: decaySmoothedValue(envelope.complexity, safeDelta, CHANNELS.complexity),
    tracks: [
      decaySmoothedValue(envelope.tracks[0], safeDelta, CHANNELS.track0),
      decaySmoothedValue(envelope.tracks[1], safeDelta, CHANNELS.track1),
      decaySmoothedValue(envelope.tracks[2], safeDelta, CHANNELS.track2),
      decaySmoothedValue(envelope.tracks[3], safeDelta, CHANNELS.track3),
    ],
    colorPhase: wrap01(envelope.colorPhase + safeDelta / COLOR_DRIFT_SECONDS),
    colorFlash: clamp01(envelope.colorFlash * Math.exp(-safeDelta * 5.8)),
  };
};
