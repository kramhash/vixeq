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
import { createEnvelope, createDecayEnvelope } from "@vixeq/core";

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

## DOM Bindings

Write channel values directly to CSS custom properties (separate `@vixeq/core/dom` subpath):

```ts
import { bindChannelsToElement } from "@vixeq/core/dom";

// In your rAF loop:
bindChannelsToElement(rootEl, values, {
  "track-1": "--pulse-beat",
  "track-2": "--pulse-cta",
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

## Package Status

This package is in the pre-1.0 release-readiness line. It intentionally stays
UI-agnostic, while React hooks and GUI components live in separate packages.

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
