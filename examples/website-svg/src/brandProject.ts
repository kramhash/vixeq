import { createProject, setStepValue } from "@vixeq/core";
import type { SequenceProject } from "@vixeq/core";

const set = (project: SequenceProject, trackId: string, stepIndex: number, value: number) =>
  setStepValue(project, trackId, stepIndex, value);

const build = (): SequenceProject => {
  let p = createProject({ bpm: 110, stepCount: 16, trackCount: 4 });
  const [t0, t1, t2, t3] = p.tracks.map((t) => t.id);

  // track0: outer ring scale
  [0, 4, 8, 12].forEach((i) => { p = set(p, t0, i, 1.0); });
  [2, 6, 10, 14].forEach((i) => { p = set(p, t0, i, 0.4); });

  // track1: inner path opacity
  [0, 8].forEach((i) => { p = set(p, t1, i, 1.0); });
  [4, 12].forEach((i) => { p = set(p, t1, i, 0.6); });

  // track2: stroke width
  [0, 1, 4, 5, 8, 9, 12, 13].forEach((i) => { p = set(p, t2, i, 0.8); });

  // track3: accent arm rotation
  [0, 3, 6, 9].forEach((i) => { p = set(p, t3, i, 1.0); });

  return p;
};

export const brandProject = build();
