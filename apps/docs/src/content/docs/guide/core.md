---
title: "@vixeq/core"
description: A UI-agnostic step sequencer engine for 0.0–1.0 control values.
---

A UI-agnostic step sequencer engine for `0.0`–`1.0` control values. Runs
independently of any UI framework — usable as the timing core for browser
tools, control-signal editors, automation grids, audio experiments, or visual
sequencers.

## Install

```sh
npm install @vixeq/core
```

## Getting started

```ts
import { SequencerEngine, createProject, setStepValue } from "@vixeq/core";

let project = createProject({ bpm: 120, stepCount: 16, trackCount: 4 });
project = setStepValue(project, project.tracks[0].id, 0, 1);

const engine = new SequencerEngine(project);

const off = engine.on("step", (event) => {
  console.log(event.stepIndex, event.tracks);
});

await engine.play();
```

`createProject` and the immutable project helpers (`setStepValue`,
`toggleStep`, `addTrack`, `rotateTrackSteps`, `randomizeTrack`, ...) always
return a new `SequenceProject` — call `engine.setProject(next)` to hot-swap
the running engine's project.

## Track ids

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

## Engine lifecycle

```ts
const engine = new SequencerEngine(project);

await engine.play();
await engine.pause();
await engine.seekStep(0);
await engine.stop();
engine.dispose();
```

## Audio sync

Vixeq does not require audio, but browser audio can drive playback as an
optional transport:

```ts
import { SequencerEngine, createMediaElementTransport, createProject } from "@vixeq/core";

const project = createProject();
const audio = new Audio("/loop.wav");
audio.loop = true;

const transport = createMediaElementTransport(audio);
const engine = new SequencerEngine(project, { transport });

await engine.play();
```

For seamless loops, decode the file and use an `AudioBufferSourceNode`
transport instead — see `createAudioBufferTransport` in the
[API reference](../../api/vixeq/core/index/functions/createaudiobuffertransport/).

## Arrangement

Play multiple patterns on a shared, tempo-mapped beat timeline — see
[Concepts](../concepts/#arrangement-multiple-patterns-one-song):

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
engine.on("section", (event) => console.log(event.section?.id ?? "(gap)"));

await engine.play();
await engine.seekBeat(16); // jump to the chorus
```

Gaps between sections (or past the end, when not looping) output `0` on
every channel. `setProject(next)` validates the replacement atomically,
preserves the current fractional beat, and does not seek a supplied
transport — its local `loop` state is independent of the transport's own
loop flag.

## DOM bindings

Write channel values straight to CSS custom properties, without React
(separate `@vixeq/core/dom` subpath so the main entry stays DOM-free):

```ts
import { bindChannelsToElement } from "@vixeq/core/dom";

// In your rAF loop:
bindChannelsToElement(rootEl, values, {
  kick: "--pulse-beat",
  hat: "--pulse-cta",
});
```

## Next steps

- Full API — [`SequencerEngine` reference](../../api/vixeq/core/index/classes/sequencerengine/) and
  [`@vixeq/core/dom` reference](../../api/vixeq/core/dom/functions/bindchannelstoelement/)
- React integration — [`@vixeq/react` guide](../react/)
- Copyable example: `pnpm --filter vixeq-example-vanilla-core dev`
  (see [`examples/vanilla-core`](https://github.com/kramhash/vixeq/tree/main/examples/vanilla-core))
