import { beatToMs, createProject, createTimelineProject, renameTrack, setStepValue } from "@vixeq/core";
import type { SequenceProject, TimelineEvent, TimelineProject } from "@vixeq/core";

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

/** Explicit track ID mapping for use with useAnimatedChannels / bindChannelsToElement. */
export const brandTrackIds = {
  beat: brandProject.tracks[0]!.id,
  cta:  brandProject.tracks[1]!.id,
  eq:   brandProject.tracks[2]!.id,
  mood: brandProject.tracks[3]!.id,
} as const;

export type WebsitePulseScene = "arrival" | "surge" | "signal" | "afterglow";

export type WebsitePulseSceneState = {
  scene: WebsitePulseScene;
  label: string;
  accent: string;
};

export type WebsitePulseSceneCue = TimelineEvent<"scene", WebsitePulseSceneState>;

export type WebsitePulseCaptionCue = TimelineEvent<"caption", {
  caption: string;
}>;

export type WebsitePulseTimelineEvent = WebsitePulseSceneCue | WebsitePulseCaptionCue;

export const initialSceneCue: WebsitePulseSceneState = {
  scene: "arrival",
  label: "Arrival",
  accent: "#00e5ff",
};

export const initialCaption = "Signal locked. The room warms up on the first downbeat.";

export const brandTimelineProject = createTimelineProject({
  timing: { bpm: 120 },
  durationBeats: 8,
  events: [
    { id: "scene-arrival", trackId: null, beat: 0, type: "scene", data: initialSceneCue },
    { id: "caption-arrival", trackId: null, beat: 0, type: "caption", data: { caption: initialCaption } },
    {
      id: "scene-surge",
      trackId: null,
      beat: 2,
      type: "scene",
      data: { scene: "surge", label: "Surge", accent: "#ff2d78" },
    },
    {
      id: "caption-surge",
      trackId: null,
      beat: 2,
      type: "caption",
      data: { caption: "Bass cues push the hero controls and visualizer into focus." },
    },
    {
      id: "scene-signal",
      trackId: null,
      beat: 4,
      type: "scene",
      data: { scene: "signal", label: "Signal", accent: "#b06fff" },
    },
    {
      id: "caption-signal",
      trackId: null,
      beat: 4,
      type: "caption",
      data: { caption: "Timeline cues now drive the caption while sequencer channels keep pulsing." },
    },
    {
      id: "scene-afterglow",
      trackId: null,
      beat: 6,
      type: "scene",
      data: { scene: "afterglow", label: "Afterglow", accent: "#ffaa00" },
    },
    {
      id: "caption-afterglow",
      trackId: null,
      beat: 6,
      type: "caption",
      data: { caption: "The final two beats resolve into the warm mood wash before the loop can restart." },
    },
  ],
}) as TimelineProject<WebsitePulseTimelineEvent>;

export const brandTimelineDurationMs = beatToMs(
  brandTimelineProject.timing,
  brandTimelineProject.durationBeats,
);
