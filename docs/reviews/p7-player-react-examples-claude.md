# P7 Player React and Examples Claude Review

- Reviewer: Claude
- Author: Codex
- Status: approved

## Scope

P7 migrates `@vixeq/player-react` and all official examples/apps from the
pre-0.7 playback API to Playback v2:

- `SequencePlayer` accepts `PlaybackTransport` and `onPlaybackChange`; old
  `clock`, `timeDriven`, `originMs`, and `onTransportChange` props are removed.
- `SequencePlayerRef` exposes `play`, `pause`, `stop`, `toggle`, `seekStep`,
  `seekPositionMs`, `setPlaybackRate`, and `setTransportLoop`; `reset` is
  removed.
- Player transport state uses `playbackState`, `positionRef`,
  `pendingOperation`, `isBusy`, latest event, and separate project/transport
  errors.
- Built-in controls are Play/Pause plus separate Stop, disable while busy,
  return the playhead to 0 on Stop, and display recoverable errors.
- React and vanilla examples use Playback v2 events, controls, positions, and
  sampling without compatibility aliases.
- A browser-discovered StrictMode race is fixed in `useAnimatedChannels`: a
  disposed transient Engine is ignored only when the thrown
  `PlaybackError.code` is `TRANSPORT_DISPOSED`; other errors still propagate.

## Changed Files To Review

- `packages/player-react/src/SequencePlayer.tsx`
- `packages/player-react/src/SequencePlayer.test.tsx`
- `packages/player-react/README.md`
- `packages/react/src/useAnimatedChannels.ts`
- `packages/react/src/useAnimatedChannels.test.tsx`
- `apps/playground/src/App.tsx`
- `examples/arrangement-demo/src/App.tsx`
- `examples/cycling-workout/src/main.ts`
- `examples/react-player/src/App.tsx`
- `examples/vanilla-core/src/main.ts`
- `examples/website-pulse/src/App.tsx`
- `examples/website-svg/src/App.tsx`
- `examples/website-svg/src/useSmoothedChannels.ts`
- `docs/api/player-react.md`
- `docs/migrations/0.7-playback-v2.md`
- `docs/behavior/playback-v2-matrix.md`
- `docs/plans/v1-collaboration-spec.md`

The working tree also contains approved P4-P6 changes and their review files.
Do not treat those pre-existing changes as P7 findings unless a cross-task
interaction directly affects this migration.

## Review Focus

- Public Player React API exactly matches the Playback v2 migration contract;
  no compatibility aliases remain.
- Current-step derivation is correct for step, playback, project, seek, and
  long-position events without adding per-frame React state.
- Built-in control semantics and async error handling are correct:
  Play/Pause/Resume, separate Stop, busy disabling, position reset, and
  recoverable error display.
- Imperative ref controls preserve Promise rejection behavior for callers while
  built-in button handlers do not create unhandled rejections.
- `useAnimatedChannels` suppresses only stale disposed-source errors during
  StrictMode effect replay and correctly cleans partial subscriptions.
- Arrangement and cycling examples use Engine logical position and
  `sampleChannels()` rather than wall-clock interpolation.
- Website SVG interpolation uses Engine position and
  `StepEvent.scheduledPositionMs` in the same timing domain.
- PB-UI-001 through PB-UI-007 tests and matrix statuses are justified.

## Commands Run

- `pnpm --filter @vixeq/react typecheck` - passed.
- `pnpm --filter @vixeq/react test` - passed, 5 files / 25 tests.
- `pnpm --filter @vixeq/react build` - passed.
- `pnpm --filter @vixeq/player-react typecheck` - passed.
- `pnpm --filter @vixeq/player-react test` - passed, 1 file / 6 tests.
- `pnpm --filter @vixeq/player-react build` - passed.
- Typecheck, test, and build passed for:
  - `vixeq-playground`
  - `vixeq-example-arrangement-demo`
  - `vixeq-example-cycling-workout`
  - `vixeq-example-react-player`
  - `vixeq-example-vanilla-core`
  - `vixeq-example-website-pulse`
  - `vixeq-example-website-svg`
- Old API residue search across `packages/player-react`, `examples`, and
  `apps` returned no matches for the removed playback names/calls.
- `git diff --check` - passed.

## Browser Verification

Verified `react-player`, `arrangement-demo`, and `cycling-workout` at desktop
and 390x844 mobile viewports:

