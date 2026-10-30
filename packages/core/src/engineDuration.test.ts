import { describe, expect, it } from "vitest";
import { ArrangementEngine } from "./arrangement/ArrangementEngine";
import { createArrangement } from "./arrangement/project";
import { browserClock } from "./clock";
import { createClockTransport } from "./playbackTransport";
import { createProject } from "./project";
import { SequencerEngine } from "./SequencerEngine";
import { TimelineEngine } from "./timeline/TimelineEngine";
import { createTimelineProject } from "./timeline/project";
import { beatToMs } from "./timeline/timing";

const disposed = expect.objectContaining({ code: "TRANSPORT_DISPOSED" });

describe("SequencerEngine duration getters", () => {
  it("report one pass of the pattern and follow setProject, including a BPM change", () => {
    const engine = new SequencerEngine(createProject({ bpm: 120, stepCount: 16, stepsPerBeat: 4 }));
    expect(engine.getDurationBeats()).toBe(4);
    expect(engine.getDurationMs()).toBe(2000);

    engine.setProject(createProject({ bpm: 90, stepCount: 12, stepsPerBeat: 3 }));
    expect(engine.getDurationBeats()).toBe(4);
    expect(engine.getDurationMs()).toBeCloseTo((4 * 60_000) / 90);

    engine.dispose();
    expect(() => engine.getDurationBeats()).toThrowError(disposed);
    expect(() => engine.getDurationMs()).toThrowError(disposed);
  });

  it("is the pattern length, not the transport's media length", () => {
    const transport = createClockTransport(browserClock, { durationMs: 9000 });
    const engine = new SequencerEngine(createProject({ bpm: 120, stepCount: 8, stepsPerBeat: 4 }), { transport });
    expect(engine.getDurationMs()).toBe(1000);
    expect(transport.getDurationMs()).toBe(9000);
    engine.dispose();
  });
});

describe("ArrangementEngine duration getters", () => {
  it("report local end, including a tempo change and a negative startPositionMs, and follow setProject", () => {
    const pattern = createProject({ bpm: 120, stepCount: 4, stepsPerBeat: 4 });
    const arrangement = createArrangement({
      timing: { tempos: [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60 }], startPositionMs: -100 },
      durationBeats: 8,
      patterns: { a: pattern },
      sections: [{ id: "a", patternId: "a", startBeat: 0, endBeat: 8 }],
    });
    const engine = new ArrangementEngine(arrangement);
    expect(engine.getDurationBeats()).toBe(8);
    expect(engine.getDurationMs()).toBe(beatToMs(arrangement.timing, 8));
    expect(engine.getDurationMs()).toBe(-100 + 2000 + 4000);

    engine.setProject({ ...arrangement, durationBeats: 6, sections: [{ id: "a", patternId: "a", startBeat: 0, endBeat: 6 }] });
    expect(engine.getDurationBeats()).toBe(6);
    expect(engine.getDurationMs()).toBe(-100 + 2000 + 2000);

    engine.dispose();
    expect(() => engine.getDurationBeats()).toThrowError(disposed);
    expect(() => engine.getDurationMs()).toThrowError(disposed);
  });
});

describe("TimelineEngine duration getters", () => {
  it("report local end and follow setProject", () => {
    const project = createTimelineProject({ timing: { bpm: 120, startPositionMs: 250 }, durationBeats: 16 });
    const engine = new TimelineEngine(project);
    expect(engine.getDurationBeats()).toBe(16);
    expect(engine.getDurationMs()).toBe(250 + 8000);

    engine.setProject({ ...project, durationBeats: 4 });
    expect(engine.getDurationBeats()).toBe(4);
    expect(engine.getDurationMs()).toBe(250 + 2000);

    engine.dispose();
    expect(() => engine.getDurationBeats()).toThrowError(disposed);
    expect(() => engine.getDurationMs()).toThrowError(disposed);
  });
});
