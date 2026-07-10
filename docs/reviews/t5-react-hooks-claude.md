# T5 React Hooks Review

- Status: approved
- Task: T5 — Add `useTimeline` and migrate `useArrangement`
- Author: Codex
- Reviewer: Claude

## Scope

Implements the React hook layer for Timeline/Arrangement v2:

- adds generic `useTimeline<TEvent>()`
- exports Timeline hook types from `@vixeq/react`
- migrates `useArrangement` tests/fixtures to ArrangementProject v2
- keeps examples and player UI out of scope for T6/future tasks

## Changed Files

- `docs/plans/v1-collaboration-spec.md`
- `docs/reviews/t5-react-hooks-claude.md`
- `packages/react/src/hooks.ssr.test.tsx`
- `packages/react/src/index.ts`
- `packages/react/src/useArrangement.test.tsx`
- `packages/react/src/useTimeline.ts`
- `packages/react/src/useTimeline.test.tsx`

## Review Focus

- Confirm `useTimeline<TEvent>()` preserves generic Timeline event data in callbacks/state.
- Confirm project errors vs transport errors match the React v2 contract.
- Confirm `eventValidator` changes correctly rebuild the TimelineEngine.
- Confirm `useTimeline` does not imply `ChannelSource` or connect to `useAnimatedChannels`.
- Confirm `useArrangement` migration is limited to v2 fixtures/tests without changing hook behavior unnecessarily.
- Confirm public React exports include hook types only, not Core Timeline types.

## Commands Run

- `pnpm --filter @vixeq/react typecheck`
- `pnpm --filter @vixeq/react test`
- `pnpm --filter @vixeq/react build`

## Known Failures

None in `@vixeq/react`.

T6 will integrate Timeline v2 and updated hooks into `website-pulse`.

---

## Review checklist

- [x] `useTimeline<TEvent>()` preserves generic Timeline event data through
      callbacks/state without erasure — see the dedicated write-up below.
      `TimelineEngine<TEvent>`/`TimelineCueEvent<TEvent>`/`onCue` all thread
      the type parameter end to end; `useTimeline.test.tsx` exercises this
      with a concrete `CaptionEvent` type at both the type-annotation level
      (`event.event.data?.text: string | undefined`) and the runtime-value
      level (`expect(text).toBe("Intro")`).
- [x] `projectError`/`transportError` classification matches the React v2
      contract and `useSequencerEngine`'s already-approved pattern exactly:
      construction failure and `setProject()` hot-swap failure set only
      `projectError`; `enqueueCommand`'s catch block sets only
      `transportError`; each success path clears only its own category;
      the command `Promise` still rejects after the `transportError` state
      update (`throw error;` after `setTransportError(error)`,
      `useTimeline.ts:159-164`); no competing playback-state `useState`
      machine exists — `playbackState` is set only from `engine.getPlaybackState()`
      at construction and from the Engine's own `"playback"` events.
- [ ] `eventValidator` changes rebuild the `TimelineEngine` correctly, **but
      the same reconstruction effect also incorrectly re-fires on `loop`
      changes** — see **B1** below. This is a real, empirically-confirmed
      regression relative to the sibling `useArrangement` pattern.
- [x] `useTimeline` does not imply `ChannelSource` or connect to
      `useAnimatedChannels`: `grep -n "useAnimatedChannels\|sampleChannels"
      packages/react/src/useTimeline.ts packages/react/src/useTimeline.test.tsx`
      returns no matches. `TimelineEngine` itself still has no
      `sampleChannels`/`sampleChannelsAt` (confirmed already by T3's
      dedicated test), and `useTimeline` does not add any equivalent.
- [x] `useArrangement` migration is limited to v2 fixtures/tests:
      `git diff HEAD --stat` shows `packages/react/src/useArrangement.ts`
      **not present** in the diff at all — only `useArrangement.test.tsx`
      changed (bpm/`timing` fixture updates, `getArrangement().timing.tempos[0].bpm`
      assertions replacing the old `.bpm` ones), no new hook-behavior
      assertions. `hooks.ssr.test.tsx`'s one-line diff (`durationBeats: 4`
      added to its fixture) is the same kind of v2-fixture-only change.
