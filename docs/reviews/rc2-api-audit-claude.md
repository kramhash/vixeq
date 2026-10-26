# RC2 API audit before 1.0.0 — findings and dispositions

- Status: dispositions approved by the project owner (2026-10-21); fixes not started
- Author: Claude
- Reviewers: Claude design-advisor (API shape, extensibility) and Claude critic
  (falsifiable defects, packed-tarball consumers), one pass each, 2026-10-21
- Scope: the whole public surface of `1.0.0-rc.1` (`packages/*/etc/*.api.md`)
  against `docs/behavior/*`, the spec, and the 1.1.0+ roadmap (ChannelSink,
  duration getters, issues #2, #5, #6).
- Owner decision (2026-10-21): every finding that needs an API change is fixed
  in `1.0.0-rc.2`, including breaking ones; the 14-day observation restarts
  from rc.2. If no API change is approved, no rc.2 is published.

Source tags: `[A…]` design-advisor, `[C…]` critic. Severity is the reviewers'.
"Breaking" means a TypeScript or runtime consumer of rc.1 can break.

## Group 1 — defects and gaps, not breaking (proposed: fix in rc.2)

| ID | Finding | Proposed fix |
|---|---|---|
| F1 | **high** `[C1]` `validateProject` accepts a missing `stepsPerBeat` (`validation.ts:34`); `SequencerEngine` then divides by `undefined` and every step index and channel is `NaN`; Arrangement patterns silently sample 0. Reproduced on the packed tarball. | Require `stepsPerBeat` like `bpm`/`stepCount`. Legacy JSON already goes through `normalizeProject`, which fills 4. |
| F2 | `[A1][C6]` `MigrationIssue` is in the contract (§5) but not exported; the API report carries `ae-forgotten-export`. | Export it. |
| F3 | `[C4]` Timeline update helpers and `sortTimelineEvents` are fixed to `TimelineEvent`, so a `TimelineProject<MyEvent>` edited with them no longer fits `TimelineEngine<MyEvent>` (TS2345, reproduced). | Make `addTimelineTrack`, `removeTimelineTrack`, `setTimelineTrackEnabled`, `addTimelineEvent`, `updateTimelineEvent`, `removeTimelineEvent`, `sortTimelineEvents` generic over `TEvent extends TimelineEvent`. |
| F4 | `[C10]` `migrateTimelineProject` options are optional in the contract (§5) but required in the type, and omitting them throws `TypeError`. | Make `options` optional and return `ok: false` with `TIMELINE_DURATION_BEATS_REQUIRED`. |
| F5 | `[C12]` Packaging: no `"./package.json"` export (`ERR_PACKAGE_PATH_NOT_EXPORTED` in all three), no `engines.node`, no `sideEffects`. | Add `./package.json`; `engines.node: ">=22"`; `sideEffects: false` for core and react, `["./dist/styles.css"]` for player-react (plain `false` would drop the CSS import). |
| F6 | `[A-B1][A-B3][A-B14][C13]` Shape nits: `PlaybackTransport.subscribe` returns `() => void` instead of `Unsubscribe`; `sampleChannelsAt`/`Envelope` name the argument `timeMs` where the contract says `positionMs`; `TimelineEngine.getPosition()` returns an inline type instead of `ChannelPosition`. | Fix all three (assignability does not change). |
| F7 | `[C8]` `useTimeline` rebuilds the engine whenever `eventValidator` changes identity (intentional, tested), so an inline validator resets playback on every render; undocumented, unlike every other callback which is ref-stabilised. | Document "keep the reference stable" in JSDoc (keeps rc.1 behavior). |
| F8 | `[A2][A3][C5][C14]` Semver policy gaps: values added to emitted unions (`EnginePlaybackEvent.type`, `StepEventCause`, `PlaybackErrorCode`, …) and members added to consumer-implemented types (`PlaybackTransport`, `PlaybackClock`, `ChannelSource`, `Envelope`, `TimelineEventValidator`) are not classified. Contract drift: `StepEventCause` lacks `"loop"` in playback-v2 §5. | `SUPPORT.md`: union value additions are minor (consumers keep a default branch); the implementable contracts are listed and only optional members are added in 1.x; everything exported from an entry point is public, with no release tiers. Fix §5. 1.1's duration getters go on the Engine classes, not on `ChannelSource`. |

## Group 2 — removals of dead or leaked exports (breaking in form; proposed: remove in rc.2)

| ID | Finding | Proposed fix |
|---|---|---|
| F9 | `[A-B9][C3]` The contract says "Remove" (playback-v2 §2.1, §5) but these are still public and unused: `SequencerTransport`, `TransportEvent`, `StepEvent.timestamp?`, `ProjectEvent.timestamp?` (never assigned by any engine). | Remove all four. |
| F10 | `[A-B10][A-B11][A-B12][A-C1][A-C2]` Exports with no role in the 1.0 contract: `PlaybackOperation` (referenced by no signature), `SequencePlayerTransportState` (a mirror type no prop or ref uses; critic reads it as intentional), `SequencePlayerBaseProps` (same type as `SequencePlayerProps`), `clamp`, `clamp01` (generic arithmetic), `normalizeTempoEvent`, `normalizeTempos` (internals of `normalizeTimingMap`). | Stop exporting them. |

## Group 3 — breaking changes that need a decision

| ID | Finding | Options (recommended first) |
|---|---|---|
| F11 | **medium→high when hit** `[C2]` `@vixeq/react` and `@vixeq/player-react` depend on `@vixeq/core` (and player-react on `@vixeq/react`) as an exact-pinned `dependency`. When the consumer's core differs (a core-only patch, or packages added at different times) two copies install: the hook's `engine` stops being assignable to the consumer's `SequencerEngine` (TS2345, private-field nominality), and `useAnimatedChannels` misses `instanceof PlaybackError` and rethrows `TRANSPORT_DISPOSED` from its rAF loop. Reproduced. Changing to peers after 1.0 changes install requirements. | (a) Peer `@vixeq/core: ^1.0.0` (player-react also peers `@vixeq/react`), devDependency `workspace:*`, and detect disposal by `error.code`. (b) Keep exact pins and only switch to `code` detection. |
| F12 | `[C5]` `addTimelineEvent`/`addTimelineTrack` take `Partial<…>` but throw `TypeError` for anything missing except `id` (reproduced); `normalizeTimelineEvent` takes the same `Partial` and fills defaults. | (a) Narrow the parameter to "the full shape with optional `id`", matching spec §2. (b) Keep `Partial` and fill defaults like `normalize*` (widens behavior instead). |
| F13 | `[A-B7]` React hook naming is split three ways: `useSequencerEngine`/`SequencerEngineHookOptions`/`SequencerEnginePendingOperation` vs `useArrangement`/`UseArrangementOptions` vs `useTimeline`/`UseTimelineOptions`; plus aliases `useSequencePlayer`/`SequencePlayerHookState`. | (a) Rename to `useSequencer`, `UseSequencerOptions`, `UseSequencerState`, `SequencerPendingOperation`, `SequencerLatestEvent`; remove the aliases. (b) Keep. |
| F14 | `[A-B8]` Arrangement alone uses "arrangement" where the shared vocabulary is "project": `getArrangement`/`setArrangement`, `ArrangementProjectEvent.arrangement/previousArrangement`, `useArrangement({ arrangement })`. | (a) Rename to `getProject`/`setProject`, `project`/`previousProject`, `useArrangement({ project })`; keep `createArrangement`/`normalizeArrangement`/`validateArrangement` (named after the type). (b) Keep. |
| F15 | `[A-B2]` Engines, hooks, and refs use `seekPositionMs`; `PlaybackTransport` alone uses `seekMs` (spec §3.3 says `seekMs`). Breaks custom transport implementers. | (a) Rename to `seekPositionMs` and update the spec. (b) Keep: the transport consistently names everything `*Ms`. |
| F16 | `[A-D1]` vs `[C]` Public hook types use `MutableRefObject`, which `@types/react` 19.2.17 marks `@deprecated` (verified). The critic notes that React 18's `RefObject` is `T \| null`, so switching to `RefObject` would be wrong for the peer range. | (a) Publish a `ReadonlyRef<T> = { readonly current: T }` and use it for `positionRef`, `latestEventRef`, and `useAnimatedChannels`; correct on 18 and 19, and read-only matches intent. (b) Keep `MutableRefObject`. |
| F17 | `[C11]` `presets` and every `getProject()` return live internal objects; mutating `presets.pulse.tracks[0].steps[0] = 7` after constructing an engine changes its output to an out-of-contract 7 (reproduced). Types are not `readonly`. | (a) Deep-freeze `presets`, document "inputs and returned projects are treated as immutable", keep the types mutable. (b) Also make the project types `readonly` (broad breaking change across helpers and consumers). |
| F18 | `[A][C7]` playback-v2 §3.1 promises an `iteration` field on Arrangement/Timeline snapshots; it is not implemented (Arrangement tracks it internally). | (a) Remove the sentence from the contract; add `iteration` later as a minor if needed. (b) Implement it in rc.2. |
| F19 | `[C9]` `ArrangementEngine`/`TimelineEngine.seekPositionMs` throw `RangeError` beyond the local duration, while the contract (playback-v2 §3, PB-EN-007) says range validation belongs to the transport; seeking the transport directly to the same position is accepted. | (a) Follow the contract: drop the engine-side range check. (b) Keep the check and rewrite the contract. |

## Kept as is (both reviewers, or one with no objection)

- `on` (engines, named channels) vs `subscribe` (transport, one discriminated stream): different shapes, different names. Only the return type is unified (F6).
- `missedCuePolicy` with the shared `MissedStepPolicy` type: the contract's cue vocabulary.
- Sequencer has no loop option or `setLoop`, and `SequencePlayerRef` has no `setLoop`: a pattern always loops.
- `TimelineEngine` is not a `ChannelSource`: it schedules cues and has no continuous channels.
- Engine `setLoop(): void` vs hook `setLoop(): Promise<void>`: hooks serialize every command; document it.
- Type aliases only, no `interface`: declaration merging stays closed.
- `sampleChannelsAt` throws on negative input: engines are strict; the lenient pure functions arrive with #5.
- Arrangement pure functions, `SmoothingConfig`, `*V1` types, `browserClock`, `presets`, `SEQUENCER_LIMITS`: 1.1 foundations or named in the spec.
- Release tags: `dtsRollup` is off, so `@internal` would not hide anything; unwanted exports are removed instead (F10).
- Packaging verified: attw (node16) and publint are green, and `@vixeq/core/dom` resolves under node16 ESM/CJS and bundler.

## Dispositions (project owner, 2026-10-21)

- Groups 1 and 2 (F1–F10): fix as proposed in rc.2.
- F11 (a) peer dependencies, disposal detected by `error.code`; README install
  sections list `@vixeq/core` (and `@vixeq/react` for player-react).
- F12 (a) narrow the parameter types; only `id` may be omitted.
- F13 (a) `useSequencer` naming; the aliases are removed; migration guide.
- F14 (a) Arrangement uses the `project` vocabulary on the engine, its event,
  and the hook; the pure functions keep their names.
- F15 (a) `PlaybackTransport.seekMs` becomes `seekPositionMs`; spec §3.3
  follows.
- F16 (a) publish `ReadonlyRef<T>` and use it for every exposed ref.
- F17 (a) deep-freeze `presets` and document that inputs and returned
  projects are immutable; types stay mutable.
- F18 (a) remove `iteration` from playback-v2 §3.1.
- F19 (a) drop the engine-side range check on `seekPositionMs`; seeking past
  local end behaves like seeking the transport there.

## Work split (one issue and one PR each, milestone `1.0.0-rc.2`)

| Issue | Findings | Packages |
|---|---|---|
| #16 Validation requires `stepsPerBeat` | F1 | core |
| #17 Public export cleanup | F2, F9, F10 | core, player-react |
| #18 Timeline helper types | F3, F12 | core |
| #19 `migrateTimelineProject` options | F4 | core |
| #20 Package manifests and peer dependencies | F5, F11 | all |
| #21 Transport and position naming | F6, F15 | core, react, e2e harness |
| #22 Arrangement `project` vocabulary | F14 | core, react |
| #23 React hook surface | F13, F16 | react, player-react |
| #24 Engine seek past local end | F19 | core |
| #25 Contract and semver policy | F7, F8, F17, F18 | docs, core (`presets`), react JSDoc |

The breaking items (F9–F16, F19) share one rc.1 → rc.2 migration note in
`CHANGELOG.md`; F13–F15 also get a migration guide under `docs/migrations/`.
After these land: TSDoc for every export with `ae-undocumented` as an error,
the README and guide code-example check, then the rc.2 release.
