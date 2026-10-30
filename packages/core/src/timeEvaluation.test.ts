import { describe, expect, it } from "vitest";
import { createArrangement } from "./arrangement/project";
import { sampleArrangement } from "./arrangement/resolve";
import type { ArrangementProject } from "./arrangement/types";
import { easeOutQuad, hold, linear } from "./easing";
import { createProject } from "./project";
import { SequencerEngine } from "./SequencerEngine";
import { beatToMs, msToBeat } from "./timeline/timing";
import { envelopeAt, lastStepAt, nextStepAt, sampleProject } from "./timeEvaluation";
import type { SequenceProject } from "./types";

// 120 BPM, 4 steps per beat: one step is 125 ms, the pattern is 1000 ms.
const pattern = (steps: number[], extra: { enabled?: boolean } = {}): SequenceProject => {
  const project = createProject({
    bpm: 120,
    stepCount: steps.length,
    stepsPerBeat: 4,
    tracks: [{ id: "kick", name: "kick", steps }],
  });
  return extra.enabled === false
    ? { ...project, tracks: project.tracks.map((track) => ({ ...track, enabled: false })) }
    : project;
};

const kick = pattern([1, 0, 0, 0, 0.5, 0, 0, 0]);

// Sections of 2 beats (1000 ms) at 120 BPM, with a 1-beat gap between them.
const arrangementOf = (overrides: Partial<Parameters<typeof createArrangement>[0]> = {}): ArrangementProject =>
  createArrangement({
    timing: { bpm: 120 },
    durationBeats: 6,
    patterns: {
      a: pattern([1, 0, 0, 0]),
      b: pattern([0, 0.25, 0, 0, 0, 0, 0, 0.75]),
    },
    sections: [
      { id: "a", patternId: "a", startBeat: 0, endBeat: 2 },
      { id: "b", patternId: "b", startBeat: 3, endBeat: 5 },
    ],
    ...overrides,
  });

