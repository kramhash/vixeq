---
title: Concepts
description: How Vixeq's three playback engines — sequencer, arrangement, and timeline — differ.
---

Vixeq ships three playback engines in `@vixeq/core`. They share the same
`ChannelSource` shape (`play`/`pause`/`stop`, `on(...)`, `sampleChannels()`,
`getPosition()`, `dispose()`) but answer different questions about time.

## Steps and channels

The base unit is a **step sequencer**: a `SequenceProject` holds one or more
`Track`s, each with a fixed number of steps, and each step holds a `0.0`–`1.0`
value. `SequencerEngine` loops that project once per pattern length and emits
a `"step"` event on every step boundary. `sampleChannels()` returns the
current `{ trackId: value }` map — the "channels" your UI or DOM bindings
read every frame.

```ts
import { SequencerEngine, createProject, setStepValue } from "@vixeq/core";

let project = createProject({ bpm: 120, stepCount: 16, trackCount: 4 });
project = setStepValue(project, project.tracks[0].id, 0, 1);

const engine = new SequencerEngine(project);
engine.on("step", (event) => console.log(event.stepIndex, event.tracks));
await engine.play();
```

See the [`@vixeq/core` guide](../core/) for the full lifecycle.

## Arrangement: multiple patterns, one song

`ArrangementEngine` plays several `SequenceProject` patterns on a shared,
tempo-mapped beat timeline. An `ArrangementProject` holds a `TimingMap`
(authoritative tempo — pattern-local `bpm` is ignored during arrangement
playback), an explicit `durationBeats`, a pattern library, and a list of
non-overlapping sections that place patterns on the timeline. Gaps between
sections (or past the end, when not looping) output `0` on every channel.

Use this when you have song-level structure — verses, choruses, intervals —
built from patterns you'd otherwise play individually with `SequencerEngine`.

## Timeline: sparse cues, no channels

`TimelineEngine` schedules sparse, tempo-variable cue events (arbitrary
payloads, not step values) against a `PlaybackTransport`. It is **not** a
`ChannelSource` — there is no `sampleChannels()` — because timelines model
one-off events (markers, triggers) rather than continuously sampled values.

## Transport: what actually drives time

All three engines read time from a `PlaybackTransport`. By default each
engine creates its own browser-clock transport, but you can pass one
explicitly to synchronize playback to an `HTMLMediaElement`
(`createMediaElementTransport`) or a Web Audio `AudioBufferSourceNode`
(`createAudioBufferTransport`) — see the
[Audio Sync section of the core guide](../core/#audio-sync). Sharing one
transport across engines keeps them in lockstep; passing none per engine
keeps them independent.

## Reading channels into your app

- `@vixeq/react`'s `useAnimatedChannels` drives a `requestAnimationFrame` loop
  from any `ChannelSource`, in either envelope or easing/interpolation mode.
- `@vixeq/core/dom`'s `bindChannelsToElement` writes a channel map straight to
  CSS custom properties, for DOM-only rendering without React.
