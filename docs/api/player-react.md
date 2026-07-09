# `@vixeq/player-react` API

- `SequencePlayer` — controlled sequencer editor. Requires `project` and `onProjectChange`.
- `StandaloneSequencePlayer` — owns project state internally via `defaultProject`.
- `SequencePlayerRef` — async `play`, `pause`, `stop`, `toggle`, `seekStep`, `seekPositionMs`, `setPlaybackRate`, and `setTransportLoop` controls.
- `SequencePlayerTransportState` — Playback v2 state with `playbackState`, `positionRef`, `pendingOperation`, `isBusy`, latest event, and separate project/transport errors.
- `onPlaybackChange` reports Playback v2 snapshots; pass a `PlaybackTransport` through `transport`.
- `onEngineChange` exposes the current engine for `useAnimatedChannels` integration.
- `SequencePlayerProjectChange.reason` identifies `bpm`, track add/remove/rename/enable, step toggle/value, or project replacement changes.

Import the component CSS from `@vixeq/player-react/styles.css`.