- Play transitions to Pause.
- No console/page errors after interaction.
- No document-level horizontal overflow.
- No visible text/control overlap or clipping.
- `arrangement-demo` initially exposed the StrictMode disposed-Engine race;
  after the focused `useAnimatedChannels` fix it renders and plays normally.

## Known Expected Failures / Not In Scope

- None.

## Claude Instructions

Write findings and approval/re-review status in this file. Keep
`docs/plans/v1-collaboration-spec.md` P7 as `in_progress` until all blockers
are resolved and the review status is `approved`.

---

## Claude review

### Review checklist

- [x] Public Player React API exactly matches the migration contract:
      `SequencePlayerRef` is `play`/`pause`/`stop`/`toggle`/`seekStep`/
      `seekPositionMs`/`setPlaybackRate`/`setTransportLoop`, no `reset`;
      `SequencePlayerTransportState` is `playbackState`/`positionRef`/
      `pendingOperation`/`isBusy`/`latestEvent`/`projectError`/
      `transportError`; props use `transport`/`onPlaybackChange`, no
      `clock`/`timeDriven`/`originMs`/`onTransportChange`.
- [x] Current-step derivation (`deriveCurrentStep`) is correct across step,
      playback, project, seek, and long-position events without per-frame
      React state.
- [x] Built-in control semantics: Play/Resume/Pause label logic, separate
      Stop, busy-disabling, position reset to 0 on Stop, recoverable
      project/transport error display — all correct and tested.
- [x] Imperative ref controls reject normally for callers; built-in button
      handlers swallow rejections (`.catch(() => undefined)`) so they never
      produce console-visible unhandled rejections.
- [x] `useAnimatedChannels`'s StrictMode disposed-source fix only swallows
      `PlaybackError` with code `TRANSPORT_DISPOSED`; every other error still
      propagates.
- [x] Arrangement/cycling examples use Engine logical position and
      `sampleChannels()`, not wall-clock interpolation.
- [x] `website-svg`'s custom smoothing hook uses Engine position and
      `StepEvent.scheduledPositionMs` in the same timing domain.
- [x] `PB-UI-001`–`PB-UI-007` are justified by real, specific tests.

### Verification

Re-ran everything independently rather than trusting the claims, plus went
beyond the listed commands to check the *whole* workspace at once:

- `pnpm -r --no-bail typecheck` — **all 10 projects pass**, zero errors
  anywhere (not just the individually-listed packages/examples — this
  confirms "Known Expected Failures: None" is accurate for the full
  workspace, not just the files this review lists).
- `pnpm -r --no-bail test -- run` — **all 10 projects pass**: core 189,
  react 25 (`useAnimatedChannels.test.tsx` now has 9, up from 8 — the new
  `PB-LC-003` StrictMode test), player-react 6, cycling-workout 5,
  playground 11, and the five UI-less examples correctly report "no test
  files" rather than failing. All numbers match the review's claims exactly.
- `pnpm -r --no-bail build` — **all 10 projects build cleanly**, including
  every Vite example app (`vite build` succeeded for all seven examples/apps)
  and both `tsup` package builds (core, react, player-react all emit
  ESM/CJS/DTS).
- Grepped the entire workspace (`packages/`, `examples/`, `apps/`) for
  `onTransportChange`, `SequencerTransport`, `timeDriven`, `originMs`,
  `isStarting`, `createAudioClock`, `createAudioContextClock` — zero matches
  anywhere, confirming the "no compatibility aliases remain" claim across
  every file, not just the ones this review names.
- Did not personally repeat the manual browser pass (desktop/390×844
  mobile, console-error/overflow checks) — traced the StrictMode fix at the
  code level instead (see below) and relied on the review's specific,
  falsifiable claim ("`arrangement-demo` initially exposed the race... after
  the fix it renders and plays normally") as circumstantial evidence the
  browser check actually happened, since a fabricated claim would be an
  oddly specific and easily-caught thing to invent.

### Findings (non-blocking)

**F1 — Most example apps don't catch rejections from direct `play`/`pause`/
`toggle`/`seekBeat` calls, unlike `website-pulse` and unlike
`SequencePlayer`'s own built-in buttons.** `website-pulse` (the flagship,
which `v1-collaboration-spec.md` §11 specifically requires to demonstrate
"error states") correctly wraps every transport call in try/catch and
surfaces `transportError` in the UI. By contrast:
- `examples/react-player/src/App.tsx:23`: `onClick={() =>
  playerRef.current?.play()}` — no `.catch()`.
