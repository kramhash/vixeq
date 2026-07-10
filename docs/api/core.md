# `@vixeq/core` API

## Sequencing

- `new SequencerEngine(project, options?)` — plays and samples one looping `SequenceProject`.
- Sequencer controls: `play()`, `pause()`, `stop()`, `seekStep(stepIndex)`, `seekPositionMs(positionMs)`, `setProject(next)`, `sampleChannels()`, `sampleChannelsAt(positionMs)`, `dispose()`.
- Sequencer options include `transport`, `lookaheadMs`, `missedStepPolicy`, `onStep`, and `onListenerError`. Omitting `transport` creates an Engine-owned browser-clock transport.
- `StepEvent.cause` includes `"loop"`: when an attached transport wraps position on a natural loop, `SequencerEngine` emits one `"loop"`-caused step immediately at the wrapped position, re-anchoring step emission so it does not permanently stop after the first loop.
- `createProject(options?)`, `createTrack(name, stepCount)` — create normalized project data.
- `setProjectBpm`, `setStepValue`, `toggleStep`, `addTrack`, `removeTrack`, `renameTrack`, `setTrackEnabled`, `clearTrack`, `rotateTrackSteps`, `randomizeTrack` — immutable project updates.
- `validateProject(input)`, `normalizeProject(input)` — validation and import-boundary normalization.
- `presets`, `SEQUENCER_LIMITS` — built-in projects and supported bounds.

## Arrangement

- `new ArrangementEngine(arrangement, options?)` — plays multiple patterns on a shared beat timeline. Options include `transport`, `lookaheadMs`, `loop`, `missedStepPolicy`, `onStep`, `onSection`, and `onListenerError`. Omitting `transport` creates an Engine-owned browser-clock transport.
- `createArrangement(options?)` — creates an `ArrangementProject` with `timing: TimingMap`, explicit `durationBeats`, a pattern map, and non-overlapping sections.
- `validateArrangement(input)`, `normalizeArrangement(input)` — validate strict v2 input or normalize import data within the v2 schema.
- `migrateArrangementProject(v1Project, options?)` — converts v1 arrangement data by mapping top-level `bpm` to a v2 `TimingMap`; `options.durationBeats` is required because v1 has no duration field.
- `sectionAtBeat`, `resolveArrangementStep`, `sampleArrangement`, `unionTrackIds`, `arrangementDurationBeats` — pure arrangement queries.
- Engine controls: `play()`, `pause()`, `stop()`, `seekBeat(beat)`, `seekPositionMs(positionMs)`, `setLoop(loop)`, `setArrangement(next)`, `sampleChannels()`, `sampleChannelsAt(positionMs)`, `getPlaybackState()`, `getPosition()`, `dispose()`.

Gaps are valid and output zero. Sections restart their pattern at step 0. Missing tracks output zero. `setArrangement` validates atomically, preserves the current fractional beat, and does not seek a supplied transport. Arrangement end and loop behavior are local Engine state; transport loop remains independent.

## Timing, audio, and values

- `browserClock`, `createClockTransport`, `createMediaElementTransport`, `createAudioBufferTransport`.
- Playback v2 adds `PlaybackClock`, `PlaybackTransport`, `PlaybackSnapshot`, `PlaybackError`, and clock, media-element, and AudioBuffer transport factories. `SequencerEngine` and `ArrangementEngine` use `PlaybackTransport`.
- `createEnvelope`, `createDecayEnvelope`, smoothing helpers, easing functions, `lerp`. Envelopes expose `trigger(positionMs)`, `sample(positionMs)`, and `reset()` using logical transport positions.
- Timeline exports provide beat/time conversion and event queries for tempo-variable data.
- `TimingMap` (0.8, v2) uses `startPositionMs`. `createTimingMap`/`normalizeTimingMap` repair input; `validateTimingMap(timing)` throws `TypeError`/`RangeError` on structurally invalid input without repairing it.
- `TimelineProject` (0.8, v2) requires `durationBeats` and uses `trackId: string | null` (`null` is a global event); `TimelineTrack.type` and `TimelineEvent.durationBeats`/`value` are removed. `createTimelineProject`/`normalizeTimelineProject` repair input. `validateTimelineProject(input, eventValidator?)` returns a `ValidationResult` and never throws; the immutable update helpers (`addTimelineTrack`, `addTimelineEvent`, `updateTimelineEvent`, `removeTimelineTrack`, `removeTimelineEvent`, `setTimelineTrackEnabled`) are strict and throw `TypeError` on invalid input by calling it internally and rejecting on `ok: false` (auto-generating a missing `id` is the one sanctioned exception). `migrateTimelineProject(v1Project, options)` converts v1 data; `options.durationBeats` is required. `getEventsInBeatRange` throws `RangeError` for a reversed or out-of-bounds range instead of clamping it. `sequenceProjectToTimeline` is removed with no replacement.
- `TimelineEngine` schedules sparse cue events against a `PlaybackTransport`; it is not a `ChannelSource` and does not expose channel sampling APIs.

## DOM subpath

Import `bindChannelsToElement` from `@vixeq/core/dom`. The main entry remains DOM-free.

Public TypeScript types are exported from the package entry and included in generated declarations.
