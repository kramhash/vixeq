# T0 Timing/Timeline/Arrangement v2 Schema — Review

- Reviewer: Claude (review agent)
- Author: Claude
- Status: approved
- Normative contract: [`../behavior/timeline-arrangement-v2.md`](../behavior/timeline-arrangement-v2.md)
- Matrix: [`../behavior/timeline-arrangement-v2-matrix.md`](../behavior/timeline-arrangement-v2-matrix.md)
- Migration: [`../migrations/0.8-timeline-arrangement-v2.md`](../migrations/0.8-timeline-arrangement-v2.md)

Claude should record findings here rather than editing the normative files
directly. The author resolves findings in the source documents; Claude then
marks the final verdict, mirroring the P0 review convention
(`docs/reviews/p0-playback-v2-claude.md`).

## Scope

Docs-only work item. Translates the already-approved upper-level contract in
`v1-collaboration-spec.md` §5 (TimingMap), §6–7 (TimelineProject/TimelineEngine),
§8 (ArrangementProject), and §9 (Migration rules) into an implementable
behavioral contract, a stable-ID test matrix, and a v1→v2 migration guide,
following the pattern established by `playback-v2.md` /
`playback-v2-matrix.md` / `0.7-playback-v2.md`. No implementation code, tests,
or `docs/api/*.md` changes are included — those are explicitly deferred to
T1–T5 per spec §13.6.

## Changed files

- `docs/behavior/timeline-arrangement-v2.md` (new)
- `docs/behavior/timeline-arrangement-v2-matrix.md` (new)
- `docs/migrations/0.8-timeline-arrangement-v2.md` (new)
- `docs/plans/v1-collaboration-spec.md` (task table: T0 status `pending` ->
  `in_progress`, owner `Claude (author)`)

## Review focus

- Every normative rule in spec §5–9 is represented in
  `timeline-arrangement-v2.md` without introducing new public behavior beyond
  what §5–9 already approved.
- Every rule has at least one corresponding matrix row (`TM-*`, `TL-*`,
  `TL-Q-*`, `TL-EN-*`, `AR-*`, `MIG-*`) with a testable expected result.
- The v1 field shapes referenced in the migration guide match the current
  implementation (`packages/core/src/timeline/types.ts`,
  `packages/core/src/timeline/timing.ts`,
  `packages/core/src/arrangement/types.ts`) — in particular `offsetMs`,
  the `trackId: "global"` sentinel, `TimelineTrack.type`,
  `TimelineEvent.durationBeats`/`value`, and `ArrangementProject.bpm`.
- `sequenceProjectToTimeline()` removal is accurately described (no silent
  replacement implied) and the suggested explicit-construction snippet is
  correct against the current `SequenceProject` shape.
- No 0.9 CI/coverage-gate or T1+ implementation detail leaked into T0.

## Commands run

None. This is a documentation-only change; no package typecheck, build, or
test run applies. Markdown cross-links were checked manually for resolution
(target files exist, relative paths correct).

## Known expected failures

None — no tests exist yet for the `planned` matrix rows; that is expected at
this stage.

## Review checklist

- [ ] Every normative rule in spec §5–9 is represented in
      `timeline-arrangement-v2.md` without introducing new public behavior
      beyond what §5–9 already approved. **Not satisfied**: see B1 — the §6
      optional runtime domain-validation callback is missing.
- [x] Every rule has at least one corresponding matrix row (`TM-*`, `TL-*`,
      `TL-Q-*`, `TL-EN-*`, `AR-*`, `MIG-*`) with a testable expected result,
      *except* the missing callback rule in B1, which therefore also has no
      matrix row.
- [ ] The v1 field shapes referenced in the migration guide match the
      current implementation. **Not fully satisfied**: see B2 (arithmetic
      error in the `sequenceProjectToTimeline()` replacement snippet) and N1
      (inaccurate "before" behavior claim for `trackIds` vs. global events).
- [x] `sequenceProjectToTimeline()` removal is accurately described as
      having no direct replacement (no silent substitution implied). The
      *concept* of the removal is correct; only the illustrative
      replacement snippet's arithmetic is wrong (B2).
