export const SEQUENCER_LIMITS = {
  minBpm: 20,
  maxBpm: 300,
  minTracks: 1,
  maxTracks: 16,
  minStepCount: 1,
  maxStepCount: 128,
  minStepsPerBeat: 1,
  maxStepsPerBeat: 32,
  defaultBpm: 120,
  defaultStepCount: 16,
  defaultTrackCount: 4,
  defaultStepsPerBeat: 4,
} as const;
