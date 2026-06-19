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

This project is currently in early development. The package surface is intentionally split by responsibility:

- `@viseq/core`: UI-agnostic sequencer engine, immutable project helpers, validation, timeline utilities, and presets.
- `@viseq/react`: React hooks for driving the core engine without any GUI.
- `@viseq/player-react`: An embeddable React sequence player GUI with built-in styles, without a visualizer or audio engine.

The playground app lives in `apps/playground` and demonstrates the package stack with a visualizer, presets, JSON import/export, and local project persistence.

## v0.1.0 Scope

The first release is intended to prove the engine and package boundaries:

- deterministic step playback for `0.0` to `1.0` control values
- immutable project helpers and validation
- React hooks for using the engine from an app
- an embeddable React sequence player
- timeline conversion/query utilities
- a hosted playground demo

It does not include an audio engine, MIDI support, DAW-style timeline editing UI, URL sharing, or production stability guarantees.

The core API is intentionally small:

- `SequencerEngine`
- `createProject`
- immutable project update helpers
- `validateProject`
- `normalizeProject`
- built-in presets