- [x] No 0.9 CI/coverage-gate or T1+ implementation detail leaked into T0.
      CHANGELOG/README example requirements are correctly deferred to
      T1–T5, and the matrix's `planned` status convention is followed.
- [x] Markdown cross-links resolve. Verified `docs/behavior/playback-v2.md`,
      `docs/behavior/playback-v2-matrix.md`, `docs/migrations/0.7-playback-v2.md`,
      and the three new T0 files all exist at the referenced relative
      paths.

## Verification method

Read `v1-collaboration-spec.md` §5–9 and §13, `p0-playback-v2-claude.md` (for
format/tone), and the three new T0 documents. Cross-checked every rule
against the current v1 implementation:

- `packages/core/src/timeline/types.ts`
- `packages/core/src/timeline/timing.ts`
- `packages/core/src/timeline/query.ts`
- `packages/core/src/timeline/fromSequence.ts`
- `packages/core/src/arrangement/types.ts`
- `packages/core/src/limits.ts`
- `packages/core/src/types.ts` (`SequenceProject` shape, for the migration
  snippet)
- `packages/core/src/timeline/timeline.test.ts` (existing
  `sequenceProjectToTimeline()` test fixture, to confirm what the current
  v1 formula actually produces)

## Blocking issues

### B1 — Spec §6's optional domain-validation callback is not represented

`v1-collaboration-spec.md` §6 states: "Generic event unions are supported by
TypeScript. Runtime domain validation is provided through an optional
callback accepted by validation and Engine construction. Core validates
common structure and JSON compatibility without adding a schema-library
dependency." This is a normative rule about the public shape of
`TimelineEvent<TType, TData>` generics.

`timeline-arrangement-v2.md` §2 (TimelineProject v2) and §3 (TimelineEngine
semantics) describe the generic `TimelineEvent<TType, TData>` type and
structural/JSON-compatibility validation, but nowhere define the optional
domain-validation callback itself — no signature, no parameter name on
`validateTimelineProject()`/construction helpers, no mention of it being
accepted by `TimelineEngine` construction options. There is also no matrix
row (`TL-*`) exercising acceptance or rejection through such a callback.

This is a concrete gap against the review focus's first bullet ("every
normative rule in spec §5-9 is represented ... without introducing new
public behavior beyond what §5-9 already approved") — the rule exists in
the parent but has no child-doc realization at all, so T1-T2 implementers
have no frozen signature to build against.

Suggested fix: add to §2 (e.g. a new §2.2) something like:

```ts
export type TimelineEventValidator<TEvent extends TimelineEvent = TimelineEvent> =
  (event: TEvent) => void; // throws to reject a domain-invalid event
```

accepted as an option by `validateTimelineProject()`/the strict construction
helpers and by `TimelineEngine` construction options, plus a new matrix row
(e.g. `TL-019`) covering both acceptance and rejection through the callback.

### B2 — Migration snippet's beat-conversion formula is arithmetically wrong

`docs/migrations/0.8-timeline-arrangement-v2.md`, the `sequenceProjectToTimeline()`
removal section, computes:

```ts
durationBeats: sequence.stepCount * (4 / sequence.stepsPerBeat),
// ...
beat: stepIndex * (4 / sequence.stepsPerBeat),
```

`SequenceProject.stepsPerBeat` (`packages/core/src/types.ts`) means "steps
per beat," so one step spans `1 / stepsPerBeat` beats, and the whole
pattern spans `stepCount / stepsPerBeat` beats. The snippet uses
`4 / stepsPerBeat` instead of `1 / stepsPerBeat` — a factor-of-4 error. For
the schema default (`stepsPerBeat: 4`, `SEQUENCER_LIMITS.defaultStepsPerBeat`),
the snippet yields 1 beat per step and a 16-step pattern spanning 16 beats
(four bars) instead of 4 beats (one bar); every event lands 4x later than
intended.

