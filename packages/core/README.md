# Viseq

Viseq is a UI-agnostic step sequencer engine for `0.0` to `1.0` control values.

It is designed to run independently from any UI framework and can be used as the timing core for browser tools, control-signal editors, automation grids, audio experiments, or visual sequencers.

## Install

```sh
npm install @viseq/core
```

## Usage

```ts
import { SequencerEngine, createProject, setStepValue } from "@viseq/core";

let project = createProject({ bpm: 120, stepCount: 16, trackCount: 4 });
project = setStepValue(project, project.tracks[0].id, 0, 1);

const engine = new SequencerEngine(project);

const off = engine.on("step", (event) => {
  console.log(event.stepIndex, event.tracks);
});

engine.start();
```

## Package Status

This package is currently in early development. It intentionally stays UI-agnostic, while React hooks and GUI components live in separate packages.

The v0.1.0 scope is the engine, immutable project helpers, validation, presets, smoothing helpers, and timeline utilities. It does not include audio output, MIDI, storage, or UI.

The core API is intentionally small:

- `SequencerEngine`
- `createProject`
- immutable project update helpers
- `validateProject`
- `normalizeProject`
- built-in presets
