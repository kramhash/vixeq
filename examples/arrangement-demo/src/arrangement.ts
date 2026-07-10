import { createArrangement } from "@vixeq/core";
import { chorusPattern, introPattern } from "./patterns";

/**
 * A 4-section, 32-beat (16s @ 120bpm) arrangement: Intro -> Chorus -> Intro
 * -> Chorus, looping. This is the shape the roadmap describes: a song
 * structure built out of a small pattern library, sequenced on a shared
 * beat timeline rather than one pattern looping forever.
 */
export const arrangement = createArrangement({
  timing: { bpm: 120 },
  durationBeats: 32,
  patterns: { intro: introPattern, chorus: chorusPattern },
  sections: [
    { id: "intro-1", patternId: "intro", startBeat: 0, endBeat: 8 },
    { id: "chorus-1", patternId: "chorus", startBeat: 8, endBeat: 16 },
    { id: "intro-2", patternId: "intro", startBeat: 16, endBeat: 24 },
    { id: "chorus-2", patternId: "chorus", startBeat: 24, endBeat: 32 },
  ],
});

export const SECTION_LABELS: Record<string, string> = {
  "intro-1": "Intro",
  "chorus-1": "Chorus",
  "intro-2": "Intro",
  "chorus-2": "Chorus",
};

/** beat -> seconds, for rendering the section markers under the seek bar. */
export const BEAT_SECONDS = 60 / arrangement.timing.tempos[0].bpm;
export const TOTAL_BEATS = Math.max(...arrangement.sections.map((s) => s.endBeat));
export const TOTAL_SECONDS = TOTAL_BEATS * BEAT_SECONDS;
