import { SEQUENCER_LIMITS } from "../limits";
import { clamp } from "../project";
import type { CreateTimingMapOptions, TempoEvent, TimingMap } from "./types";

const DEFAULT_START_POSITION_MS = 0;

const normalizeStartPositionMs = (value: unknown): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_START_POSITION_MS;
  }

  // A negative start position is kept: it puts beat 0 before transport
  // position 0 (a file whose head was clipped, or a pickup before the bar).
  return Number(value);
};

export const normalizeTempoEvent = (tempo: Partial<TempoEvent>, fallbackBeat = 0): TempoEvent => ({
  beat: Math.max(0, Number.isFinite(tempo.beat) ? Number(tempo.beat) : fallbackBeat),
  bpm: clamp(
    Number.isFinite(tempo.bpm) ? Number(tempo.bpm) : SEQUENCER_LIMITS.defaultBpm,
    SEQUENCER_LIMITS.minBpm,
    SEQUENCER_LIMITS.maxBpm,
  ),
});

export const normalizeTempos = (tempos: Partial<TempoEvent>[] | undefined): TempoEvent[] => {
  const source = tempos && tempos.length > 0 ? tempos : [{ beat: 0, bpm: SEQUENCER_LIMITS.defaultBpm }];

  // Stable sort by beat only: equal-beat entries keep their original relative
  // order, so the dedupe pass below deterministically keeps the first one.
  const sorted = source
    .map((tempo, index) => normalizeTempoEvent(tempo, index === 0 ? 0 : index))
    .sort((a, b) => a.beat - b.beat);

  const deduped: TempoEvent[] = [];
  for (const tempo of sorted) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.beat === tempo.beat) {
      continue;
    }
    deduped.push(tempo);
  }

  if (deduped[0].beat !== 0) {
    deduped.unshift({ beat: 0, bpm: deduped[0].bpm });
  }

  return deduped;
};

/**
 * Creates a valid {@link TimingMap} from one tempo or a tempo list. Tempos are
 * sorted, deduplicated, and clamped, a beat-0 tempo is added if missing, and a
 * missing or non-finite `startPositionMs` becomes 0. It never throws.
 *
 * @param options - Defaults to the default tempo with `startPositionMs` 0.
 * @returns A new timing map.
 */
export const createTimingMap = (options: CreateTimingMapOptions = { bpm: SEQUENCER_LIMITS.defaultBpm }): TimingMap => {
  const tempos = "tempos" in options ? options.tempos : [{ beat: 0, bpm: options.bpm }];
  return {
    tempos: normalizeTempos(tempos),
    startPositionMs: normalizeStartPositionMs(options.startPositionMs),
  };
};

/**
 * Repairs a timing map, or builds one from {@link CreateTimingMapOptions},
 * the same way as {@link createTimingMap}. It never throws.
 *
 * @param input - A possibly invalid timing map, creation options, or `undefined`.
 * @returns A new valid timing map.
 */
export const normalizeTimingMap = (input: Partial<TimingMap> | CreateTimingMapOptions | undefined): TimingMap => {
  if (!input) {
    return createTimingMap();
  }

  if ("bpm" in input || "tempos" in input) {
    return createTimingMap(input as CreateTimingMapOptions);
  }

  return {
    tempos: normalizeTempos(input.tempos),
    startPositionMs: normalizeStartPositionMs(input.startPositionMs),
  };
};

/**
 * Internal: whether local end (`durationBeats`) lies after transport position
 * 0. A negative `startPositionMs` that reaches past the whole Project leaves
 * nothing to play, so strict Project validation rejects it.
 */
export const endsAfterTransportStart = (timing: TimingMap, durationBeats: number): boolean =>
  beatToMs(timing, durationBeats) > 0;

/**
 * Internal: Project normalization's repair for a `startPositionMs` that
 * leaves nothing to play (see `endsAfterTransportStart`): it resets the start
 * position to 0.
 */
export const normalizeTimingForDuration = (timing: TimingMap, durationBeats: number): TimingMap =>
  endsAfterTransportStart(timing, durationBeats) ? timing : { ...timing, startPositionMs: DEFAULT_START_POSITION_MS };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Strict validation for TimingMap v2. Throws `TypeError` for wrong-typed
 * fields and `RangeError` for out-of-range or structurally invalid values.
 * Never repairs input; see `normalizeTimingMap()` for repair semantics.
 */
