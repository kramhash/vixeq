import { describe, expect, it } from "vitest";
import { createProject, setStepValue } from "../project";
import { createArrangement } from "./project";
import { arrangementDurationBeats, resolveArrangementStep, sampleArrangement, sectionAtBeat, unionTrackIds } from "./resolve";
import type { ArrangementProject } from "./types";

const buildBasicArrangement = (): ArrangementProject => {
  let intro = createProject({ bpm: 999, stepCount: 4, stepsPerBeat: 1, trackCount: 1 });
  const introTrackId = intro.tracks[0].id;
  intro = setStepValue(intro, introTrackId, 0, 0);
  intro = setStepValue(intro, introTrackId, 1, 1);

  let chorus = createProject({ bpm: 999, stepCount: 2, stepsPerBeat: 1, trackCount: 1, trackNames: ["chorus-track"] });
  const chorusTrackId = chorus.tracks[0].id;
  chorus = setStepValue(chorus, chorusTrackId, 0, 1);
  chorus = setStepValue(chorus, chorusTrackId, 1, 1);

  return createArrangement({
    timing: { bpm: 120 },
    durationBeats: 12,
    patterns: { intro, chorus },
    sections: [
      { id: "s1", patternId: "intro", startBeat: 0, endBeat: 4 },
      { id: "s2", patternId: "chorus", startBeat: 8, endBeat: 12 },
    ],
  });
};

describe("unionTrackIds", () => {
  it("returns the union of every pattern's track ids, first-seen order, deduped", () => {
    const arrangement = buildBasicArrangement();
    const ids = unionTrackIds(arrangement);
    expect(ids).toEqual([
      arrangement.patterns.intro.tracks[0].id,
      arrangement.patterns.chorus.tracks[0].id,
    ]);
  });
});

describe("sectionAtBeat", () => {
  it("AR-004 uses explicit durationBeats so a trailing gap can be part of the project", () => {
    const arrangement = { ...buildBasicArrangement(), durationBeats: 16 };

    expect(arrangementDurationBeats(arrangement)).toBe(16);
    expect(sectionAtBeat(arrangement, 13)).toBeNull();
  });

  it("resolves the section containing a beat", () => {
    const arrangement = buildBasicArrangement();
    const lookup = sectionAtBeat(arrangement, 1.5);
    expect(lookup?.section.id).toBe("s1");
    expect(lookup?.localBeat).toBeCloseTo(1.5);
  });

  it("returns null for a gap between sections", () => {
    const arrangement = buildBasicArrangement();
    expect(sectionAtBeat(arrangement, 5)).toBeNull();
  });

  it("returns null before beat 0", () => {
    const arrangement = buildBasicArrangement();
    expect(sectionAtBeat(arrangement, -1)).toBeNull();
  });

  it("returns null past the last section's endBeat when not looping", () => {
    const arrangement = buildBasicArrangement();
    expect(sectionAtBeat(arrangement, 100)).toBeNull();
  });

});

describe("resolveArrangementStep", () => {
  it("loop-fills a pattern shorter than its section (loop埋め)", () => {
    // intro: stepCount=4, stepsPerBeat=1 -> pattern natural length = 4 beats.
    // section s1 is exactly 4 beats (0-4), so this covers exactly one pass.
    // Use a section longer than the pattern to exercise the loop-fill.
    const intro = createProject({ bpm: 999, stepCount: 2, stepsPerBeat: 1, trackCount: 1 });
    const arrangement = createArrangement({
      timing: { bpm: 120 },
      durationBeats: 8,
      patterns: { intro },
      sections: [{ id: "s1", patternId: "intro", startBeat: 0, endBeat: 8 }],
    });

    // Pattern loops every 2 beats: beat 0->step0, 1->step1, 2->step0 (2nd pass), ...
    expect(resolveArrangementStep(arrangement, 0)?.stepIndex).toBe(0);
    expect(resolveArrangementStep(arrangement, 1)?.stepIndex).toBe(1);
    expect(resolveArrangementStep(arrangement, 2)?.stepIndex).toBe(0);
    expect(resolveArrangementStep(arrangement, 3)?.stepIndex).toBe(1);
    expect(resolveArrangementStep(arrangement, 6)?.stepIndex).toBe(0);
    expect(resolveArrangementStep(arrangement, 7)?.stepIndex).toBe(1);
  });

  it("resets to the next pattern's step 0 exactly at a section boundary", () => {
    const arrangement = buildBasicArrangement();
    // s2 starts at beat 8, regardless of where s1 left off (s1 ends at beat 4).
    const atBoundary = resolveArrangementStep(arrangement, 8);
    expect(atBoundary?.section.id).toBe("s2");
    expect(atBoundary?.stepIndex).toBe(0);
  });

  it("returns null in a gap", () => {
    const arrangement = buildBasicArrangement();
    expect(resolveArrangementStep(arrangement, 6)).toBeNull();
  });
});

describe("sampleArrangement", () => {
  it("always returns the full union of track ids", () => {
    const arrangement = buildBasicArrangement();
    const introTrackId = arrangement.patterns.intro.tracks[0].id;
    const chorusTrackId = arrangement.patterns.chorus.tracks[0].id;

    for (const beat of [0, 6, 8, 100]) {
      const values = sampleArrangement(arrangement, beat);
      expect(Object.keys(values).sort()).toEqual([introTrackId, chorusTrackId].sort());
    }
  });

  it("outputs 0 for every track in a gap", () => {
    const arrangement = buildBasicArrangement();
    const values = sampleArrangement(arrangement, 6);
    expect(Object.values(values).every((v) => v === 0)).toBe(true);
  });

  it("outputs 0 for every track past the end when not looping", () => {
    const arrangement = buildBasicArrangement();
    const values = sampleArrangement(arrangement, 100);
    expect(Object.values(values).every((v) => v === 0)).toBe(true);
  });

  it("outputs 0 for a track that belongs to a pattern not currently active", () => {
    const arrangement = buildBasicArrangement();
    const chorusTrackId = arrangement.patterns.chorus.tracks[0].id;
    const values = sampleArrangement(arrangement, 0.5); // inside s1 (intro)
    expect(values[chorusTrackId]).toBe(0);
  });

  it("interpolates value -> nextValue within a step using the active pattern", () => {
    const arrangement = buildBasicArrangement();
    const introTrackId = arrangement.patterns.intro.tracks[0].id;
    // intro step0=0, step1=1; at localBeat 0.5 within step0 (stepsPerBeat=1) -> phase 0.5
    expect(sampleArrangement(arrangement, 0.5)[introTrackId]).toBeCloseTo(0.5);
  });

});
