import { describe, expect, it } from "vitest";
import { createProject, setStepValue } from "../project";
import type { SequencerClock, StepEvent } from "../types";
import { ArrangementEngine } from "./ArrangementEngine";
import { createArrangement } from "./project";
import type { ArrangementSectionEvent, ArrangementProject } from "./types";

class FakeClock implements SequencerClock {
  currentTime = 0;
  timers: Array<{ id: number; callback: () => void; dueAt: number }> = [];
  private nextId = 1;

  now(): number {
    return this.currentTime;
  }

  setTimer(callback: () => void, delayMs: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.push({ id, callback, dueAt: this.currentTime + delayMs });
    return id;
  }

  clearTimer(timerId: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== timerId);
  }

  advance(ms: number): void {
    const target = this.currentTime + ms;

    while (true) {
      this.timers.sort((a, b) => a.dueAt - b.dueAt);
      const nextTimer = this.timers[0];
      if (!nextTimer || nextTimer.dueAt > target) {
        break;
      }

      this.timers.shift();
      this.currentTime = nextTimer.dueAt;
      nextTimer.callback();
    }

    this.currentTime = target;
  }

  jumpTo(ms: number): void {
    this.currentTime = ms;
  }
}

// bpm=120 -> msPerBeat = 500ms. Every pattern below uses stepsPerBeat=1, so 1 step = 1 beat = 500ms.
const BEAT_MS = 500;

const buildArrangement = (): ArrangementProject => {
  let intro = createProject({ bpm: 999, stepCount: 2, stepsPerBeat: 1, trackCount: 1, trackNames: ["intro"] });
  const introTrackId = intro.tracks[0].id;
  intro = setStepValue(intro, introTrackId, 0, 0);
  intro = setStepValue(intro, introTrackId, 1, 1);

  let chorus = createProject({ bpm: 999, stepCount: 2, stepsPerBeat: 1, trackCount: 1, trackNames: ["chorus"] });
  const chorusTrackId = chorus.tracks[0].id;
  chorus = setStepValue(chorus, chorusTrackId, 0, 1);
  chorus = setStepValue(chorus, chorusTrackId, 1, 1);

  return createArrangement({
    bpm: 120,
    patterns: { intro, chorus },
    sections: [
      { id: "s1", patternId: "intro", startBeat: 0, endBeat: 2 }, // 0-1000ms
      // gap: beat 2-4 (1000-2000ms)
      { id: "s2", patternId: "chorus", startBeat: 4, endBeat: 6 }, // 2000-3000ms
    ],
  });
};

describe("ArrangementEngine — step/section events", () => {
  it("emits section + step 0 immediately on start", () => {
    const clock = new FakeClock();
    const engine = new ArrangementEngine(buildArrangement(), { clock, lookaheadMs: 50 });
    const steps: StepEvent[] = [];
    const sections: ArrangementSectionEvent[] = [];
    engine.on("step", (e) => steps.push(e));
    engine.on("section", (e) => sections.push(e));

    engine.start();

    expect(sections).toHaveLength(1);
    expect(sections[0].section?.id).toBe("s1");
    expect(steps).toHaveLength(1);
    expect(steps[0].stepIndex).toBe(0);
  });

  it("emits a new step at each beat boundary within the same section", () => {
    const clock = new FakeClock();
    const engine = new ArrangementEngine(buildArrangement(), { clock, lookaheadMs: 50 });
    const steps: StepEvent[] = [];
    engine.on("step", (e) => steps.push(e));
    engine.start();

    clock.advance(BEAT_MS); // beat 1, still in s1
    expect(steps.map((e) => e.stepIndex)).toEqual([0, 1]);
  });

  it("emits a section:null event when entering a gap, and stops emitting steps", () => {
    const clock = new FakeClock();
    const engine = new ArrangementEngine(buildArrangement(), { clock, lookaheadMs: 50 });
    const steps: StepEvent[] = [];
    const sections: ArrangementSectionEvent[] = [];
    engine.on("step", (e) => steps.push(e));
    engine.on("section", (e) => sections.push(e));
    engine.start();

    clock.advance(BEAT_MS * 2); // beat 2 -> gap starts
    expect(sections[sections.length - 1].section).toBeNull();
    const stepCountAtGap = steps.length;

    clock.advance(BEAT_MS); // still in the gap (beat 3)
    expect(steps.length).toBe(stepCountAtGap); // no new step events while in a gap
  });

  it("resets to the next pattern's step 0 exactly at the next section boundary", () => {
    const clock = new FakeClock();
    const engine = new ArrangementEngine(buildArrangement(), { clock, lookaheadMs: 50 });
    const steps: StepEvent[] = [];
    const sections: ArrangementSectionEvent[] = [];
    engine.on("step", (e) => steps.push(e));
    engine.on("section", (e) => sections.push(e));
    engine.start();

    clock.advance(BEAT_MS * 4); // beat 4 -> s2 starts
    expect(sections[sections.length - 1].section?.id).toBe("s2");
    expect(steps[steps.length - 1].stepIndex).toBe(0);
  });

  it("lands on the correct section/step after a forward seek (jump)", () => {
    const clock = new FakeClock();
    const engine = new ArrangementEngine(buildArrangement(), { clock, lookaheadMs: 50 });
    const sections: ArrangementSectionEvent[] = [];
    engine.on("section", (e) => sections.push(e));
    engine.start();

    clock.jumpTo(BEAT_MS * 5); // beat 5 -> mid s2
    clock.timers.shift()?.callback();

    expect(sections[sections.length - 1].section?.id).toBe("s2");
  });
});