This is also a *different* formula from the current v1
`fromSequence.ts` (`packages/core/src/timeline/fromSequence.ts:12`), which
uses `4 / project.stepCount` and ignores `stepsPerBeat` entirely — that
formula is itself fragile (only correct when `stepCount === 4 *
stepsPerBeat`, which is what the existing test fixture in
`timeline.test.ts` happens to use), but the new snippet doesn't even match
it or reduce to the correct value in the default case. Since the review
focus explicitly asks to verify "the suggested explicit-construction
snippet is correct against the current `SequenceProject` shape," this
should block sign-off.

Suggested fix: replace both occurrences of `4 / sequence.stepsPerBeat` with
`1 / sequence.stepsPerBeat`.

## Non-blocking findings

### N1 — "Before" query-options example misdescribes actual v1 behavior

The migration doc's "Query options" section shows:

```ts
getEventsInBeatRange(project, 0, 8, { trackIds: ["captions"] });
// global events were always included; no way to exclude them
```

Per the real `matchesQueryOptions()` in `packages/core/src/timeline/query.ts`,
the `options.trackIds` check runs *before* the `event.trackId === "global"`
bypass:

```ts
if (options.trackIds && !options.trackIds.includes(event.trackId)) {
  return false;
}
// ...
if (event.trackId === "global") {
  return true;
}
```

So the exact call shown (`trackIds: ["captions"]`) actually *excludes* a
global event in v1, unless the caller also adds the literal `"global"`
sentinel to the array — the opposite of what the comment claims. Suggested
correction: reword to something like "supplying `trackIds` unintentionally
excluded global events too, unless the caller happened to include the
`'global'` sentinel itself in the list — there was no dedicated way to keep
global events while restricting to specific tracks." This doesn't change
any v2 rule, only the accuracy of the v1 characterization.

### N2 — `data` JSON-compatibility narrowing not listed in the rename table

v1 types `TimelineTrack.data`/`TimelineEvent.data` as `Record<string,
unknown>` with no runtime shape constraint. v2 requires `JsonObject` with
finite numeric leaves (contract §2, matrix `TL-013`/`TL-014`). This is a
real, potentially-breaking narrowing for existing consumers who stored
non-JSON values (functions, `Date`, `undefined`, etc.) in `data`, but the
"Package-wide renames and removals" table in the migration doc doesn't
mention it. Consider adding a row or a short callout note.

### N3 — §7's `useTimeline()` sentence has no acknowledgment

