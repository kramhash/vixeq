import { easeOutQuad, envelopeAt, lastStepAt, lerp, type SequenceProject } from "@vixeq/core";
import { clamp01, getPatternComplexity } from "./visualizerState";

/**
 * Everything the visualizer draws at one position. A pure function of the
 * project and the position, so seeking, pausing and export all show the same
 * frame for the same position.
 */
export type VisualFrame = {
  stepIndex: number;
  stepPhase: number;
  energy: number;
  accent: number;
  complexity: number;
  tracks: [number, number, number, number];
  colorPhase: number;
  colorFlash: number;
};

// Track roles by index, as the default track names describe them.
const KICK = 0;
const DEPTH = 1;
const GLOW = 2;
const COLOR = 3;

// Envelopes rise briefly before each step so that they peak on the beat.
const ENERGY = { leadMs: 40, decayMs: 900, curve: easeOutQuad };
const ACCENT = { leadMs: 20, decayMs: 260, curve: easeOutQuad };
const GLOW_ENVELOPE = { leadMs: 30, decayMs: 600, curve: easeOutQuad };
const COLOR_ENVELOPE = { leadMs: 0, decayMs: 300, curve: easeOutQuad };
const COLOR_FLASH = { leadMs: 0, decayMs: 520, curve: easeOutQuad, peak: 0.9 };

/** Depth holds its last non-zero value, at rest in the middle until it fires. */
const DEPTH_REST = 0.5;
/** Rate (per second) at which depth moves from the previous value to the new one. */
const DEPTH_FOLLOW_RATE = 6;

/** Each color step advances the palette by this much, plus the step's value times COLOR_STEP_GAIN. */
const COLOR_STEP_BASE = 0.08;
const COLOR_STEP_GAIN = 0.34;
/** The palette also drifts one full turn over this long. */
const COLOR_DRIFT_MS = 72_000;

// Guards `positionMs / stepMs` landing an ulp below a step index.
const STEP_EPSILON = 1e-9;

const wrap01 = (value: number): number => ((value % 1) + 1) % 1;

export const getStepMs = (project: SequenceProject): number => 60_000 / project.bpm / project.stepsPerBeat;

type PatternTables = {
  complexity: number[];
  /** colorAdvance[i]: palette advance from the color steps 0..i of one pass. */
  colorAdvance: number[];
};

const tables = new WeakMap<SequenceProject, PatternTables>();

const getTables = (project: SequenceProject): PatternTables => {
  const cached = tables.get(project);
  if (cached) {
    return cached;
  }

  const color = project.tracks[COLOR];
  const colorAdvance: number[] = [];
  let advance = 0;
  for (let step = 0; step < project.stepCount; step += 1) {
    const value = color?.enabled ? clamp01(color.steps[step] ?? 0) : 0;
    if (value > 0) {
      advance += COLOR_STEP_BASE + value * COLOR_STEP_GAIN;
    }
    colorAdvance.push(advance);
  }

  const created = {
    complexity: Array.from({ length: project.stepCount }, (_, step) => getPatternComplexity(project, step)),
    colorAdvance,
  };
  tables.set(project, created);
  return created;
};

const envelope = (project: SequenceProject, positionMs: number, trackIndex: number, options: Parameters<typeof envelopeAt>[3]) => {
  const track = project.tracks[trackIndex];
  return track ? envelopeAt(project, positionMs, track.id, options) : 0;
};

const depthAt = (project: SequenceProject, positionMs: number): number => {
  const track = project.tracks[DEPTH];
  const hit = track ? lastStepAt(project, positionMs, track.id) : null;
  if (!track || !hit) {
    return DEPTH_REST;
  }

  // The value before this step, looked up just before the step started.
  const previous = lastStepAt(project, positionMs - hit.elapsedMs - 1e-3, track.id);
  const from = clamp01(previous?.value ?? hit.value);
  return lerp(from, clamp01(hit.value), 1 - Math.exp((-DEPTH_FOLLOW_RATE * hit.elapsedMs) / 1000));
};

/** Evaluates the visualizer at a position in the pattern, in ms (0 or later). */
export const evaluateVisual = (project: SequenceProject, positionMs: number): VisualFrame => {
  let position = Math.max(0, positionMs);
  const stepCount = project.stepCount;
  if (stepCount === 0) {
    return {
      stepIndex: 0,
      stepPhase: 0,
      energy: 0,
      accent: 0,
      complexity: 0,
      tracks: [0, DEPTH_REST, 0, 0],
      colorPhase: wrap01(position / COLOR_DRIFT_MS),
      colorFlash: 0,
    };
  }

  const stepMs = getStepMs(project);
  const absoluteStep = Math.floor(position / stepMs + STEP_EPSILON);
  // A position within STEP_EPSILON steps before a step start (e.g. after the
  // ms -> s -> ms round trip through fx-canvas) is that step's start, for the
  // envelopes as well as for stepIndex.
  if (position < absoluteStep * stepMs) {
    position = absoluteStep * stepMs;
  }
  const pass = Math.floor(absoluteStep / stepCount);
  const stepIndex = absoluteStep - pass * stepCount;
  const stepFraction = clamp01(position / stepMs - absoluteStep);
  const { complexity, colorAdvance } = getTables(project);

  const energy = envelope(project, position, KICK, ENERGY);
  const colorShift = envelope(project, position, COLOR, COLOR_ENVELOPE);

  return {
    stepIndex,
    stepPhase: stepIndex / stepCount,
    energy,
    accent: envelope(project, position, GLOW, ACCENT),
    complexity: lerp(complexity[stepIndex], complexity[(stepIndex + 1) % stepCount], stepFraction),
    tracks: [energy, depthAt(project, position), envelope(project, position, GLOW, GLOW_ENVELOPE), colorShift],
    colorPhase: wrap01(pass * colorAdvance[stepCount - 1] + colorAdvance[stepIndex] + position / COLOR_DRIFT_MS),
    colorFlash: envelope(project, position, COLOR, COLOR_FLASH),
  };
};
