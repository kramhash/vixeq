import { describe, expect, it } from "vitest";
import {
  beatToMs,
  createTimingMap,
  msToBeat,
  normalizeTempoEvent,
  normalizeTempos,
  normalizeTimingMap,
  validateTimingMap,
} from "./index";
import type { TimingMap } from "./types";

describe("TimingMap v2", () => {
  it("TM-001 createTimingMap with a single bpm produces one beat-0 tempo and startPositionMs 0", () => {
    const timing = createTimingMap({ bpm: 120 });

    expect(timing.tempos).toEqual([{ beat: 0, bpm: 120 }]);
    expect(timing.startPositionMs).toBe(0);
  });

  it("TM-002 createTimingMap synthesizes a beat-0 tempo when the tempos list omits one", () => {
    const timing = createTimingMap({ tempos: [{ beat: 4, bpm: 90 }] });

    expect(timing.tempos[0]).toEqual({ beat: 0, bpm: 90 });
    expect(timing.tempos[1]).toEqual({ beat: 4, bpm: 90 });
  });

  it("TM-003 createTimingMap clamps a negative or non-finite startPositionMs option to 0", () => {
    expect(createTimingMap({ bpm: 120, startPositionMs: -50 }).startPositionMs).toBe(0);
    expect(createTimingMap({ bpm: 120, startPositionMs: Number.NaN }).startPositionMs).toBe(0);
    expect(createTimingMap({ bpm: 120, startPositionMs: Number.POSITIVE_INFINITY }).startPositionMs).toBe(0);
  });

  it("TM-004 normalizeTimingMap clamps out-of-range bpm into [minBpm, maxBpm]", () => {
    const timing = normalizeTimingMap({ tempos: [{ beat: 0, bpm: 10_000 }] });

    expect(timing.tempos[0].bpm).toBe(300);

    const low = normalizeTimingMap({ tempos: [{ beat: 0, bpm: -50 }] });
    expect(low.tempos[0].bpm).toBe(20);
  });

  it("TM-005 normalizeTimingMap repairs unsorted/duplicate tempo beats into strictly increasing beats", () => {
    const timing = normalizeTimingMap({
      tempos: [
        { beat: 8, bpm: 100 },
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 90 },
        { beat: 4, bpm: 60 },
      ],
    });

    const beats = timing.tempos.map((tempo) => tempo.beat);
    expect(beats).toEqual([0, 4, 8]);
    // Equal-beat duplicates keep the first occurrence in stable-sorted order.
    expect(timing.tempos.find((tempo) => tempo.beat === 4)?.bpm).toBe(90);
  });

  it("normalizes missing tempos and malformed tempo event fields", () => {
    expect(normalizeTempos(undefined)).toEqual([{ beat: 0, bpm: 120 }]);
    expect(normalizeTempos([])).toEqual([{ beat: 0, bpm: 120 }]);

    expect(normalizeTempoEvent({ beat: Number.NaN, bpm: Number.NaN }, 3)).toEqual({ beat: 3, bpm: 120 });
    expect(normalizeTempoEvent({ beat: -4, bpm: 60 })).toEqual({ beat: 0, bpm: 60 });
  });

  it("normalizes empty input and preserves already-timing-shaped input", () => {
    expect(normalizeTimingMap(undefined)).toEqual({
      tempos: [{ beat: 0, bpm: 120 }],
      startPositionMs: 0,
    });

    expect(
      normalizeTimingMap({
        tempos: [{ beat: 0, bpm: 90 }],
        startPositionMs: 250,
      }),
    ).toEqual({
      tempos: [{ beat: 0, bpm: 90 }],
      startPositionMs: 250,
    });

    expect(normalizeTimingMap({ startPositionMs: 125 })).toEqual({
      tempos: [{ beat: 0, bpm: 120 }],
      startPositionMs: 125,
    });
  });

  it("TM-006 validateTimingMap accepts a valid map without throwing", () => {
    const timing = createTimingMap({
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 90 },
      ],
      startPositionMs: 250,
    });

    expect(() => validateTimingMap(timing)).not.toThrow();
  });

  it("TM-007 validateTimingMap rejects a map whose first tempo is not at beat 0", () => {
    const timing: TimingMap = { tempos: [{ beat: 1, bpm: 120 }], startPositionMs: 0 };

    expect(() => validateTimingMap(timing)).toThrow(RangeError);
  });

  it("TM-008 validateTimingMap rejects non-increasing or duplicate tempo beats", () => {
    const nonIncreasing: TimingMap = {
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 100 },
        { beat: 2, bpm: 90 },
      ],
      startPositionMs: 0,
    };
    const duplicate: TimingMap = {
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 100 },
        { beat: 4, bpm: 90 },
      ],
      startPositionMs: 0,
    };

    expect(() => validateTimingMap(nonIncreasing)).toThrow(RangeError);
    expect(() => validateTimingMap(duplicate)).toThrow(RangeError);
  });

  it("TM-009 validateTimingMap rejects out-of-range bpm", () => {
    const tooLow: TimingMap = { tempos: [{ beat: 0, bpm: 1 }], startPositionMs: 0 };
    const tooHigh: TimingMap = { tempos: [{ beat: 0, bpm: 1000 }], startPositionMs: 0 };
    const nonFinite: TimingMap = { tempos: [{ beat: 0, bpm: Number.NaN }], startPositionMs: 0 };

    expect(() => validateTimingMap(tooLow)).toThrow(RangeError);
    expect(() => validateTimingMap(tooHigh)).toThrow(RangeError);
    expect(() => validateTimingMap(nonFinite)).toThrow(RangeError);
  });

  it("TM-010 validateTimingMap rejects a negative or non-finite startPositionMs", () => {
    const negative: TimingMap = { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: -1 };
    const nonFinite: TimingMap = { tempos: [{ beat: 0, bpm: 120 }], startPositionMs: Number.POSITIVE_INFINITY };

    expect(() => validateTimingMap(negative)).toThrow(RangeError);
    expect(() => validateTimingMap(nonFinite)).toThrow(RangeError);
  });

  it("validateTimingMap rejects empty tempos and non-finite tempo beats", () => {
    expect(() => validateTimingMap({ tempos: [], startPositionMs: 0 })).toThrow(RangeError);
    expect(() =>
      validateTimingMap({ tempos: [{ beat: Number.NaN, bpm: 120 }], startPositionMs: 0 }),
    ).toThrow(RangeError);
  });

  it("TM-011 validateTimingMap rejects wrong-typed fields with TypeError", () => {
    expect(() => validateTimingMap(null as unknown as TimingMap)).toThrow(TypeError);
    expect(() => validateTimingMap({ tempos: "not-an-array", startPositionMs: 0 } as unknown as TimingMap)).toThrow(
      TypeError,
    );
    expect(() =>
      validateTimingMap({ tempos: ["not-an-object"], startPositionMs: 0 } as unknown as TimingMap),
    ).toThrow(TypeError);
    expect(() =>
      validateTimingMap({ tempos: [{ beat: "0", bpm: 120 }], startPositionMs: 0 } as unknown as TimingMap),
    ).toThrow(TypeError);
    expect(() =>
      validateTimingMap({ tempos: [{ beat: 0, bpm: "120" }], startPositionMs: 0 } as unknown as TimingMap),
    ).toThrow(TypeError);
    expect(() =>
      validateTimingMap({ tempos: [{ beat: 0, bpm: 120 }], startPositionMs: "0" } as unknown as TimingMap),
    ).toThrow(TypeError);
  });

  it("TM-012 beatToMs converts across a single-tempo map", () => {
    const timing = createTimingMap({ bpm: 120, startPositionMs: 250 });

    expect(beatToMs(timing, 0)).toBe(250);
    expect(beatToMs(timing, 2)).toBe(1250);
  });

  it("TM-013 beatToMs accumulates across multiple tempo segments", () => {
    const timing = createTimingMap({
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 60 },
      ],
      startPositionMs: 0,
    });

    expect(beatToMs(timing, 4)).toBe(2000);
    expect(beatToMs(timing, 5)).toBe(3000);
  });

  it("beatToMs clamps negative beats and stops inside the first tempo segment", () => {
    const timing = createTimingMap({
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 60 },
      ],
      startPositionMs: 250,
    });

    expect(beatToMs(timing, -2)).toBe(250);
    expect(beatToMs(timing, 2)).toBe(1250);
  });

  it("msToBeat converts inside an intermediate tempo segment", () => {
    const timing = createTimingMap({
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 60 },
        { beat: 8, bpm: 240 },
      ],
      startPositionMs: 0,
    });

    expect(msToBeat(timing, 3_000)).toBe(5);
  });

  it("msToBeat rejects structurally invalid empty tempo maps", () => {
    expect(() => msToBeat({ tempos: [], startPositionMs: 0 }, 1)).toThrow(TypeError);
  });

  it("TM-014 msToBeat is the inverse of beatToMs", () => {
    const timing = createTimingMap({
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 60 },
      ],
      startPositionMs: 250,
    });

    for (const beat of [0, 1.5, 4, 5, 10]) {
      const ms = beatToMs(timing, beat);
      expect(msToBeat(timing, ms)).toBeCloseTo(beat, 10);
    }
  });

  it("TM-015 msToBeat returns beat 0 before startPositionMs", () => {
    const timing = createTimingMap({ bpm: 120, startPositionMs: 250 });

    expect(msToBeat(timing, 0)).toBe(0);
    expect(msToBeat(timing, 249)).toBe(0);
    expect(msToBeat(timing, 250)).toBe(0);
  });

  it("TM-016 beatToMs/msToBeat are pure functions of TimingMap and a transport-relative value, never a clock timestamp", () => {
    const timing = createTimingMap({ bpm: 120, startPositionMs: 250 });

    // Calling repeatedly with the same TimingMap and beat/ms always yields the
    // same result: no hidden dependency on wall-clock time or call order.
    expect(beatToMs(timing, 2)).toBe(beatToMs(timing, 2));
    expect(msToBeat(timing, 1250)).toBe(msToBeat(timing, 1250));
  });
});