- [x] Public React exports include hook types only, not Core Timeline types:
      `packages/react/src/index.ts`'s new block exports `useTimeline`,
      `TimelineLatestEvent`, `TimelinePendingOperation`, `UseTimelineOptions`,
      `UseTimelineState` — all hook-local types. None of `TimelineEvent`,
      `TimelineProject`, `TimelineCueEvent`, `TimelineEngine`, etc. is
      re-exported from `@vixeq/react`, matching `useArrangement`'s and
      `useSequencerEngine`'s existing precedent of not re-exporting Core
      types.
- [ ] Full-workspace command re-verification — **`pnpm typecheck` is red**;
      see **B2** below. `@vixeq/react`'s own three commands
      (`test`/`typecheck`/`build`) and `pnpm test` (full workspace) are all
      green.

## Verification method

Read spec §4 (React v2 contract, lines 310-344) and §7's `useTimeline()`
paragraph (lines 471-472) in full, then read `useTimeline.ts` end to end
alongside the already-approved `useSequencerEngine.ts` and `useArrangement.ts`
side by side (they are structurally near-identical hooks, which is the
intended pattern per spec §4's shared shape), diffing them mentally
line-by-line to find any place `useTimeline` deviates from the established,
already-reviewed pattern without a stated reason. Read `useTimeline.test.tsx`,
`useArrangement.test.tsx` (post-diff), and `hooks.ssr.test.tsx`'s diff.
Read `TimelineEngine.ts` (T3, already approved) to confirm `setLoop()`,
`getProject()`, `setProject()`, and the absence of `sampleChannels*` /
`ChannelSource` methods, and to confirm `eventValidator` is threaded through
`TimelineEngineOptions<TEvent>` (`packages/core/src/timeline/types.ts:54,117,124`)
consistently with how the hook consumes it.

**On generic pass-through (checklist item 1):** confirmed by reading the
type signatures directly — `UseTimelineOptions<TEvent extends TimelineEvent
= TimelineEvent>` (`useTimeline.ts:34-46`) types `project: TimelineProject<TEvent>`,
`eventValidator?: TimelineEventValidator<TEvent>`, and
`onCue?: (event: TimelineCueEvent<TEvent>) => void`; `UseTimelineState<TEvent>`
(`useTimeline.ts:48-67`) types `engine: TimelineEngine<TEvent> | null` and
`latestEvent: TimelineLatestEvent<TEvent> | null` where
`TimelineLatestEvent<TEvent> = TimelineCueEvent<TEvent> | TimelinePlaybackEvent
| TimelineProjectEvent<TEvent>` (`useTimeline.ts:29-32`). Inside the hook body,
`engineRef`/`useState<TimelineEngine<TEvent> | null>` and the `"cue"` listener
(`newEngine.on("cue", (event) => { setLatestEvent(event); onCueRef.current?.(event); })`,
`useTimeline.ts:233-236`) all infer `event: TimelineCueEvent<TEvent>` from
`newEngine`'s own generic parameter — no `any`, no widening to base
`TimelineEvent`, anywhere in the file (confirmed by reading every occurrence
of `TEvent`). `useTimeline.test.tsx` exercises this at the value level, not
just the type level: the "wires cue events..." test defines a concrete
`CaptionEvent = TimelineEvent<"caption", { text: string }>`, calls
`useTimeline<CaptionEvent>({ project, transport, onCue })` with
`onCue: vi.fn<(event: TimelineCueEvent<CaptionEvent>) => void>()`, and after
`play()`, asserts both `onCue` was called with an object whose `event.id` is
`"intro"` and that `result.current.latestEvent` matches `{ event: { id:
"intro" } }` — then reads `latest.event.data?.text` through a type-narrowed
`"event" in latest` check and asserts the *runtime value* `"Intro"`. This
would fail to compile (not just fail at runtime) if `data` weren't typed as
`{ text: string } | undefined` on the narrowed union member, so the test
checks both levels the review focus asked for, not type-only.

**On `eventValidator` rebuild (checklist item 2, partially confirmed) and the
`loop` regression (B1):** read the construction effect
(`useTimeline.ts:199-284`) and its dependency array
(`useTimeline.ts:272-284`), then the dedicated `loop`-only effect
(`useTimeline.ts:305-309`) that calls `currentEngine.setLoop(loop ?? false)`.
Compared byte-for-byte against `useArrangement.ts`'s equivalent construction
effect (`useArrangement.ts:203-285`) and its own dedicated `loop`-only effect
(`useArrangement.ts:307-311`, identical shape). `useArrangement`'s
construction-effect dependency array (`useArrangement.ts:285`) is
`[constructionAttempt, lookaheadMs, missedStepPolicy, onPlaybackChangeRef,
onPositionRef, onProjectErrorRef, onSectionRef, onStepRef, onTransportErrorRef,
transport]` — **`loop` is deliberately absent**, because `ArrangementEngine`
(like `TimelineEngine`) exposes an incremental `setLoop(loop: boolean): void`
method (confirmed in `TimelineEngine.ts:231-253`: idempotent, no-op when
`loop === this.localLoop`, otherwise updates `this.localLoop` in place with
no disposal of anything) that the dedicated effect already calls whenever
`loop` changes — so `useArrangement` never rebuilds the Engine or its owned
transport just because the caller's `loop` option toggled.
`useTimeline.ts:276`, by contrast, **includes `loop`** in the construction
effect's own dependency array, in addition to having the identical dedicated
`loop`-only effect. This means every `loop` prop change fires *both* effects:
the dedicated one calls `setLoop()` on the (about-to-be-replaced) engine
harmlessly, but the construction effect's cleanup disposes the current
`TimelineEngine` and (if the caller didn't supply their own `transport`) the
owned `PlaybackTransport` too, then constructs a brand-new `TimelineEngine`
(and, if owned, a brand-new transport) from scratch — discarding the current
position, playback state, and (for an owned transport) the transport's own
position/rate entirely.

Wrote and ran an ad hoc probe test directly against the hook (temporarily
added as `packages/react/src/__probe_loop_rebuild.test.tsx`, run via
`pnpm --filter @vixeq/react exec vitest run src/__probe_loop_rebuild.test.tsx`,
then deleted — `git status --porcelain` confirmed clean afterward, no probe
file left in the tree) to confirm the divergence is real, not a misreading:

```
Scenario: renderHook(({ loop }) => useTimeline({ project, loop }), { initialProps: { loop: false } })
  1. seekBeat(2) -> positionRef.current.beat === 2, playbackState === "paused"
  2. rerender({ loop: true })  // only the `loop` option changes
  Expected (matching useArrangement's pattern): same engine instance, beat
    still 2, playbackState still "paused" (loop is a pure setLoop() call).
  Actual (confirmed by direct execution): a brand-new TimelineEngine instance
    (old one has disposed: true), cachedPositionMs reset to 0,
    lastDispatchedRawPositionMs reset to null, playbackState reset from
    "paused" to "stopped".
```

A second probe in the same file ran the identical scenario through
`useArrangement` (`renderHook(({ loop }) => useArrangement({ arrangement,
loop }), { initialProps: { loop: false } })`, `seekBeat(2)`, then `rerender({
loop: true })`) and confirmed `result.current.engine` is the *same* instance
before and after — i.e. the sibling hook that T5 is supposed to be
structurally mirroring does not have this problem, which is exactly what the
side-by-side dependency-array reading above predicts. Both probe assertions
matched their expected (bug present in `useTimeline`, absent in
`useArrangement`) outcomes; the `useTimeline` probe test failed exactly as
predicted, the `useArrangement` comparison probe passed.

**On the full-workspace typecheck (B2):** ran `pnpm typecheck` (fails), then
`pnpm -r --no-bail typecheck` to see every project's result without an early
stop — only `examples/arrangement-demo` fails, with the same two errors T4's
review already identified and explicitly classified as anticipated T5
fallout (`docs/reviews/t4-arrangement-v2-claude.md`'s B1 section: "`packages/react`
... and `examples/arrangement-demo` ... are both legitimately anticipated by
the review request's own disclosure ('T5 will update React hooks and any
React-side Arrangement v1 assumptions'), since both depend on
`@vixeq/react`'s `useArrangement`"). Confirmed `examples/arrangement-demo`
is genuinely React-side: `grep -rn "useArrangement\|@vixeq/react"
examples/arrangement-demo/src/` shows `App.tsx` imports and calls
`useArrangement` from `@vixeq/react`, and its `package.json` lists
`@vixeq/react` as a direct dependency.

Independently re-ran every requested and full-workspace command:

- `pnpm --filter @vixeq/react test` — 6 files, **32 tests passed**, no
  failures.
- `pnpm --filter @vixeq/react typecheck` — clean, no output.
- `pnpm --filter @vixeq/react build` — ESM/CJS/DTS all succeeded.
- `pnpm typecheck` (full workspace) — **fails**:
  `examples/arrangement-demo/src/arrangement.ts:11` (`TS2353`, `bpm` not a
  known `CreateArrangementOptions` property) and `:29` (`TS2339`,
  `arrangement.bpm` does not exist on `ArrangementProject`). All 9 other
  workspace projects (`packages/core`, `packages/react`,
  `packages/player-react`, `examples/cycling-workout`,
  `examples/vanilla-core`, `apps/playground`, `examples/react-player`,
  `examples/website-svg`, `examples/website-pulse`) typecheck clean.
- `pnpm test` (full workspace) — all test files pass in every package,
  including `examples/arrangement-demo` (`vitest run --passWithNoTests`
  reports 0 test files, exit 0 — this package has no test files, so `pnpm
  test` cannot surface B2 on its own; only `pnpm typecheck` does).

## Findings

### B1 (blocking) — `loop` option changes unnecessarily dispose and rebuild the `TimelineEngine` (and its owned transport), losing position and playback state

**File:** `packages/react/src/useTimeline.ts:272-284` (construction effect's
dependency array), specifically line 276 (`loop,`); contrast with
`packages/react/src/useArrangement.ts:285` (equivalent array, `loop`
correctly absent) and `useArrangement.ts:307-311` (the dedicated
`setLoop`-only effect both hooks otherwise share verbatim).

The construction effect (`useTimeline.ts:199-284`) is the one that calls
`new TimelineEngine(...)` and, in its cleanup, calls `newEngine.dispose()`
and (if the transport is owned, i.e. the caller passed no `transport` prop)
`activeTransport.dispose()`. Its dependency array includes `loop`
(`useTimeline.ts:276`), so this full teardown-and-rebuild runs every time the
caller's `loop` option value changes — not just on mount or on a genuine
`project`/`transport`/`lookaheadMs`/`missedCuePolicy`/`eventValidator`
change. `TimelineEngine.setLoop()` (`TimelineEngine.ts:231-253`) already
exists specifically to change this setting on a live engine without
disposing anything — it updates `this.localLoop` in place, re-applies the
current transport snapshot, and is a no-op when the value is unchanged — and
`useTimeline` already calls it from a second, separate effect
(`useTimeline.ts:305-309`) that is byte-for-byte identical to
`useArrangement`'s own dedicated loop effect. The only difference between
the two hooks is that `useArrangement.ts:285`'s construction-effect
dependency array *excludes* `loop`, relying solely on its dedicated effect,
while `useTimeline.ts:276` *includes* it in both places — the dedicated
effect's `setLoop()` call becomes moot because it fires against a `newEngine`
that the construction effect is about to (or just did) throw away.

**Failure scenario:** any consumer with an ordinary "loop" toggle —
`const [loop, setLoop] = useState(false); useTimeline({ project, loop })` — sees
the entire `TimelineEngine` (and, unless they supply their own `transport`
prop, the owned `PlaybackTransport` too) destroyed and recreated from scratch
every time the toggle flips, silently resetting playback position to 0 and
playback state to `"stopped"` even if the user was mid-playback or paused
partway through the timeline. This is not a contrived edge case; toggling
loop while paused/playing is an ordinary, expected UI interaction for a
scrubbable cue timeline. Confirmed empirically (see Verification method
above): `seekBeat(2)` then a `loop` prop flip (no other prop changed) resets
`cachedPositionMs` to `0`, `lastDispatchedRawPositionMs` to `null`, and
`playbackState` from `"paused"` to `"stopped"`, and produces a new engine
instance (`disposed: true` on the old one) — while the identical scenario
run through `useArrangement` correctly preserves the same engine instance
and position.

**Fix (for author to implement, not applied by this review):** remove
`loop` from the construction effect's dependency array
(`useTimeline.ts:272-284`), mirroring `useArrangement.ts:285` exactly. The
existing dedicated effect (`useTimeline.ts:305-309`) already handles
propagating `loop` changes to a live engine via `setLoop()` and needs no
change.

**Test-coverage gap:** no existing `useTimeline.test.tsx` test rerenders with
a changed `loop` *option* value — the only `loop`-related test coverage
(`"supports StrictMode lifecycle..."`) calls the hook's own returned
`setLoop()` *function* imperatively, which is a different code path (goes
through `enqueueEngineCommand` directly against the current engine, never
touches the construction effect) and cannot exercise this bug. A regression
test should mount `useTimeline` with `loop: false`, advance position (e.g.
via `seekBeat`), rerender with `loop: true`, and assert the engine instance
and `positionRef.current` are both unchanged — mirroring the pattern already
used for `eventValidator` changes (`useTimeline.test.tsx:162-180`), which
correctly *does* expect a new engine (a legitimate reconstruction case)
side by side with a case that must *not* reconstruct.

### B2 (blocking) — full-workspace `pnpm typecheck` remains red; `examples/arrangement-demo` was already flagged as T5-owned fallout and is still unmigrated, with no disclosure in this review request

**File:** `examples/arrangement-demo/src/arrangement.ts:11,29`.

This is not a defect in any of the reviewed `packages/react/src/*` files —
`useArrangement.ts` itself is correctly untouched (see checklist item 5) and
`useTimeline.ts`/`useArrangement.test.tsx` are internally consistent with the
v2 schema. The problem is that `examples/arrangement-demo` still calls
`createArrangement({ bpm: 120, patterns, sections })` (v1 shape) and reads
`arrangement.bpm` (`arrangement.ts:11`, `:29`), both rejected by the v2
`CreateArrangementOptions`/`ArrangementProject` types T4 shipped
(`TS2353`/`TS2339`). This example genuinely depends on `@vixeq/react` (its
`App.tsx` imports and calls `useArrangement`; `@vixeq/react` is a direct
`package.json` dependency) — i.e. it is exactly the "React-side Arrangement
v1 assumptions" category the T4 review's own B1 finding predicted T5 would
resolve, and that finding's exact wording
(`docs/reviews/t4-arrangement-v2-claude.md`, B1 section) is what this
review request's "Known Failures: None in `@vixeq/react`" line implicitly
claims to have addressed, by omission, for anything not `examples/`-scoped
(the Scope section explicitly says "examples ... out of scope for T6/future
tasks", but does not say *which* task now owns `examples/arrangement-demo`
specifically, and does not disclose that it is still broken).

**Failure scenario:** anyone running `pnpm typecheck` (or `pnpm build`
across the full workspace, or CI wired to it) after this change lands still
sees the same two compile errors that existed before T5 started, in a
shipped, listed-in-spec official example (`docs/plans/v1-collaboration-spec.md`
§11 lists "Arrangement demo" as an official release fixture), with the
"Known Failures" section of this very review request not mentioning it —
someone relying on that section alone would believe the full workspace is
clean.

**Not a proposed fix, per the task's own convention of leaving remediation
choices to the author/user (mirroring how T4's B1 was resolved) — options:**
(a) fold the same small, mechanical v1→v2 fixture update T4's own B1 fix
applied to `examples/cycling-workout/src/workout.ts` (`version: 2`,
`timing: createTimingMap({ bpm: 120 })`, explicit `durationBeats`) into this
task, since it is genuinely React-hook-adjacent and was already predicted to
land here; (b) explicitly reassign it to a specific task row (T6 or a new
row) in the same edit that updates the task table for T5; or (c) at minimum
amend this review request's "Known Failures" section to name
`examples/arrangement-demo` explicitly and get sign-off that the full
workspace staying red is acceptable, disclosed debt until some later task
closes it — consistent with how T1/T2/T3/T4 (after its own B1 fix) all left
the full workspace typechecking cleanly at their own handoff points.

### N1 (non-blocking) — `docs/api/react.md` was not updated for the new `useTimeline` hook

**File:** `docs/api/react.md`.

Per spec §13.6 ("Update API docs, migration notes, and the API report in the
same change as the public API modification") and mirroring T4's own N1
finding (`docs/api/core.md`'s Arrangement section left stale), this file
documents `useSequencerEngine`/`useSequencePlayer`, `useArrangement`,
`useAnimatedChannels`, and `usePrefersReducedMotion` but has no entry for the
new, exported `useTimeline` hook at all — `git diff HEAD -- docs/api/react.md`
is empty for this change.

**Fix (not applied by this review):** add a `useTimeline(options)` bullet
parallel to the existing `useArrangement` one, describing its returned
shape (`engine`, `playbackState`, `positionRef`, `latestEvent`,
`projectError`, `transportError`, `play`/`pause`/`stop`/`toggle`,
`seekPositionMs`/`seekBeat`, `setPlaybackRate`, `setTransportLoop`/`setLoop`)
and noting explicitly that it does not implement `ChannelSource` and is not
usable with `useAnimatedChannels` (mirroring spec §7's own explicit
statement), since a reader of this file alone would not otherwise learn that
distinction.

### N2 (non-blocking) — `eventValidator`'s construction-time-only design offers no protection against an unstable reference

**File:** `packages/react/src/useTimeline.ts:274` (dependency array),
`options.eventValidator` (`useTimeline.ts:40`).

`eventValidator` is legitimately a construction-time-only `TimelineEngine`
option (per T3, it cannot be changed on a live engine — there is no
`setEventValidator()`), so including it in the construction effect's
dependency array is correct in principle, unlike the `loop` case (B1). But
unlike `project`/`transport` (which callers are already expected to keep
referentially stable across renders, or accept the resulting rebuild as
intentional), `eventValidator` is a new kind of option for this hook family,
and nothing in the hook or its documentation warns a caller that passing an
inline arrow function (`useTimeline({ project, eventValidator: (e) => {...} })`)
will force a full engine rebuild — with the same position/state-loss
consequence as B1 — on every single render, not just on an intentional
validator change. `useTimeline.test.tsx`'s own `eventValidator` test
(`useTimeline.test.tsx:162-180`) only exercises the intentional-change case
(two named, stable function references, `accept` and `reject`, swapped via
`rerender`), not the inline/unstable-reference case. Low severity — this is
consistent with how `transport` already behaves, and is arguably acceptable
for a construction-only option — but worth a documentation note (e.g. in
`docs/api/react.md`'s new `useTimeline` entry, see N1) recommending callers
memoize `eventValidator` the same way they're expected to memoize
`transport`.

## Final verdict

**Changes requested.** The core of T5's `useTimeline` implementation is
sound and closely mirrors the already-approved `useSequencerEngine`/
`useArrangement` Playback v2 hook pattern: the generic `TEvent` parameter is
threaded through `TimelineEngine<TEvent>`, `TimelineCueEvent<TEvent>`,
`onCue`, and `latestEvent` without erasure, verified at both the type and
runtime-value level by `useTimeline.test.tsx`'s `CaptionEvent` case;
`projectError`/`transportError` classification matches the React v2 contract
and the already-approved `useSequencerEngine` pattern exactly (construction
and hot-swap failures set only `projectError`; command rejections set only
`transportError`; each success path clears only its own category; command
Promises still reject after the error-state update; there is no competing
playback-state source); the hook correctly avoids any `ChannelSource`/
`useAnimatedChannels` connection per spec §7's explicit prohibition; the
`useArrangement` migration is genuinely fixture-only (`useArrangement.ts`
itself has zero diff); and the public export surface adds only hook-local
types, not Core Timeline types, matching precedent. All three
`@vixeq/react`-scoped commands from the review request
(`test`/`typecheck`/`build`) are independently confirmed green (32 tests, 6
files; clean typecheck; clean ESM/CJS/DTS build), and `pnpm test` (full
workspace) passes everywhere.

However, two blocking issues remain:

**B1** is a genuine, empirically-confirmed correctness bug in the very
mechanism the review focus asked about (Engine-reconstruction consistency):
`useTimeline`'s construction effect includes `loop` in its dependency array
(`useTimeline.ts:276`) in addition to the dedicated `setLoop()`-only effect
it shares with `useArrangement` — but `useArrangement`'s own equivalent
array deliberately excludes `loop` (`useArrangement.ts:285`), because
`TimelineEngine`/`ArrangementEngine` both already expose an incremental,
non-disposing `setLoop()` for exactly this case. The result is that an
ordinary `loop` option toggle fully disposes and recreates the
`TimelineEngine` (and, unless the caller supplies their own `transport`, the
owned `PlaybackTransport` too), silently resetting position to 0 and
playback state to `"stopped"` — confirmed by direct execution against both
hooks side by side, not just a reading of the dependency arrays.

**B2** repeats, in the exact category the prior task's own review already
named and predicted T5 would resolve, the same kind of full-workspace
typecheck regression that blocked T4's initial sign-off:
`examples/arrangement-demo` (a genuinely React-side official example that
imports `useArrangement` from `@vixeq/react`) still constructs a v1-shaped
`ArrangementProject` and fails to typecheck, and this review request's
"Known Failures" section does not disclose that `pnpm typecheck` is still
red as a result — unlike T4's own (partial) disclosure of the same class of
issue.

The two non-blocking findings (N1: `docs/api/react.md` was not updated to
document `useTimeline` per spec §13.6, mirroring T4's own N1 finding for
`docs/api/core.md`; N2: `eventValidator`'s construction-time-only design
means an inline/unstable function reference will force a full engine rebuild
on every render — an inherent, arguably-by-design property of a
construction-time option rather than a defect, but worth documenting) do not
block sign-off on their own and may be addressed at the author's discretion.

Recommend: fix B1 (remove `loop` from `useTimeline.ts`'s construction-effect
dependency array, add a regression test that rerenders with a changed
`loop` value and asserts the engine instance and position are unchanged,
mirroring the existing `eventValidator`-changes-should-rebuild test's
opposite case), resolve or explicitly, visibly defer B2
(`examples/arrangement-demo`'s v1→v2 migration, or an explicit task-table
reassignment plus an honest "Known Failures" disclosure), then re-request
review. N1/N2 may be addressed in the same or a later pass at the author's
discretion.

---

## Re-review (fixes verification)

**Reviewer:** Claude (this session, verifying fixes applied by Claude in a
separate turn per user instruction). Scope limited to B1 and B2 only, per the
user's explicit direction that this pass is blocking-only; N1/N2 are
addressed below only to confirm their disposition.

### B1 — resolved

Read `packages/react/src/useTimeline.ts` end to end.

- The construction effect's dependency array (`useTimeline.ts:272-283`) no
  longer includes `loop`. It now reads:
  `[constructionAttempt, eventValidator, lookaheadMs, missedCuePolicy,
  onCueRef, onPlaybackChangeRef, onPositionRef, onProjectErrorRef,
  onTransportErrorRef, transport]` — this matches
  `useArrangement.ts:285`'s equivalent array shape (modulo the
  Timeline-specific `eventValidator` entry, which is correctly still present
  and out of scope for B1; see N2 below).
- `loop` is still read from `options` (`useTimeline.ts:108`) and still passed
  as a construction-time initial value into `new TimelineEngine(project, {
  transport: activeTransport, lookaheadMs, loop, missedCuePolicy,
  eventValidator })` (`useTimeline.ts:204-210`) — so a fresh engine still
  respects the caller's `loop` value at construction time, it just no longer
  forces reconstruction when `loop` changes on its own.
- The dedicated `loop`-only effect (`useTimeline.ts:304-308`) is unchanged
  and still present verbatim:
  ```
  useEffect(() => {
    const currentEngine = engineRef.current;
    if (!currentEngine) return;
    currentEngine.setLoop(loop ?? false);
  }, [loop]);
  ```
  This is the effect that now exclusively owns propagating `loop` changes to
  a live engine via the existing non-disposing `TimelineEngine.setLoop()`,
  exactly mirroring `useArrangement.ts:307-311`.

**Regression test check** (`useTimeline.test.tsx:182-197`, `"does not rebuild
the engine when only loop changes"`): read the assertion bodies, not just the
test name/title.
- Mounts with `initialProps: { loop: false }`.
- `await act(async () => { await result.current.seekBeat(2); })`, then
  captures `const engine = result.current.engine;` and asserts
  `result.current.positionRef.current.beat` is `2` — establishing a non-zero,
  non-default position/engine-identity baseline before the change under test.
- `rerender({ loop: true })` — changes **only** the `loop` prop, nothing
  else.
- Asserts `expect(result.current.engine).toBe(engine)` (same instance, not
  just deep-equal — this is the correct assertion shape to catch a
  dispose-and-reconstruct regression, since a rebuilt engine would be a
  different object even if it coincidentally read `beat: 2` again) and
  `expect(result.current.positionRef.current.beat).toBe(2)` (position
  survived the `loop` change instead of resetting to 0).

This is the exact inverse of the adjacent `"rebuilds the engine when
eventValidator changes"` test (`useTimeline.test.tsx:162-180`, asserts
`.not.toBe(engine)` and a null engine/projectError after a validator swap),
which is the correct side-by-side pairing the original review's fix
recommendation asked for. Confirmed by direct execution (not just reading):
`pnpm --filter @vixeq/react test` — 6 files, **33 tests passed** (32 prior +
this 1 new test), no failures.

**Verdict: B1 resolved.**

### B2 — resolved

Read `examples/arrangement-demo/src/arrangement.ts` end to end and diffed it
mentally against the v1 shape the original finding quoted.

- `createArrangement({ ... })`'s call now passes `timing: { bpm: 120 }` and
  `durationBeats: 32` (`arrangement.ts:10-12`) instead of the old top-level
  `bpm: 120`. Checked `CreateArrangementOptions` (`packages/core/src/arrangement/types.ts:37-42`):
  `timing?: CreateTimingMapOptions | TimingMap` — a bare `{ bpm: 120 }` is a
  valid `CreateTimingMapOptions` shape, so this is not just type-error-silencing,
  it's the intended v2 construction path (same pattern T4's own B1 fix used
  for `examples/cycling-workout/src/workout.ts`, per the original review's
  own reference).
- `durationBeats: 32` matches the last section's `endBeat: 32`
  (`chorus-2`, `arrangement.ts:18`) exactly — confirmed by reading
  `TOTAL_BEATS = Math.max(...arrangement.sections.map((s) => s.endBeat))`
  (`arrangement.ts:31`), which independently computes the same value `32`
  from the section list, so `durationBeats` and the derived `TOTAL_BEATS`
  are consistent with each other and with the arrangement's actual last
  section boundary — no off-by-one or stale-constant risk.
- `BEAT_SECONDS` (`arrangement.ts:30`) now reads
  `60 / arrangement.timing.tempos[0].bpm` instead of the old
  `60 / arrangement.bpm` — matches `ArrangementProject.timing: TimingMap`'s
  actual shape (`packages/core/src/arrangement/types.ts:29-35`), and
  `TOTAL_SECONDS = TOTAL_BEATS * BEAT_SECONDS` (`arrangement.ts:32`) is
  unchanged and still type-checks against these two numbers.
- `grep -rn "\.bpm\b" examples/arrangement-demo/src/` returns only the new,
  correct `arrangement.timing.tempos[0].bpm` reference — no other stray
  `.bpm` access (e.g. against the removed top-level property) remains
  anywhere in the example's source.

Independently re-ran every requested command from a clean shell, not reusing
any cached result:

- `pnpm --filter @vixeq/react test` — 6 files, **33 tests passed**, 0
  failures.
- `pnpm --filter @vixeq/react typecheck` — clean, no output.
- `pnpm --filter vixeq-example-arrangement-demo typecheck` — clean, no
  output.
- `pnpm typecheck` (full workspace, `pnpm -r typecheck`) — **all 10
  workspace projects report `Done` with no errors**: `packages/core`,
  `packages/react`, `packages/player-react`, `examples/vanilla-core`,
  `examples/cycling-workout`, `examples/arrangement-demo`, `apps/playground`,
  `examples/react-player`, `examples/website-pulse`, `examples/website-svg`.
  The previously-red `examples/arrangement-demo` project now typechecks
  clean alongside the other 9.
- `pnpm test` (full workspace) — every package's test run passes (or reports
  `--passWithNoTests` for packages with no test files, including
  `examples/arrangement-demo` itself, which still has none): `packages/core`
  269 tests, `packages/react` 33 tests, `examples/cycling-workout` 5 tests,
  `packages/player-react` 6 tests, `apps/playground` 11 tests — no failures
  anywhere in the workspace.

**Verdict: B2 resolved.**

### N1 / N2 — unchanged, non-blocking, author's discretion

Per the user's explicit scoping for this pass ("N1・N2 は今回対応不要"), these
were not addressed and this re-review does not require them to be:

- **N1** (`docs/api/react.md` not updated for the new `useTimeline` hook per
  spec §13.6): `git diff HEAD -- docs/api/react.md` is still empty; the file
  still documents `useSequencerEngine`/`useSequencePlayer`, `useArrangement`,
  `useAnimatedChannels`, and `usePrefersReducedMotion` but has no
  `useTimeline` entry. Still open, still non-blocking, left to the author's
  discretion as originally recommended.
- **N2** (`eventValidator`'s construction-time-only rebuild has no
  documented warning about unstable/inline references): `useTimeline.ts`'s
  construction effect still includes `eventValidator` in its dependency
  array (`useTimeline.ts:274`, correctly, per the original finding's own
  reasoning — this is not a defect), and no doc note was added recommending
  callers memoize it. Still open, still non-blocking, left to the author's
  discretion as originally recommended.

Neither N1 nor N2 blocks sign-off; both remain exactly where the original
review left them.

### Overall verdict

Both blocking findings (B1, B2) are resolved and independently re-verified
by direct execution of every requested command, with the full workspace
(`pnpm typecheck`, all 10 projects; `pnpm test`, all packages) green. No new
regressions were introduced by either fix — the `useArrangement` migration
and all previously-passing `@vixeq/react` tests remain green, and the
regression test added for B1 correctly exercises the negative case (engine
identity and position preserved) side-by-side with the existing positive
case (`eventValidator` change forces rebuild).

**Status: approved.**
