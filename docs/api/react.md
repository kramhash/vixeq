# `@vixeq/react` API

- `useSequencerEngine(options)` / `useSequencePlayer(options)` — own a `SequencerEngine`, synchronize project updates, and expose async transport controls.
- `useArrangement(options)` — own an `ArrangementEngine`; exposes `engine`, section and playback state, `start`, `stop`, `toggle`, `reset`, `seek`, and recoverable `error` state. Arrangement prop updates are applied atomically without resetting the current beat.
- `useAnimatedChannels(engine, options?)` — frame-samples a `ChannelSource` or a set of envelopes without React renders. It follows `prefers-reduced-motion` unless `reducedMotion` is explicitly set.
- `usePrefersReducedMotion()` — SSR-safe media-query hook. It returns `false` on the server and updates after mount.

React is a peer dependency. Module entry points do not access `window` during import.
