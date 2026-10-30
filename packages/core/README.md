# Vixeq

Vixeq is a UI-agnostic step sequencer engine for `0.0` to `1.0` control values.

It is designed to run independently from any UI framework and can be used as the timing core for browser tools, control-signal editors, automation grids, audio experiments, or visual sequencers.

## Install

```sh
npm install @vixeq/core
```

## Support

The current Node, TypeScript, browser, package-format, and semver policy is
documented in the repository
[support policy](https://github.com/kramhash/vixeq/blob/main/SUPPORT.md).
`@vixeq/core` has no runtime npm dependencies and keeps DOM helpers in the
separate `@vixeq/core/dom` subpath.

## Usage

```ts
import { SequencerEngine, createProject, rotateTrackSteps, setStepValue } from "@vixeq/core";

let project = createProject({ bpm: 120, stepCount: 16, trackCount: 4 });
project = setStepValue(project, project.tracks[0].id, 0, 1);
project = rotateTrackSteps(project, project.tracks[0].id, 1);

const engine = new SequencerEngine(project);

const off = engine.on("step", (event) => {
  console.log(event.stepIndex, event.tracks);
});

await engine.play();
```

## Track Ids

Channels, step events, and Arrangement samples are keyed by track id, not by
display name. Pass your own ids (and initial steps) to keep a mapping stable
across patterns and renames:

```ts
const pattern = createProject({
  stepCount: 4,
  tracks: [
    { id: "kick", name: "Kick", steps: [1, 0, 0, 0] },
    { id: "hat", name: "Hat", steps: [0, 0.5, 0, 0.5] },
  ],
});
```

A track without an id gets the first unused `track-N` in its project:
`createProject({ trackCount: 3 })` always yields `track-1`…`track-3`, and
`addTrack` reuses a number freed by `removeTrack`. `tracks` cannot be combined
with `trackCount` / `trackNames`, and a repeated id throws a `TypeError`.

## Engine Lifecycle

```ts
const engine = new SequencerEngine(project);

await engine.play();
await engine.pause();
await engine.seekStep(0);
await engine.stop();
engine.dispose();
```

Use `setProject(nextProject)` when your app edits the immutable project while the engine is alive.

## Audio Sync

Vixeq does not require audio, but browser audio can be used as an optional playback transport.

```ts
import {
  SequencerEngine,
  createMediaElementTransport,
  createProject,
} from "@vixeq/core";

const project = createProject();
const audio = new Audio("/loop.wav");
audio.loop = true;

const transport = createMediaElementTransport(audio);
const engine = new SequencerEngine(project, { transport });

await engine.play();
```

`createMediaElementTransport` is a browser-only helper for `HTMLMediaElement`. It exposes the shared `PlaybackTransport` state, controls, and event stream while leaving media-element ownership with the caller.

For seamless loops, decode the file and use an `AudioBufferSourceNode` transport:

```ts
import {
  SequencerEngine,
  createAudioBufferTransport,
  createProject,
} from "@vixeq/core";

const ctx = new AudioContext();
const response = await fetch("/loop.wav");
const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
const transport = createAudioBufferTransport(ctx, buffer, { loop: true });
const engine = new SequencerEngine(createProject(), { transport });

await engine.play();
```

Loop boundaries are handled by `AudioBufferSourceNode.loop`. The transport creates a new one-shot source only when playback starts or when seeking during playback.

## Project Helpers

```ts
import { addTrack, clearTrack, randomizeTrack, rotateTrackSteps, toggleStep } from "@vixeq/core";

let next = toggleStep(project, trackId, 0);
next = addTrack(next, "Accent");
next = rotateTrackSteps(next, trackId, 1);
next = randomizeTrack(next, trackId, { probability: 0.4, min: 0.25 });
next = clearTrack(next, trackId);
```

All project helpers return a new `SequenceProject`. If the target track or step does not exist, helpers return the original project.

## Validation

```ts
import { normalizeProject, validateProject } from "@vixeq/core";

const result = validateProject(input);
const project = normalizeProject(input);
```

Use `validateProject` when you need errors for user-facing import flows. Use `normalizeProject` when you want to coerce importable data into a bounded project.

## Envelopes

Stateful envelope primitives for beat-driven visual effects.

```ts
import { createDecayEnvelope, createEnvelope, easeOutCubic } from "@vixeq/core";

// Time-based: attack (0→peak) then decay (peak→0) in milliseconds
const env = createEnvelope({ attack: 5, decay: 200, curve: easeOutCubic });

// Exponential decay backed by smoothing.ts — matches the "punch-and-drop" feel
const beatEnv = createDecayEnvelope({ decayRate: 4.5, impact: 1.0, lift: 0 });

engine.on("step", (e) => {
  const trackValue = e.tracks[0].enabled ? e.tracks[0].value : 0;
  beatEnv.trigger(e.scheduledPositionMs, trackValue);
});

// In your rAF loop:
const value = beatEnv.sample(engine.getPosition().positionMs); // 0–1
```

Both implement `Envelope`: `trigger(positionMs, value?)`, `sample(positionMs)`, and `reset()`. Envelope positions are logical transport positions, not wall-clock timestamps.

## Evaluating at a Time

For shaders and offline rendering, read channel values as a pure function of
the position: the same position always gives the same value, in any order and
as often as needed (motion-blur sub-samples, a resumed export). No engine or
`trigger()` calls are involved.

```ts
import { envelopeAt, hold, lastStepAt, sampleProject } from "@vixeq/core";

// A SequenceProject loops forever: any position wraps, negative ones too.
const values = sampleProject(project, positionMs); // { trackId: 0–1 }
const gates = sampleProject(project, positionMs, hold); // each step's own value

// An ArrangementProject is sampled at a transport position; loop wraps it
// like local loop. (sampleArrangement is the beat-based variant.)
const arranged = sampleProject(song, positionMs, undefined, { loop: true });

// The last step that fired on a track, and a pulse that peaks on it.
const hit = lastStepAt(project, positionMs, "kick"); // { value, positionMs, elapsedMs } | null
const pulse = envelopeAt(song, positionMs, "kick", { leadMs: 20, decayMs: 120, loop: true });
```

- `lastStepAt` / `nextStepAt` find the last step at or before, or the first
  step after, a position whose value is greater than 0. They work on a
  `SequenceProject` or an `ArrangementProject`, across sections, gaps, and
  (with `loop`) the loop point. Tracks are named by id.
- `envelopeAt` rises over `leadMs` before each step, peaks exactly on it
  (the step's value × `peak`), and falls over `decayMs`. A pulse that peaks on
  the beat and fades fast reads as in sync; one that starts growing on the
  beat reads as late, even with correct timing.
- `SequencerEngine#sampleChannelsAt` and `ArrangementEngine#sampleChannelsAt`
  return the same values as `sampleProject` for non-negative positions
  (without loop for an arrangement); the Sequencer wraps past the end of the
  pattern, and both throw a `RangeError` for negative positions.
- Sample an arrangement by position with `sampleProject` rather than
  `sampleArrangement(arrangement, msToBeat(timing, positionMs))`: `msToBeat`
  clamps negative positions to beat 0 and can land an ulp before a step start
  at odd tempos, sampling the previous step.

## DOM Bindings

Write channel values directly to CSS custom properties (separate `@vixeq/core/dom` subpath):

```ts
import { bindChannelsToElement } from "@vixeq/core/dom";

// In your rAF loop:
bindChannelsToElement(rootEl, values, {
  kick: "--pulse-beat",
  hat: "--pulse-cta",
});
```

This is equivalent to looping over `element.style.setProperty(cssVar, value.toFixed(4))`. The `./dom` subpath imports `HTMLElement` from browser globals; the main `@vixeq/core` entry remains DOM-free.

## Arrangement

Sequence multiple patterns on a shared song-level beat timeline. An
`ArrangementProject` holds a tempo-mapped `timing` field, an explicit
`durationBeats`, a library of patterns, and a list of non-overlapping sections
that place those patterns on the timeline. Pattern-local `bpm` values are
ignored during arrangement playback; the arrangement `TimingMap` is
authoritative.

```ts
import { ArrangementEngine, createArrangement, createTimingMap } from "@vixeq/core";

const arrangement = createArrangement({
  timing: createTimingMap({ bpm: 120 }),
  durationBeats: 32,
  patterns: { verse: verseProject, chorus: chorusProject },
  sections: [
    { id: "v1", patternId: "verse", startBeat: 0, endBeat: 16 },
    { id: "c1", patternId: "chorus", startBeat: 16, endBeat: 32 },
  ],
});

const engine = new ArrangementEngine(arrangement, { loop: false });

engine.on("step", (event) => console.log(event.stepIndex, event.tracks));
engine.on("section", (event) => console.log(event.section?.id ?? "(gap)"));

await engine.play();
await engine.seekBeat(16); // jump to the chorus
await engine.seekPositionMs(8_000); // or seek by transport-relative milliseconds
await engine.stop();       // stop and return to beat 0
```

Gaps between sections (or past the end, when not looping) output `0` on every channel. `ArrangementEngine` is always time-driven from `PlaybackTransport`, so seek/scrub/audio-sync are correct by construction. Its local `loop` / `setLoop()` state is independent of the transport's own loop flag. It implements the same `on("step", ...)` / `on("playback", ...)` / `on("project", ...)` / `sampleChannels()` shape as `SequencerEngine` (see the `ChannelSource` type), plus an Arrangement-specific `section` event.

Use `validateArrangement` / `normalizeArrangement` the same way as their
`SequenceProject` counterparts. `migrateArrangementProject(input, options)`
converts v1 arrangement data by mapping the old top-level `bpm` into a v2
`TimingMap`; `options.durationBeats` is required because v1 data has no
duration field. The pure functions behind the engine (`resolveArrangementStep`,
`sampleArrangement`, `sectionAtBeat`, `arrangementDurationBeats`,
`unionTrackIds`) are also exported for custom playback loops.

## Timeline

A `TimelineProject` holds sparse point events (cues) on a tempo-mapped beat
timeline, for things like lighting cues, lyrics, or scene changes.
`TimelineEngine` dispatches each event as a `cue` when playback reaches its
beat, following the transport like the other engines.

```ts
import {
  TimelineEngine,
  addTimelineEvent,
  addTimelineTrack,
  createTimelineProject,
  type TimelineEvent,
  type TimelineProject,
} from "@vixeq/core";

type CueEvent =
  | TimelineEvent<"flash", { strength: number }>
  | TimelineEvent<"fade", { from: number; to: number }>;

let project: TimelineProject<CueEvent> = {
  ...createTimelineProject({ timing: { bpm: 120 }, durationBeats: 16 }),
  events: [],
};
project = addTimelineTrack(project, { id: "lights", name: "Lights", enabled: true });
project = addTimelineEvent(project, { trackId: "lights", beat: 4, type: "flash", data: { strength: 1 } });
project = addTimelineEvent(project, { trackId: null, beat: 8, type: "fade", data: { from: 0, to: 1 } });

const engine = new TimelineEngine(project, { loop: true });
engine.on("cue", ({ event, iteration }) => {
  if (event.type === "flash") console.log("flash", event.data?.strength, iteration);
});

await engine.play();
await engine.seekBeat(8); // a seek dispatches no cues
```

- `trackId: null` is a global event. Events on a disabled track are not
  dispatched.
- The update helpers (`addTimelineEvent`, `updateTimelineEvent`,
  `removeTimelineEvent`, `addTimelineTrack`, ...) are strict: they return a new
  project and throw `TypeError` for a result that fails
  `validateTimelineProject`. They keep your event type, so a
  `TimelineProject<CueEvent>` stays one.
- `getEventsInBeatRange`, `getEventsAtBeat`, and `getNextEvents` query a
  project without an engine.
- `migrateTimelineProject(v1, { durationBeats })` converts pre-0.8 timeline
  data.

## Package Status

This package is stable (`1.x`) and follows the semver policy in the
repository's `SUPPORT.md`. It stays UI-agnostic, while React hooks and GUI
components live in separate packages.

The current scope is the engine, immutable project helpers, track transforms,
validation, presets, smoothing helpers, timeline utilities, envelope
primitives, optional browser audio transport helpers, and a DOM utilities
subpath. It does not include MIDI, storage, or UI.

The core API is intentionally small:

- `SequencerEngine`
- `createProject`
- immutable project update helpers
- track transform helpers
- `validateProject`
- `normalizeProject`
- built-in presets
- `createEnvelope` / `createDecayEnvelope`
- optional `PlaybackTransport` helpers
- `TimingMap` / `TimelineEngine` helpers for tempo-mapped cue scheduling
- `bindChannelsToElement` (via `@vixeq/core/dom`)
- `ArrangementEngine` / `createArrangement` for multi-pattern song playback
