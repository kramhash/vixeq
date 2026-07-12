# R6 Render-Frugal `latestEventRef` Claude Review

- Reviewer: Claude
- Author: Claude
- Status: approved (self-review), then independently re-reviewed and fixed
  in a separate Claude session (see "Independent Second-Reviewer Pass" below)

## Independent Second-Reviewer Pass

A later, separate session ran a multi-angle adversarial code review against
this diff specifically because this document flagged itself as unreviewed by
a second party. Five independent finder passes (line-by-line, removed-
behavior audit, cross-file consumer trace, reuse/simplification/efficiency,
altitude/conventions) converged independently on the same regression:

**Found and fixed**: `SequencePlayer`'s new `latestStep` local state (used by
`deriveCurrentStep` for the step-grid/readout highlight) was only ever set
from `onStep`, never reset. Core's `stop()` resets `currentStepIndex` to 0 but
emits only a `"playback"` event, not a `"step"` event, so the highlight
stayed frozen on the last-played step after Stop instead of returning to
step 0 — directly contradicting this document's and the migration guide's
"`SequencePlayer`'s playhead highlight is unaffected" claim. The existing
`PB-UI-001` stop assertion didn't catch it because a `seekPositionMs(9000)`
immediately before `stop()` coincidentally already landed on step 0.

Fix: `SequencePlayer.tsx` now wraps `onPlaybackChange` internally and calls
`setLatestStep(null)` on a `"stop"` event before forwarding to the caller's
`onPlaybackChange`. A new regression test (`SequencePlayer.test.tsx`, "resets
the step highlight to Step 1 after stop, even from a non-zero step") seeks to
a non-zero step and stops directly, with no intervening seek that would mask
the bug; it was confirmed to fail against the pre-fix code and pass after the
fix. `docs/migrations/0.9-react-render-frugal.md` and `CHANGELOG.md` were
corrected to describe the actual (now-fixed) behavior instead of the
inaccurate "unaffected" claim.

Other candidates raised by the same review (project-hot-swap re-render
guarantees weakening for bare `useSequencerEngine`/`useTimeline` consumers
who read `latestEventRef` during render, and `latestStep` similarly not
resetting on a controlled project replacement) were judged PLAUSIBLE but
lower-severity/out of scope for this pass — the former is arguably the
documented ref contract working as intended (consumers are not expected to
read a ref during render), and the latter is masked by `stepIndex %
stepCount` wrapping into a valid-but-stale range rather than breaking
outright. Not addressed here; left for a future pass if it proves to matter
in practice.

## Scope

R6 addresses an unreviewed re-render cost in the Playback v2 React hooks
(P6/T5): `useSequencerEngine`/`useSequencePlayer`, `useArrangement`, and
`useTimeline` each called `setLatestEvent(event)` on every step/cue event,
forcing every consumer of the hook to re-render on every scheduled step
(roughly `stepsPerBeat * bpm / 60` times per second — up to ~160/s at the
configured limits), independent of whether the consumer read the field.

## Investigation

A repository-wide audit of every `useSequencerEngine`/`useSequencePlayer`/
`useArrangement`/`useTimeline` call site (packages, apps, examples) found:

- **`@vixeq/player-react`'s `SequencePlayer`** is the only component reading
  the hook's `useState`-backed `latestEvent` field, to derive the currently
  playing step for its grid/readout highlight
  (`deriveCurrentStep` in `SequencePlayer.tsx`).
- `apps/playground` and `examples/website-svg` need per-step data, but
  already source it from the `onStep` callback into their own local state —
  they never read the hook's `latestEvent` field.
- `examples/sandbox`, `examples/arrangement-demo`, and
  `examples/website-pulse` do not read `latestEvent` at all, yet paid the
  per-step re-render as a pure cost. The latter two use the zero-render
  `useAnimatedChannels` (`engine.on("step")` direct subscription) for
  animation and treat the hook's own re-render as unwanted overhead.
- `useAnimatedChannels` was already fully independent of hook re-renders
  (subscribes to the engine directly, holds a ref) and needed no change.

Conclusion: `latestEvent` as a `useState` field was load-bearing for exactly
one consumer. `positionRef` had already established the "expose as a ref,
not state" pattern for continuous data (`docs/plans/v1-collaboration-spec.md`
§4); this task extends the same pattern to discrete events.