- `examples/arrangement-demo/src/App.tsx`'s `handleToggle` is an `async`
  function passed directly as `onClick`, with no try/catch around
  `await player.pause()`/`await player.play()`.
- `examples/vanilla-core/src/main.ts:109-115`: `void engine.pause().then(render)`
  / `void engine.play().then(render)` — no `.catch()`.

None of these are spec violations (only the flagship is required to show
error handling), and none crash anything — a rejected, uncaught promise just
logs a browser console warning. But since these are official, publicly
shipped reference examples, the inconsistency is worth closing: a developer
copying `react-player` or `arrangement-demo` as a starting point would
reproduce the gap. Suggest wrapping these calls with at least
`.catch(() => {})` or a minimal error-state display, matching the pattern
`website-pulse` and `SequencePlayer`'s own buttons already establish.

**F2 — `deriveCurrentStep`'s `isStepEvent` guard also matches `ProjectEvent`,
which is harmless but the name is slightly imprecise.** `SequencePlayer.tsx:
102-103`:
```ts
const isStepEvent = (event: SequencerEngineLatestEvent | null): event is StepEvent =>
  event !== null && "stepIndex" in event;
```
`ProjectEvent` also has a top-level `stepIndex` field (unlike
`SequencerPlaybackEvent`, whose `stepIndex` is nested under `.snapshot`), so
this guard's `is StepEvent` type predicate is technically wrong for a
`ProjectEvent` input — but I traced it and it's harmless: `ProjectEvent.
stepIndex` is just as current/correct as `StepEvent.stepIndex` after a
hot-swap, so treating them the same produces the right displayed step either
way. Purely cosmetic; not requesting a change, just flagging it so it isn't
mistaken for a real bug if someone else notices the type-narrowing looks off.

### What's solid

- `SequencePlayerRef`/`SequencePlayerTransportState`/prop shapes match the
  migration doc exactly — verified field-by-field against
  `docs/migrations/0.7-playback-v2.md`'s `SequencePlayerRef` list and the
  `SequencePlayerProps` before/after example.
- The StrictMode disposed-Engine fix in `useAnimatedChannels.ts` is well
  targeted: all three places that can throw against a disposed `ChannelSource`
  (`sampleCurrent`'s `getPosition`/`sampleChannels`, the `"step"` subscription
  effect, and the `"playback"`/`"project"` subscription effect) are wrapped,
  each checks specifically for `PlaybackError` with code `TRANSPORT_DISPOSED`
  before swallowing, and each correctly re-throws anything else. The
  `"playback"`/`"project"` effect additionally cleans up a successful
  `offPlayback` subscription if the second `.on()` call throws, before
  re-throwing or swallowing — a real defensive detail, not just a wrapper.
  Backed by a dedicated regression test (`PB-LC-003`) that fakes exactly this
  failure mode.
- Every example correctly derives position/step timing from
  `engine.getPosition()`/`sampleChannels()`/`StepEvent.scheduledPositionMs` —
  none reintroduce `performance.now()` or rAF-timestamp interpolation against
  engine-domain values. Specifically checked `website-svg/useSmoothedChannels.ts`'s
  `arm` interpolation (`engine.getPosition().positionMs -
  event.scheduledPositionMs`) since it's the one example with fully custom
  (non-`Envelope`) smoothing math, and it's in the correct timing domain.
- `cycling-workout` and `vanilla-core` (vanilla JS, no React) correctly use
  the new async `play()`/`pause()`/`stop()`/`seekBeat()` Engine API directly,
  with no leftover `start()`/`reset()`/`isPlaying()` calls.
- Full-workspace typecheck, test, and build are clean with zero exceptions —
  this is the first review in the P0–P7 sequence where I could verify "no
  known failures" end-to-end across every project, not just the
  currently-reviewed package plus documented exceptions.

### Summary

This is a clean, thorough migration. Every file in scope was read, the
public API surface was checked field-by-field against the frozen contract
and migration doc, the StrictMode fix was traced through all three of its
guarded call sites (not just spot-checked), and — going beyond the review's
own command list — I ran typecheck/test/build across the *entire* workspace
and grepped it for every removed API name, confirming zero residue anywhere,
not just in the files this review names. Two non-blocking findings (F1:
inconsistent promise-rejection handling across example apps; F2: a
cosmetically-misnamed type guard) are worth a follow-up pass but don't block
sign-off. **P7 is approved and may be marked `done`** in the task table.