export const validateTimingMap = (timing: TimingMap): void => {
  if (!isPlainObject(timing)) {
    throw new TypeError("TimingMap must be an object.");
  }

  if (!Array.isArray(timing.tempos)) {
    throw new TypeError("TimingMap.tempos must be an array.");
  }

  if (timing.tempos.length === 0) {
    throw new RangeError("TimingMap.tempos must contain at least one tempo event.");
  }

  let previousBeat: number | undefined;

  timing.tempos.forEach((tempo, index) => {
    if (!isPlainObject(tempo)) {
      throw new TypeError(`TimingMap.tempos[${index}] must be an object.`);
    }

    if (typeof tempo.beat !== "number") {
      throw new TypeError(`TimingMap.tempos[${index}].beat must be a number.`);
    }

    if (!Number.isFinite(tempo.beat)) {
      throw new RangeError(`TimingMap.tempos[${index}].beat must be finite.`);
    }

    if (index === 0 && tempo.beat !== 0) {
      throw new RangeError("TimingMap.tempos[0].beat must be 0.");
    }

    if (previousBeat !== undefined && tempo.beat <= previousBeat) {
      throw new RangeError(
        `TimingMap.tempos[${index}].beat must be strictly greater than the previous tempo's beat.`,
      );
    }

    previousBeat = tempo.beat;

    if (typeof tempo.bpm !== "number") {
      throw new TypeError(`TimingMap.tempos[${index}].bpm must be a number.`);
    }

    if (!Number.isFinite(tempo.bpm) || tempo.bpm < SEQUENCER_LIMITS.minBpm || tempo.bpm > SEQUENCER_LIMITS.maxBpm) {
      throw new RangeError(
        `TimingMap.tempos[${index}].bpm must be a finite number between ${SEQUENCER_LIMITS.minBpm} and ${SEQUENCER_LIMITS.maxBpm}.`,
      );
    }
  });

  if (typeof timing.startPositionMs !== "number") {
    throw new TypeError("TimingMap.startPositionMs must be a number.");
  }

  if (!Number.isFinite(timing.startPositionMs)) {
    throw new RangeError("TimingMap.startPositionMs must be a finite number.");
  }
};

/**
 * Pure conversion: beat `->` transport-relative milliseconds. Assumes `timing`
 * is already a valid `TimingMap` (see `createTimingMap`/`normalizeTimingMap`
 * to construct one, or `validateTimingMap` to check strictly). Never repairs.
 * Returns a negative position for a beat before transport position 0 when
 * `startPositionMs` is negative.
 */
export const beatToMs = (timing: TimingMap, beat: number): number => {
  const targetBeat = Math.max(0, beat);
  let elapsedMs = timing.startPositionMs;

  for (let index = 0; index < timing.tempos.length; index += 1) {
    const tempo = timing.tempos[index];
    const nextTempo = timing.tempos[index + 1];
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

/**
 * Pure conversion: transport-relative milliseconds `->` beat. Assumes `timing`
 * is already a valid `TimingMap`. Never repairs. A position before beat 0
 * returns 0; with a negative `startPositionMs`, position 0 returns the beat at
 * transport position 0 (greater than 0).
 */
export const msToBeat = (timing: TimingMap, ms: number): number => {
  const targetMs = ms - timing.startPositionMs;

  if (targetMs <= 0) {
    return 0;
  }

  let elapsedMs = 0;

  for (let index = 0; index < timing.tempos.length; index += 1) {
    const tempo = timing.tempos[index];
    const nextTempo = timing.tempos[index + 1];

    if (!nextTempo) {
      return tempo.beat + elapsedMsToBeats(targetMs - elapsedMs, tempo.bpm);
    }

    const segmentMs = (nextTempo.beat - tempo.beat) * (60_000 / tempo.bpm);
    if (targetMs < elapsedMs + segmentMs) {
      return tempo.beat + elapsedMsToBeats(targetMs - elapsedMs, tempo.bpm);
    }

    elapsedMs += segmentMs;
  }

  const lastTempo = timing.tempos[timing.tempos.length - 1];
  return lastTempo.beat + elapsedMsToBeats(targetMs - elapsedMs, lastTempo.bpm);
};

const elapsedMsToBeats = (elapsedMs: number, bpm: number): number => elapsedMs / (60_000 / bpm);