describe("ArrangementEngine — sampleChannels", () => {
  it("returns the full track-id union with 0 for inactive-pattern tracks", () => {
    const clock = new FakeClock();
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { clock });
    const introId = arrangement.patterns.intro.tracks[0].id;
    const chorusId = arrangement.patterns.chorus.tracks[0].id;

    const values = engine.sampleChannels(0); // beat 0, in s1 (intro)
    expect(Object.keys(values).sort()).toEqual([introId, chorusId].sort());
    expect(values[chorusId]).toBe(0);
  });

  it("returns 0 for every track in a gap, without needing start()", () => {
    const clock = new FakeClock();
    const engine = new ArrangementEngine(buildArrangement(), { clock });
    const values = engine.sampleChannels(BEAT_MS * 3); // beat 3, in the gap
    expect(Object.values(values).every((v) => v === 0)).toBe(true);
  });

  it("interpolates within the active pattern's step", () => {
    const clock = new FakeClock();
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { clock });
    const introId = arrangement.patterns.intro.tracks[0].id;
    // step0=0, step1=1; at half a beat in, phase=0.5
    expect(engine.sampleChannels(BEAT_MS / 2)[introId]).toBeCloseTo(0.5);
  });
});

describe("ArrangementEngine — loop / reset / dispose", () => {
  it("wraps to the start when loop is true and totalBeats is exceeded", () => {
    const clock = new FakeClock();
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { clock, loop: true });
    const introId = arrangement.patterns.intro.tracks[0].id;
    // totalBeats = 6; beat 6 wraps to beat 0.
    expect(engine.sampleChannels(BEAT_MS * 6)[introId]).toBeCloseTo(engine.sampleChannels(0)[introId]);
  });

  it("reset(beat) re-anchors so the engine reports being at that beat", () => {
    const clock = new FakeClock();
    const arrangement = buildArrangement();
    const engine = new ArrangementEngine(arrangement, { clock, lookaheadMs: 50 });
    const sections: ArrangementSectionEvent[] = [];
    engine.on("section", (e) => sections.push(e));
    engine.start();
    clock.advance(BEAT_MS); // now at beat 1, in s1

    engine.seek(4);

    expect(sections[sections.length - 1].section?.id).toBe("s2");
  });

  it("dispose() stops playback and clears all listeners", () => {
    const clock = new FakeClock();
    const engine = new ArrangementEngine(buildArrangement(), { clock, lookaheadMs: 50 });
    const steps: StepEvent[] = [];
    engine.on("step", (e) => steps.push(e));
    engine.start();
    engine.dispose();

    expect(engine.isPlaying()).toBe(false);
    clock.advance(BEAT_MS * 10);
    expect(steps).toHaveLength(1); // only the initial step from start(), nothing after dispose
  });

  it("anchors beat 0 on first start when originMs is omitted", () => {
    const clock = new FakeClock();
    clock.jumpTo(10_000);
    const engine = new ArrangementEngine(buildArrangement(), { clock });
    const sections: ArrangementSectionEvent[] = [];
    engine.on("section", (event) => sections.push(event));
    engine.start();
    expect(sections.at(-1)?.section?.id).toBe("s1");
  });

  it("resumes from the stopped beat without counting wall-clock pause time", () => {
    const clock = new FakeClock();
    const engine = new ArrangementEngine(buildArrangement(), { clock, lookaheadMs: 50 });
    const steps: StepEvent[] = [];
    engine.on("step", (event) => steps.push(event));
    engine.start();
    clock.advance(BEAT_MS);
    engine.stop();
    clock.advance(BEAT_MS * 10);
    engine.start();
    expect(steps.at(-1)?.stepIndex).toBe(1);
  });

  it("ends and stops polling at the final section boundary", () => {
    const clock = new FakeClock();
    const engine = new ArrangementEngine(buildArrangement(), { clock, lookaheadMs: 50 });
    const transport: string[] = [];
    engine.on("transport", (event) => transport.push(event.type));
    engine.start();
    clock.advance(BEAT_MS * 6);
    expect(engine.isPlaying()).toBe(false);
    expect(transport).toEqual(["start", "end"]);
    expect(clock.timers).toHaveLength(0);
  });

  it("seek emits transport, section, and step synchronously", () => {
    const clock = new FakeClock();
    const engine = new ArrangementEngine(buildArrangement(), { clock });
    const events: string[] = [];
    engine.on("transport", (event) => events.push(event.type));
    engine.on("section", (event) => events.push(`section:${event.section?.id ?? "gap"}`));
    engine.on("step", (event) => events.push(`step:${event.stepIndex}`));
    engine.seek(4);
    expect(events).toEqual(["seek", "section:s2", "step:0"]);
  });

  it("rejects an invalid hot-swap without replacing the current arrangement", () => {
    const clock = new FakeClock();
    const original = buildArrangement();
    const engine = new ArrangementEngine(original, { clock });
    const invalid = { ...original, sections: [{ ...original.sections[0], patternId: "missing" }] };
    expect(() => engine.setArrangement(invalid)).toThrow(/Invalid arrangement/);
    expect(engine.getArrangement().sections).toHaveLength(2);
  });

  it("preserves the current beat across a valid hot-swap", () => {
    const clock = new FakeClock();
    const original = buildArrangement();
    const engine = new ArrangementEngine(original, { clock, lookaheadMs: 50 });
    engine.start();
    clock.advance(BEAT_MS);
    const replacement = createArrangement({
      bpm: 60,
      patterns: original.patterns,
      sections: original.sections,
    });
    engine.setArrangement(replacement);
    const introId = replacement.patterns.intro.tracks[0].id;
    expect(engine.sampleChannels(clock.now())[introId]).toBe(1);
  });
});
