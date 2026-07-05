import type { ArrangementProject, SequenceProject, Track } from "@vixeq/core";

export const WORKOUT_LIMITS = {
  minSections: 1,
  maxSections: 10,
  minDuration: 5,
  maxDuration: 120,
  minCadence: 40,
  maxCadence: 140,
  minResistance: 0,
  maxResistance: 100,
  maxNameLength: 40,
} as const;

export type WorkoutInterval = {
  id: string;
  name: string;
  duration: number;
  cadenceStart: number;
  cadenceEnd: number;
  resistanceStart: number;
  resistanceEnd: number;
};

export const initialWorkout: WorkoutInterval[] = [
  { id: "warm-up", name: "Warm up", duration: 60, cadenceStart: 70, cadenceEnd: 85, resistanceStart: 25, resistanceEnd: 35 },
  { id: "build", name: "Build", duration: 45, cadenceStart: 85, cadenceEnd: 95, resistanceStart: 35, resistanceEnd: 50 },
  { id: "sprint", name: "Sprint", duration: 30, cadenceStart: 95, cadenceEnd: 110, resistanceStart: 50, resistanceEnd: 55 },
  { id: "climb", name: "Climb", duration: 60, cadenceStart: 75, cadenceEnd: 65, resistanceStart: 45, resistanceEnd: 75 },
  { id: "cool-down", name: "Cool down", duration: 60, cadenceStart: 70, cadenceEnd: 60, resistanceStart: 30, resistanceEnd: 15 },
];

const clampInteger = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));

export const normalizeCadence = (rpm: number): number =>
  (clampInteger(rpm, WORKOUT_LIMITS.minCadence, WORKOUT_LIMITS.maxCadence) - WORKOUT_LIMITS.minCadence) /
  (WORKOUT_LIMITS.maxCadence - WORKOUT_LIMITS.minCadence);

export const normalizeResistance = (percent: number): number =>
  clampInteger(percent, WORKOUT_LIMITS.minResistance, WORKOUT_LIMITS.maxResistance) / 100;

export const sanitizeInterval = (interval: WorkoutInterval): WorkoutInterval => ({
  ...interval,
  name: interval.name.trim().slice(0, WORKOUT_LIMITS.maxNameLength) || "Untitled interval",
  duration: clampInteger(interval.duration, WORKOUT_LIMITS.minDuration, WORKOUT_LIMITS.maxDuration),
  cadenceStart: clampInteger(interval.cadenceStart, WORKOUT_LIMITS.minCadence, WORKOUT_LIMITS.maxCadence),
  cadenceEnd: clampInteger(interval.cadenceEnd, WORKOUT_LIMITS.minCadence, WORKOUT_LIMITS.maxCadence),
  resistanceStart: clampInteger(interval.resistanceStart, WORKOUT_LIMITS.minResistance, WORKOUT_LIMITS.maxResistance),
  resistanceEnd: clampInteger(interval.resistanceEnd, WORKOUT_LIMITS.minResistance, WORKOUT_LIMITS.maxResistance),
});

const ramp = (start: number, end: number, duration: number): number[] =>
  Array.from({ length: duration + 1 }, (_, index) => start + (end - start) * (index / duration));

const track = (id: string, name: string, steps: number[]): Track => ({ id, name, enabled: true, steps });

const intervalPattern = (interval: WorkoutInterval): SequenceProject => ({
  version: 1,
  bpm: 60,
  stepCount: interval.duration + 1,
  stepsPerBeat: 1,
  tracks: [
    track("cadence", "Cadence", ramp(normalizeCadence(interval.cadenceStart), normalizeCadence(interval.cadenceEnd), interval.duration)),
    track("resistance", "Resistance", ramp(normalizeResistance(interval.resistanceStart), normalizeResistance(interval.resistanceEnd), interval.duration)),
  ],
});

/** The domain boundary: at 60 BPM, one arrangement beat is one elapsed second. */
export const workoutToArrangement = (workout: WorkoutInterval[]): ArrangementProject => {
  let elapsedSeconds = 0;
  const patterns: Record<string, SequenceProject> = {};
  const sections = workout.map((rawInterval) => {
    const interval = sanitizeInterval(rawInterval);
    const patternId = `interval-${interval.id}`;
    patterns[patternId] = intervalPattern(interval);
    const section = { id: interval.id, patternId, startBeat: elapsedSeconds, endBeat: elapsedSeconds + interval.duration };
    elapsedSeconds = section.endBeat;
    return section;
  });

  return { version: 1, bpm: 60, patterns, sections };
};

export const totalDuration = (workout: WorkoutInterval[]): number =>
  workout.reduce((total, interval) => total + sanitizeInterval(interval).duration, 0);

export const cloneInitialWorkout = (): WorkoutInterval[] => initialWorkout.map((interval) => ({ ...interval }));