## Decision

Per the spec's collaboration protocol (rule 10: stop and record the
decision when implementation would conflict with an approved behavior),
this change first amended `docs/plans/v1-collaboration-spec.md` §4 and §7
(this same change) before implementation:

- `latestEvent: T | null` (a `useState` field) → `latestEventRef:
  MutableRefObject<T | null>` across `useSequencerEngine`/
  `useSequencePlayer`, `useArrangement`, and `useTimeline`.
- `SequencePlayer` no longer reads the hook's latest-event field; it tracks
  its own `latestStep` state from an internal `onStep` handler that also
  forwards to the caller's `onStep` prop, preserving its existing per-step
  repaint behavior.
- No other hook behavior changes: `playbackState`, `positionRef`,
  `projectError`, `transportError`, `pendingOperation`, command queueing,
  and `useAnimatedChannels` are unchanged.

This is a breaking public API change (shape of `latestEvent` →
`latestEventRef`), landing pre-1.0 under lockstep versioning. Rejected
alternatives: an opt-in flag (keeps a dual code path and a footgun default),
and removing the field outright (loses the imperative escape hatch that
`SequencePlayer` and future ref-reading consumers rely on).

## Changed Files To Review

- `docs/plans/v1-collaboration-spec.md` (§4, §7, task table)
- `packages/react/src/useSequencerEngine.ts`
- `packages/react/src/useArrangement.ts`
- `packages/react/src/useTimeline.ts`
- `packages/react/src/useSequencerEngine.test.tsx`
- `packages/react/src/useArrangement.test.tsx`
- `packages/react/src/useTimeline.test.tsx`
- `packages/player-react/src/SequencePlayer.tsx`
- `packages/player-react/src/SequencePlayer.test.tsx`
- `docs/migrations/0.9-react-render-frugal.md` (new)
- `CHANGELOG.md`

`packages/react/README.md` and `apps/docs/src/content/docs/guide/react.md`
were checked for `latestEvent` references and found to have none (neither
documents the field), so neither required an edit — they are intentionally
absent from the list above.

## Commands Run

- `pnpm --filter @vixeq/react typecheck` — pass
- `pnpm --filter @vixeq/player-react typecheck` — pass
- `pnpm --filter @vixeq/react test -- --run` — 6 files, 36 tests pass
  (added `PB-RE-010` in `useSequencerEngine.test.tsx`, an analogous test in
  `useArrangement.test.tsx`, and one in `useTimeline.test.tsx`, each
  confirming `latestEventRef` mutates on every natural tick/cue with zero
  additional re-renders)
- `pnpm --filter @vixeq/player-react test -- --run` — 7 tests pass (added a
  natural-tick playhead-repaint contrast test; existing PB-UI-001 step
  highlight assertions cover the `latestStep`-based migration unchanged)
- `pnpm --filter @vixeq/react build` / `pnpm --filter @vixeq/player-react build` — pass
- `pnpm -r typecheck` — 12/12 applicable workspace projects pass
- `pnpm -r test` — all workspace packages/examples/apps with tests pass
  (`packages/core` 275, `packages/react` 36, `packages/player-react` 7,
  `apps/playground` 11, `examples/cycling-workout` 5)
- `pnpm -r build` — full workspace build passes
- `pnpm --filter vixeq-docs build:site` — Starlight + TypeDoc build passes;
  spot-checked generated `.../type-aliases/sequencerenginehookstate/` output
  reflects `latestEventRef`

## Skipped Checks

- No API Extractor / `.api.md` report exists yet in this repo (spec R0 is
  still `pending`), so there is no generated API report to update for this
  change.
- Browser E2E (spec R3, `pending`) was not run; this change has no
  browser-environment-specific behavior (pure React state/ref refactor).

## Known Expected Failures

None expected; this is a mechanical, same-shape-elsewhere refactor.
