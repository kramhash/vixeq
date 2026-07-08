# Vixeq

Vixeq is a UI-agnostic step sequencer engine for `0.0` to `1.0` control values.

It is designed to run independently from any UI framework and can be used as the timing core for browser tools, control-signal editors, automation grids, audio experiments, or visual sequencers.

## Install

```sh
npm install @vixeq/core
```

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

Both implement `Envelope`: `trigger(timeMs, value?)` and `sample(timeMs)`.

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

Sequence multiple patterns on a shared song-level beat timeline. An `ArrangementProject` holds a library of patterns plus a list of non-overlapping sections that place them on that timeline; the arrangement's own `bpm` is the single source of truth (each pattern's `bpm` is ignored).

```ts
import { ArrangementEngine, createArrangement } from "@vixeq/core";

const arrangement = createArrangement({
  bpm: 120,
  patterns: { verse: verseProject, chorus: chorusProject },
  sections: [
    { id: "v1", patternId: "verse", startBeat: 0, endBeat: 16 },
    { id: "c1", patternId: "chorus", startBeat: 16, endBeat: 32 },
  ],
});

const engine = new ArrangementEngine(arrangement, { loop: false });

engine.on("step", (event) => console.log(event.stepIndex, event.tracks));
engine.on("section", (event) => console.log(event.section?.id ?? "(gap)"));

engine.start();
engine.seek(16); // jump to the chorus
engine.reset();  // rewind to beat 0
```

Gaps between sections (or past the end, when not looping) output `0` on every channel. `ArrangementEngine` is always time-driven — position is derived from the clock, so `seek`/scrub/audio-sync are correct by construction — and implements the same `on("step", ...)` / `sampleChannels()` shape as `SequencerEngine` (see the `ChannelSource` type), so it works with `useAnimatedChannels` and `bindChannelsToElement` unmodified.

Use `validateArrangement` / `normalizeArrangement` the same way as their `SequenceProject` counterparts. The pure functions behind the engine (`resolveArrangementStep`, `sampleArrangement`, `sectionAtBeat`, `arrangementDurationBeats`, `unionTrackIds`) are also exported for custom playback loops.

## Package Status

This package is currently in early development. It intentionally stays UI-agnostic, while React hooks and GUI components live in separate packages.

The current scope is the engine, immutable project helpers, track transforms, validation, presets, smoothing helpers, timeline utilities, envelope primitives, optional browser audio transport helpers, and a DOM utilities subpath. It does not include MIDI, storage, or UI.

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
- `bindChannelsToElement` (via `@vixeq/core/dom`)
- `ArrangementEngine` / `createArrangement` for multi-pattern song playback
