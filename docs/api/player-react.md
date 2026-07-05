# `@vixeq/player-react` API

- `SequencePlayer` — controlled sequencer editor. Requires `project` and `onProjectChange`.
- `StandaloneSequencePlayer` — owns project state internally via `defaultProject`.
- `SequencePlayerRef` — async `play`, `stop`, `toggle`, and `reset` controls.
- `onEngineChange` exposes the current engine for `useAnimatedChannels` integration.
- `SequencePlayerProjectChange.reason` identifies `bpm`, track add/remove/rename/enable, step toggle/value, or project replacement changes.

Import the component CSS from `@vixeq/player-react/styles.css`.
