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

engine.start();
```

## Engine Lifecycle

```ts
const engine = new SequencerEngine(project);

engine.start();
engine.stop();
engine.reset(0);
engine.dispose();
```

Use `setProject(nextProject)` when your app edits the immutable project while the engine is alive.

## Audio Sync

Vixeq does not require audio, but browser audio can be used as an optional clock source.

```ts
import { SequencerEngine, createMediaElementTransport, createProject } from "@vixeq/core";

const project = createProject();
const audio = new Audio("/loop.wav");
audio.loop = true;

const transport = createMediaElementTransport(audio);
const engine = new SequencerEngine(project, {
  clock: transport.clock,
  timeDriven: true,
});

await transport.play();
engine.start();
```

`createMediaElementTransport` is a browser-only helper for `HTMLMediaElement`. It coordinates `play`, `stop`, `pause`, `seek`, and exposes a `SequencerClock`; the sequencer engine itself stays audio-agnostic.

For seamless loops, decode the file and use an `AudioBufferSourceNode` transport:

```ts
import { SequencerEngine, createAudioBufferTransport, createProject } from "@vixeq/core";

const ctx = new AudioContext();
const response = await fetch("/loop.wav");
const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
const transport = createAudioBufferTransport(ctx, buffer, { loop: true });
const engine = new SequencerEngine(createProject(), {
  clock: transport.clock,
  timeDriven: true,
});

await transport.play();
engine.start();
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

## Package Status

This package is currently in early development. It intentionally stays UI-agnostic, while React hooks and GUI components live in separate packages.

The current scope is the engine, immutable project helpers, track transforms, validation, presets, smoothing helpers, timeline utilities, and optional browser audio transport helpers. It does not include MIDI, storage, or UI.

The core API is intentionally small:

- `SequencerEngine`
- `createProject`
- immutable project update helpers
- track transform helpers
- `validateProject`
- `normalizeProject`
- built-in presets
- optional `SequencerTransport` helpers