Spec §7 includes one React-hook sentence ("Add `useTimeline()` in
`@vixeq/react`. It exposes discrete React state and a mutable position ref,
and it does not connect to `useAnimatedChannels`."). `timeline-arrangement-v2.md`
is scoped to Core Timing/Timeline/Arrangement semantics and doesn't restate
it — a defensible choice, since T5 is the dedicated task-table item for
`useTimeline()`/`useArrangement` migration, and the doc's own intro already
defers Playback v2 restatement the same way. But nothing in the doc
explicitly says this React-hook rule is deferred rather than overlooked.
A one-line note ("`useTimeline()`'s React contract is deferred to T5 per
the task table") would remove the ambiguity. Non-blocking.

## Final verdict

**Changes requested.** The overall structure, grain, and format correctly
follow the `playback-v2.md`/`playback-v2-matrix.md`/`0.7-playback-v2.md`
pattern, and the vast majority of spec §5-9 rules are represented
accurately and at an implementable, testable grain (verified rule-by-rule
against `v1-collaboration-spec.md` §5-9 and against the current v1
implementation files). No T1+ implementation detail or 0.9 CI/coverage-gate
content leaked into T0, and cross-links resolve correctly.

Two issues block sign-off:

- **B1**: spec §6's optional runtime domain-validation callback for generic
  `TimelineEvent` unions has no realization in `timeline-arrangement-v2.md`
  or the matrix.
- **B2**: the `sequenceProjectToTimeline()` migration snippet's beat-conversion
  formula (`4 / sequence.stepsPerBeat`) is arithmetically wrong and would
  mislead anyone copying it — it should be `1 / sequence.stepsPerBeat`.

Three non-blocking documentation-accuracy nits (N1-N3) are recorded above
for the author to pick up in the same pass or as a fast follow-up. Once B1
and B2 are resolved in the normative documents, T0 should be re-reviewed
(a short pass re-checking just those two sections is sufficient) before
being marked `done` in the task table.

## Re-review (fixes verification)

Scope: verify only that B1, B2, N1, N2, N3 were resolved correctly in the
updated `timeline-arrangement-v2.md`, `timeline-arrangement-v2-matrix.md`,
and `0.8-timeline-arrangement-v2.md`. Not a from-scratch re-review.

- **B1 — resolved.** `timeline-arrangement-v2.md` now has a new §2.1
  "Domain validation callback" (lines 132–151) defining
  `TimelineEventValidator<TEvent>` (`(event: TEvent) => void`, throws to
  reject), and stating it is accepted as an optional argument by
  `validateTimelineProject()`/the strict construction helpers and by
  `TimelineEngine` construction options, running once per event after
  Core's structural/JSON checks, with a no-throw validator accepting the
  event and an omitted validator performing no extra checks. Matrix rows
  `TL-019` (validator throws → rejection propagates), `TL-019A` (validator
  does not throw → event accepted), and `TL-019B` (no validator → no extra
  validation) were added to `timeline-arrangement-v2-matrix.md`. Matches
  the suggested fix in substance (placed at §2.1 rather than the
  illustrative "§2.2" in the original suggestion, which is immaterial —
  the existing Query-options section simply shifted to §2.2 and every
  internal cross-reference to it, e.g. §3's "a pure query (§2.2)", was
  updated consistently; verified no dangling reference to an old numbering
  remains).

- **B2 — resolved.** `0.8-timeline-arrangement-v2.md`'s
  `sequenceProjectToTimeline()` removal snippet now computes
  `durationBeats: sequence.stepCount / sequence.stepsPerBeat` and
  `beat: stepIndex / sequence.stepsPerBeat`, with an added explanatory line
  ("`stepsPerBeat` means 'steps per beat,' so one step spans
  `1 / stepsPerBeat` beats and the whole pattern spans
  `stepCount / stepsPerBeat` beats."). This matches the suggested fix and
  is arithmetically correct for the default case
  (`stepCount: 16`, `stepsPerBeat: 4` → 4 beats, one bar).

- **N1 — resolved.** The "Query options" Before example's comment now
  reads "trackIds unintentionally excluded global events too, unless the
  caller happened to include the literal \"global\" sentinel in the list
  itself — there was no dedicated way to keep global events while
  restricting to specific tracks," matching the real `matchesQueryOptions()`
  ordering (`trackIds` check runs before the `trackId === "global"`
  bypass) and closely following the suggested wording.

- **N2 — resolved.** The "Package-wide renames and removals" table in
  `0.8-timeline-arrangement-v2.md` now includes the row
  `TimelineTrack.data`/`TimelineEvent.data: Record<string, unknown>` →
  `data?: JsonObject` (JSON-compatible only; numeric leaves must be
  finite), and the Timeline-events prose section adds a corresponding note
  on the breaking narrowing for non-JSON consumer values.

- **N3 — resolved.** `timeline-arrangement-v2.md`'s introductory paragraph
  now states: "`useTimeline()`'s React contract (spec §7) is deferred to
  task T5 and is intentionally not covered by this document."

- **Secondary checks — clean.** Code-fence counts are even in both edited
  files (18 fences / 9 pairs in `timeline-arrangement-v2.md`; 20 fences /
  10 pairs in `0.8-timeline-arrangement-v2.md`), so no broken triple-backtick
  blocks. All internal `§N`/`§N.N` self-references in
  `timeline-arrangement-v2.md` were checked against the actual (renumbered)
  section headings — §1 TimingMap, §2 TimelineProject (§2.1 Domain
  validation callback, §2.2 Query options and range queries), §3
  TimelineEngine semantics, §4 ArrangementProject, §5 Migration rules — and
  all resolve to the correct section; no stale reference to a pre-fix
  numbering was found. No other file in the repo links to an anchor inside
  these two docs, so the section insertion/renumbering has no external
  breakage.

### Re-review verdict

**Approved.** All two blocking issues (B1, B2) and all three non-blocking
findings (N1-N3) are resolved correctly and consistently, with no new
structural or numbering regressions introduced by the fixes. T0 may be
marked `done` in the task table.
