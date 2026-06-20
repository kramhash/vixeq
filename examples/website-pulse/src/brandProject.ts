import { createProject, renameTrack, setStepValue } from "@vixeq/core";
import type { SequenceProject } from "@vixeq/core";

const set = (project: SequenceProject, trackId: string, stepIndex: number, value: number) =>
  setStepValue(project, trackId, stepIndex, value);

const build = (): SequenceProject => {
  let p = createProject({ bpm: 120, stepCount: 16, trackCount: 4 });
  const [t0, t1, t2, t3] = p.tracks.map((t) => t.id);

  p = renameTrack(p, t0, "Kick");
  p = renameTrack(p, t1, "Bass");
  p = renameTrack(p, t2, "Visualizer");
  p = renameTrack(p, t3, "Mood");

  // track0: Kick — 4-on-the-floor downbeats
  [0, 4, 8, 12].forEach((i) => { p = set(p, t0, i, 1.0); });

  // track1: Bass / CTA — syncopated groove
  [2, 6, 10, 14].forEach((i) => { p = set(p, t1, i, 0.9); });
  [0, 8].forEach((i) => { p = set(p, t1, i, 0.55); });

  // track2: Visualizer — dense 16th-note bursts on beats 1 & 3
  [0, 1, 2, 3, 8, 9, 10, 11].forEach((i) => { p = set(p, t2, i, 0.85); });
  [4, 12].forEach((i) => { p = set(p, t2, i, 0.45); });

  // track3: Mood — sparse, slow swells
  [0, 8].forEach((i) => { p = set(p, t3, i, 1.0); });

  return p;
};

export const brandProject = build();