describe("sampleProject", () => {
  it("equals SequencerEngine#sampleChannelsAt at non-negative positions", () => {
    const project = pattern([0.2, 0.9, 0, 1, 0.4, 0, 0.7, 0.1]);
    const engine = new SequencerEngine(project);
    const positions = [0, 1, 62.5, 124.999, 125, 999.9, 1000, 1234.5, 98765.4321];
    for (let i = 0; i < 200; i += 1) positions.push(((i * 7919) % 100_000) / 7.3);

    for (const positionMs of positions) {
      for (const easing of [linear, easeOutQuad, hold]) {
        expect(sampleProject(project, positionMs, easing)).toEqual(engine.sampleChannelsAt(positionMs, easing));
      }
    }
    engine.dispose();
  });

  it("wraps negative positions around the pattern instead of throwing", () => {
    const project = pattern([0.2, 0.9, 0, 1, 0.4, 0, 0.7, 0.1]);
    expect(sampleProject(project, -125)).toEqual(sampleProject(project, 875));
    expect(sampleProject(project, -1062.5)).toEqual(sampleProject(project, 937.5));
  });

  it("holds each step's value with the hold easing", () => {
    const project = pattern([0.2, 0.9]);
    expect(sampleProject(project, 100, hold)).toEqual({ kick: 0.2 });
    expect(sampleProject(project, 100, linear).kick).toBeCloseTo(0.76);
  });

  it("samples disabled tracks to 0 and rejects non-finite positions", () => {
    expect(sampleProject(pattern([1, 1], { enabled: false }), 10)).toEqual({ kick: 0 });
    expect(() => sampleProject(kick, Number.NaN)).toThrow(RangeError);
    expect(() => sampleProject(kick, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("hold", () => {
  it("is always 0", () => {
    for (const t of [-1, 0, 0.5, 1, 2]) expect(hold(t)).toBe(0);
  });
});

describe("sampleArrangement loop option", () => {
  it("wraps beats past the end and before 0 only with loop", () => {
    const arrangement = arrangementOf();
    const ids = ["kick"];
    expect(sampleArrangement(arrangement, 6.5, hold, ids)).toEqual({ kick: 0 });
    expect(sampleArrangement(arrangement, 6, hold, ids, { loop: true })).toEqual(sampleArrangement(arrangement, 0, hold, ids));
    expect(sampleArrangement(arrangement, 9.75, hold, ids, { loop: true })).toEqual(
      sampleArrangement(arrangement, 3.75, hold, ids),
    );
    expect(sampleArrangement(arrangement, -2.25, hold, ids, { loop: true })).toEqual(
      sampleArrangement(arrangement, 3.75, hold, ids),
    );
    expect(sampleArrangement(arrangement, -2.25, hold, ids)).toEqual({ kick: 0 });
    expect(sampleArrangement(arrangement, 3.75, hold, ids, { loop: true })).toEqual(
      sampleArrangement(arrangement, 3.75, hold, ids),
    );
  });

  it("wraps in ms like the Engine's local loop when the tempo changes", () => {
    // 120 BPM for 3 beats, then 60 BPM: durationBeats 6 is 4500 ms.
    const tempoChange = createArrangement({
      timing: { tempos: [{ beat: 0, bpm: 120 }, { beat: 3, bpm: 60 }] },
      durationBeats: 6,
      patterns: { a: pattern([1, 0.2, 0.4, 0.6]) },
      sections: [{ id: "a", patternId: "a", startBeat: 0, endBeat: 6 }],
    });
    // 4900 ms wraps to 400 ms = beat 0.8 = step 3.
    const beat = msToBeat(tempoChange.timing, 4900);
    expect(sampleArrangement(tempoChange, beat, hold, ["kick"], { loop: true })).toEqual({ kick: 0.6 });
    expect(lastStepAt(tempoChange, 4900, "kick", { loop: true })).toMatchObject({ value: 0.6, positionMs: 4875 });
  });

  it("wraps beats before transport position 0 to the end of the loop", () => {
    // Beat 0 is 250 ms before transport 0; the section ends at 750 ms, so the
    // loop end (2750 ms) is in a gap.
    const shifted = createArrangement({
      timing: { bpm: 120, startPositionMs: -250 },
      durationBeats: 6,
      patterns: { a: pattern([1, 1, 1, 1]) },
      sections: [{ id: "a", patternId: "a", startBeat: 0, endBeat: 2 }],
    });
    expect(sampleArrangement(shifted, 0.25, hold, ["kick"])).toEqual({ kick: 1 });
    expect(sampleArrangement(shifted, 0.25, hold, ["kick"], { loop: true })).toEqual({ kick: 0 });
    expect(sampleArrangement(shifted, -1, hold, ["kick"], { loop: true })).toEqual({ kick: 0 });
  });

  it("starts the loop at transport position 0 when startPositionMs is negative", () => {
    // Beat 0 is 250 ms before transport 0, so the loop runs from beat 0.5 to 6.
    const arrangement = arrangementOf({ timing: { bpm: 120, startPositionMs: -250 } });
    expect(sampleArrangement(arrangement, 6.25, hold, ["kick"], { loop: true })).toEqual(
      sampleArrangement(arrangement, 0.75, hold, ["kick"]),
    );
  });
});

describe("lastStepAt / nextStepAt on a SequenceProject", () => {
  it("finds the last firing step at or before the position", () => {
    expect(lastStepAt(kick, 0, "kick")).toEqual({ value: 1, positionMs: 0, elapsedMs: 0 });
    expect(lastStepAt(kick, 400, "kick")).toEqual({ value: 1, positionMs: 0, elapsedMs: 400 });
    expect(lastStepAt(kick, 500, "kick")).toEqual({ value: 0.5, positionMs: 500, elapsedMs: 0 });
    expect(lastStepAt(kick, 2600, "kick")).toEqual({ value: 0.5, positionMs: 2500, elapsedMs: 100 });
  });

  it("wraps back across the loop point, including from negative positions", () => {
    expect(lastStepAt(kick, -100, "kick")).toEqual({ value: 0.5, positionMs: -500, elapsedMs: 400 });
    const single = pattern([0, 0, 1, 0]);
    expect(lastStepAt(single, 100, "kick")).toEqual({ value: 1, positionMs: -250, elapsedMs: 350 });
  });

  it("finds the next firing step strictly after the position", () => {
    expect(nextStepAt(kick, 0, "kick")).toEqual({ value: 0.5, positionMs: 500, remainingMs: 500 });
    expect(nextStepAt(kick, 600, "kick")).toEqual({ value: 1, positionMs: 1000, remainingMs: 400 });
    expect(nextStepAt(kick, -100, "kick")).toEqual({ value: 1, positionMs: 0, remainingMs: 100 });
  });

  it("returns null for a missing, disabled, or silent track", () => {
    expect(lastStepAt(kick, 100, "hat")).toBeNull();
    expect(lastStepAt(pattern([1, 1], { enabled: false }), 100, "kick")).toBeNull();
    expect(lastStepAt(pattern([0, 0, 0]), 100, "kick")).toBeNull();
    expect(nextStepAt(pattern([0, 0, 0]), 100, "kick")).toBeNull();
  });

  it("decides the step at a boundary in ms when position / step length rounds", () => {
    // 97 BPM, 3 steps per beat: 11 * stepMs divides to just under 11, and the
    // float just below 9 * stepMs divides to exactly 9.
    const project = createProject({ bpm: 97, stepCount: 4, stepsPerBeat: 3, tracks: [{ id: "kick", steps: [1, 1, 1, 1] }] });
    const stepMs = 60_000 / 97 / 3;
    expect(lastStepAt(project, 11 * stepMs, "kick")).toEqual({ value: 1, positionMs: 11 * stepMs, elapsedMs: 0 });
    expect(nextStepAt(project, 11 * stepMs, "kick")?.positionMs).toBe(12 * stepMs);
    const justBefore = 1855.6701030927832;
    expect(justBefore).toBeLessThan(9 * stepMs);
    expect(lastStepAt(project, justBefore, "kick")?.positionMs).toBe(8 * stepMs);
    expect(nextStepAt(project, justBefore, "kick")?.positionMs).toBe(9 * stepMs);
  });

  it("ignores the loop option and rejects non-finite positions", () => {
    expect(lastStepAt(kick, 2600, "kick", { loop: false })).toEqual(lastStepAt(kick, 2600, "kick"));
    expect(() => lastStepAt(kick, Number.NaN, "kick")).toThrow(RangeError);
    expect(() => nextStepAt(kick, Number.NEGATIVE_INFINITY, "kick")).toThrow(RangeError);
  });
});

describe("lastStepAt / nextStepAt on an ArrangementProject", () => {
  // a: step 0 (0 ms) fires 1, loop-filled at 500 ms; gap 1000–1500 ms;
  // b (starts 1500 ms): step 1 (1625 ms) 0.25, step 7 (2375 ms) 0.75.
  const arrangement = arrangementOf();

  it("walks back across a gap into a section with a different pattern", () => {
    expect(lastStepAt(arrangement, 1200, "kick")).toEqual({ value: 1, positionMs: 500, elapsedMs: 700 });
    expect(lastStepAt(arrangement, 1625, "kick")).toEqual({ value: 0.25, positionMs: 1625, elapsedMs: 0 });
    expect(lastStepAt(arrangement, 1624.9, "kick")?.positionMs).toBe(500);
    expect(nextStepAt(arrangement, 600, "kick")).toEqual({ value: 0.25, positionMs: 1625, remainingMs: 1025 });
    expect(nextStepAt(arrangement, 1625, "kick")).toEqual({ value: 0.75, positionMs: 2375, remainingMs: 750 });
  });

  it("stops at the ends without loop", () => {
    expect(lastStepAt(arrangement, 2900, "kick")).toEqual({ value: 0.75, positionMs: 2375, elapsedMs: 525 });
    expect(nextStepAt(arrangement, 2400, "kick")).toBeNull();
    expect(lastStepAt(arrangement, -10, "kick")).toBeNull();
    expect(nextStepAt(arrangement, -10, "kick")).toEqual({ value: 1, positionMs: 0, remainingMs: 10 });
  });

  it("crosses the loop point with loop", () => {
    // The loop is 3000 ms long.
    expect(nextStepAt(arrangement, 2400, "kick", { loop: true })).toEqual({ value: 1, positionMs: 3000, remainingMs: 600 });
    expect(lastStepAt(arrangement, 3100, "kick", { loop: true })).toEqual({ value: 1, positionMs: 3000, elapsedMs: 100 });
    expect(lastStepAt(arrangement, -10, "kick", { loop: true })).toEqual({ value: 0.75, positionMs: -625, elapsedMs: 615 });
    const lateOnly = arrangementOf({
      sections: [{ id: "b", patternId: "b", startBeat: 3, endBeat: 5 }],
    });
    expect(lastStepAt(lateOnly, 3100, "kick", { loop: true })).toEqual({ value: 0.75, positionMs: 2375, elapsedMs: 725 });
  });

  it("starts each loop iteration with the step under way at transport position 0", () => {
    // Beat 0 is 100 ms before transport 0; a's step 0 runs from -100 to 25 ms.
    const shifted = arrangementOf({ timing: { bpm: 120, startPositionMs: -100 } });
    expect(lastStepAt(shifted, 10, "kick", { loop: true })).toEqual({ value: 1, positionMs: 0, elapsedMs: 10 });
    expect(lastStepAt(shifted, 10, "kick")).toEqual({ value: 1, positionMs: -100, elapsedMs: 110 });
    expect(nextStepAt(shifted, 2900 - 100 + 50, "kick", { loop: true })?.positionMs).toBe(2900);
  });

  it("skips sections whose pattern lacks the track or is missing", () => {
    const withoutKick = createProject({ bpm: 120, stepCount: 4, stepsPerBeat: 4, tracks: [{ id: "hat", steps: [1, 1, 1, 1] }] });
    const mixed = arrangementOf({
      patterns: { a: pattern([1, 0, 0, 0]), b: withoutKick },
      sections: [
        { id: "a", patternId: "a", startBeat: 0, endBeat: 1 },
        { id: "b", patternId: "b", startBeat: 1, endBeat: 2 },
      ],
    });
    expect(lastStepAt(mixed, 900, "kick")).toEqual({ value: 1, positionMs: 0, elapsedMs: 900 });
    expect(nextStepAt(mixed, 100, "kick")).toBeNull();
    const dangling = { ...mixed, sections: [...mixed.sections, { id: "c", patternId: "missing", startBeat: 2, endBeat: 3 }] };
    expect(lastStepAt(dangling, 1400, "kick")?.positionMs).toBe(0);
  });

  it("drops steps that end before transport position 0 from a loop", () => {
    // Beat 0 is 300 ms before transport 0: a's steps 0 and 1 end before 0,
    // step 2 is under way at 0 (silent), step 4 (loop-fill of step 0) fires.
    const shifted = arrangementOf({ timing: { bpm: 120, startPositionMs: -300 } });
    const loopMs = beatToMs(shifted.timing, shifted.durationBeats);
    expect(lastStepAt(shifted, 10, "kick")).toEqual({ value: 1, positionMs: -300, elapsedMs: 310 });
    expect(lastStepAt(shifted, 10, "kick", { loop: true })?.positionMs).toBe(beatToMs(shifted.timing, 4.75) - loopMs);
    expect(nextStepAt(shifted, loopMs - 10, "kick", { loop: true })?.positionMs).toBe(loopMs + 200);
  });

  it("finds a step exactly on its start at a tempo where ms to beat rounds", () => {
    const odd = createArrangement({
      timing: { bpm: 137, startPositionMs: -29.3 },
      durationBeats: 16,
      patterns: { a: pattern([1, 1, 1, 1]) },
      sections: [{ id: "a", patternId: "a", startBeat: 1, endBeat: 16 }],
    });
    for (let step = 0; step < 60; step += 1) {
      const startMs = beatToMs(odd.timing, 1 + step / 4);
      expect(lastStepAt(odd, startMs, "kick")?.elapsedMs).toBe(0);
      expect(nextStepAt(odd, startMs - 1e-6, "kick")?.positionMs).toBe(startMs);
    }
  });
});

describe("envelopeAt", () => {
  it("peaks on the step, scaled by the value, and decays", () => {
    expect(envelopeAt(kick, 0, "kick")).toBe(1);
    expect(envelopeAt(kick, 150, "kick", { decayMs: 300 })).toBeCloseTo(0.5);
    expect(envelopeAt(kick, 300, "kick", { decayMs: 300 })).toBe(0);
    expect(envelopeAt(kick, 500, "kick", { peak: 0.8 })).toBeCloseTo(0.4);
  });

  it("rises over leadMs before the step", () => {
    expect(envelopeAt(kick, 450, "kick", { leadMs: 100, decayMs: 50 })).toBeCloseTo(0.25);
    expect(envelopeAt(kick, 399, "kick", { leadMs: 100, decayMs: 50 })).toBe(0);
    // Overlapping fall and rise: the larger value wins.
    expect(envelopeAt(kick, 450, "kick", { leadMs: 100, decayMs: 600 })).toBeCloseTo(0.25);
  });

  it("gives the same value forwards, backwards, and repeatedly", () => {
    const options = { leadMs: 80, decayMs: 220, curve: easeOutQuad, loop: true };
    const arrangement = arrangementOf();
    const positions = Array.from({ length: 400 }, (_, i) => i * 17.3 - 500);
    for (const source of [kick, arrangement]) {
      const forwards = positions.map((p) => envelopeAt(source, p, "kick", options));
      const backwards = [...positions].reverse().map((p) => envelopeAt(source, p, "kick", options)).reverse();
      expect(backwards).toEqual(forwards);
      expect(positions.map((p) => envelopeAt(source, p, "kick", options))).toEqual(forwards);
      for (const value of forwards) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is 0 when the track never fires", () => {
    expect(envelopeAt(pattern([0, 0]), 10, "kick", { leadMs: 50 })).toBe(0);
  });
});
