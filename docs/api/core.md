# `@vixeq/core` API

## Sequencing

- `new SequencerEngine(project, options?)` — plays and samples one looping `SequenceProject`.
- `createProject(options?)`, `createTrack(name, stepCount)` — create normalized project data.
- `setProjectBpm`, `setStepValue`, `toggleStep`, `addTrack`, `removeTrack`, `renameTrack`, `setTrackEnabled`, `clearTrack`, `rotateTrackSteps`, `randomizeTrack` — immutable project updates.
- `validateProject(input)`, `normalizeProject(input)` — validation and import-boundary normalization.
- `presets`, `SEQUENCER_LIMITS` — built-in projects and supported bounds.

## Arrangement

- `new ArrangementEngine(arrangement, options?)` — plays multiple patterns on a shared beat timeline. Options include `clock`, `originMs`, `lookaheadMs`, and `loop`.
- `createArrangement(options?)` — creates an `ArrangementProject` with one BPM, a pattern map, and non-overlapping sections.
- `validateArrangement(input)`, `normalizeArrangement(input)` — validate strict input or normalize import data.
- `sectionAtBeat`, `resolveArrangementStep`, `sampleArrangement`, `unionTrackIds`, `arrangementDurationBeats` — pure arrangement queries.
- Engine controls: `start()`, `stop()`, `reset()`, `seek(beat)`, `setArrangement(next)`, `sampleChannels(timeMs)`, `dispose()`.

Gaps are valid and output zero. Sections restart their pattern at step 0. Missing tracks output zero. `setArrangement` validates atomically and preserves the current beat.

## Timing, audio, and values

- `browserClock`, `createClockTransport`, `createMediaElementTransport`, `createAudioBufferTransport`.
- Playback v2 adds `PlaybackClock`, `PlaybackTransport`, `PlaybackSnapshot`, `PlaybackError`, and clock, media-element, and AudioBuffer transport factories. Engine integration follows in P3/P4.
- `createEnvelope`, `createDecayEnvelope`, smoothing helpers, easing functions, `lerp`.
- Timeline exports provide beat/time conversion and event queries for tempo-variable data.

## DOM subpath

Import `bindChannelsToElement` from `@vixeq/core/dom`. The main entry remains DOM-free.

Public TypeScript types are exported from the package entry and included in generated declarations.
