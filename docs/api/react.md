# `@vixeq/react` API

- `useSequencerEngine(options)` / `useSequencePlayer(options)` — own a `SequencerEngine`, synchronize project updates, and expose `playbackState`, `positionRef`, `latestEvent`, `projectError`, `transportError`, queued async `play`/`pause`/`stop`/`toggle`, `seekPositionMs`, `seekStep`, `setPlaybackRate`, and `setTransportLoop`.
- `useArrangement(options)` — own an `ArrangementEngine`; exposes `engine`, `currentSection`, `playbackState`, `positionRef`, `latestEvent`, `projectError`, `transportError`, queued async `play`/`pause`/`stop`/`toggle`, `seekPositionMs`, `seekBeat`, `setPlaybackRate`, `setTransportLoop`, and local `setLoop`. Arrangement prop updates are applied atomically without resetting the current beat.
- `useAnimatedChannels(engine, options?)` — frame-samples a `ChannelSource` without React renders. Envelope mode uses logical transport positions, resets on seek/stop/project changes, and follows `motionPreference` (`"system"` by default).
- `usePrefersReducedMotion()` — SSR-safe media-query hook. It returns `false` on the server and updates after mount.

React is a peer dependency. Module entry points do not access `window` during import. Hook render phases do not access browser globals; rAF and media-query work is effect-only.
