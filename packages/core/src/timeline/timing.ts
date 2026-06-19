import { SEQUENCER_LIMITS } from "../limits";
import { clamp } from "../project";
import type { CreateTimingMapOptions, TempoEvent, TimingMap } from "./types";

const DEFAULT_OFFSET_MS = 0;

export const normalizeTempoEvent = (tempo: Partial<TempoEvent>, fallbackBeat = 0): TempoEvent => ({
  beat: Math.max(0, Number.isFinite(tempo.beat) ? Number(tempo.beat) : fallbackBeat),
  bpm: clamp(
    Number.isFinite(tempo.bpm) ? Number(tempo.bpm) : SEQUENCER_LIMITS.defaultBpm,
    SEQUENCER_LIMITS.minBpm,
    SEQUENCER_LIMITS.maxBpm,
  ),
});

export const normalizeTempos = (tempos: Partial<TempoEvent>[] | undefined): TempoEvent[] => {
  const normalized = (tempos && tempos.length > 0 ? tempos : [{ beat: 0, bpm: SEQUENCER_LIMITS.defaultBpm }])
    .map((tempo, index) => normalizeTempoEvent(tempo, index === 0 ? 0 : index))
    .sort((a, b) => a.beat - b.beat || a.bpm - b.bpm);

  if (normalized[0].beat !== 0) {
    normalized.unshift({ beat: 0, bpm: normalized[0].bpm });
  }

  return normalized;
};

export const createTimingMap = (options: CreateTimingMapOptions = { bpm: SEQUENCER_LIMITS.defaultBpm }): TimingMap => {
  const tempos = "tempos" in options ? options.tempos : [{ beat: 0, bpm: options.bpm }];
  return {
    tempos: normalizeTempos(tempos),
    offsetMs: Number.isFinite(options.offsetMs) ? Number(options.offsetMs) : DEFAULT_OFFSET_MS,
  };
};

export const normalizeTimingMap = (input: Partial<TimingMap> | CreateTimingMapOptions | undefined): TimingMap => {
  if (!input) {
    return createTimingMap();
  }

  if ("bpm" in input || "tempos" in input) {
    return createTimingMap(input as CreateTimingMapOptions);
  }

  return {
    tempos: normalizeTempos(input.tempos),
    offsetMs: Number.isFinite(input.offsetMs) ? Number(input.offsetMs) : DEFAULT_OFFSET_MS,
  };
};

export const beatToMs = (timing: TimingMap, beat: number): number => {
  const normalizedTiming = normalizeTimingMap(timing);
  const targetBeat = Math.max(0, beat);
  let elapsedMs = normalizedTiming.offsetMs;

  for (let index = 0; index < normalizedTiming.tempos.length; index += 1) {
    const tempo = normalizedTiming.tempos[index];
    const nextTempo = normalizedTiming.tempos[index + 1];
    const segmentEndBeat = nextTempo ? Math.min(targetBeat, nextTempo.beat) : targetBeat;

    if (segmentEndBeat > tempo.beat) {
      elapsedMs += (segmentEndBeat - tempo.beat) * (60_000 / tempo.bpm);
    }

    if (!nextTempo || targetBeat < nextTempo.beat) {
      break;
    }
  }

  return elapsedMs;
};

export const msToBeat = (timing: TimingMap, ms: number): number => {
  const normalizedTiming = normalizeTimingMap(timing);
  const targetMs = ms - normalizedTiming.offsetMs;

  if (targetMs <= 0) {
    return 0;
  }

  let elapsedMs = 0;

  for (let index = 0; index < normalizedTiming.tempos.length; index += 1) {
    const tempo = normalizedTiming.tempos[index];
    const nextTempo = normalizedTiming.tempos[index + 1];

    if (!nextTempo) {
      return tempo.beat + elapsedMsToBeats(targetMs - elapsedMs, tempo.bpm);
    }

    const segmentMs = (nextTempo.beat - tempo.beat) * (60_000 / tempo.bpm);
    if (targetMs < elapsedMs + segmentMs) {
      return tempo.beat + elapsedMsToBeats(targetMs - elapsedMs, tempo.bpm);
    }

    elapsedMs += segmentMs;
  }

  const lastTempo = normalizedTiming.tempos[normalizedTiming.tempos.length - 1];
  return lastTempo.beat + elapsedMsToBeats(targetMs - elapsedMs, lastTempo.bpm);
};

const elapsedMsToBeats = (elapsedMs: number, bpm: number): number => elapsedMs / (60_000 / bpm);
