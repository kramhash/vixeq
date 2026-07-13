# Timing, Timeline, and Arrangement v2 Behavior Matrix

- Status: 78 of 79 rows `covered` as of 0.9.0 R1; remaining `planned`: AR-011
  (a step event with `cause: "project-change"` fires on a forced-reposition
  hot-swap, but no test currently asserts it). CI (`pnpm behavior:check`)
  fails if a `covered` row's ID is not found in any test.
- Normative contract: [`timeline-arrangement-v2.md`](timeline-arrangement-v2.md)

Each matrix ID is stable. Tests added during T1–T5 must include the ID in the
test name or an adjacent comment, then change the row status to `covered`. T0
does not add intentionally failing tests.

Status values: `planned`, `covered`, `blocked`.

## TimingMap v2 (`TM-*`)

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| TM-001 | createTimingMap with single bpm | one tempo at beat 0; startPositionMs 0 | covered |
| TM-002 | createTimingMap with tempos list missing beat 0 | normalize synthesizes a beat-0 tempo | covered |
| TM-003 | createTimingMap with negative/non-finite startPositionMs option | normalize clamps/defaults to 0 | covered |
| TM-004 | normalizeTimingMap with out-of-range bpm | clamps into [minBpm, maxBpm] | covered |
| TM-005 | normalizeTimingMap with unsorted/duplicate tempo beats | sorts and repairs to strictly increasing beats | covered |
| TM-006 | validateTimingMap with valid map | returns without throwing | covered |
| TM-007 | validateTimingMap missing beat-0 tempo | throws RangeError | covered |
| TM-008 | validateTimingMap with non-increasing or duplicate beats | throws RangeError | covered |
| TM-009 | validateTimingMap with out-of-range bpm | throws RangeError | covered |
| TM-010 | validateTimingMap with negative/non-finite startPositionMs | throws RangeError | covered |
| TM-011 | validateTimingMap with wrong-typed field | throws TypeError | covered |
| TM-012 | beatToMs across a single-tempo map | linear conversion from startPositionMs | covered |
| TM-013 | beatToMs across multiple tempo segments | segment-accumulated conversion at each boundary | covered |
| TM-014 | msToBeat is the inverse of beatToMs | round-trip beat -> ms -> beat within floating tolerance | covered |
| TM-015 | msToBeat before startPositionMs | returns beat 0 | covered |
| TM-016 | beatToMs/msToBeat never receive or return a clock timestamp | pure functions of TimingMap + transport-relative value only | covered |

## TimelineProject v2 schema and validation (`TL-*`)

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| TL-001 | construct minimal valid v2 project | version 2, durationBeats > 0, empty tracks/events accepted | covered |
| TL-002 | event with trackId null | treated as global event | covered |
| TL-003 | event with trackId referencing missing track | validateTimelineProject ok:false; update helpers throw TypeError | covered |
| TL-004 | event missing/empty type | validateTimelineProject ok:false; update helpers throw TypeError | covered |
| TL-005 | event carrying durationBeats or value field | strict construction rejects removed v1 fields | covered |
| TL-006 | track carrying type field | strict construction rejects removed v1 field | covered |
| TL-007 | event beat out of [0, durationBeats) | validateTimelineProject ok:false; update helpers throw TypeError | covered |
| TL-008 | duplicate event IDs | validateTimelineProject ok:false; update helpers throw TypeError | covered |
| TL-009 | duplicate track IDs | validateTimelineProject ok:false; update helpers throw TypeError | covered |
| TL-010 | events with equal beat | dispatch/order preserved as array order | covered |
| TL-011 | add event without id | deterministic event-N assigned using first unused suffix | covered |
| TL-012 | add track without id | deterministic track-N assigned using first unused suffix | covered |
| TL-013 | non-JSON-compatible data value | strict construction/update throws | covered |
| TL-014 | non-finite numeric leaf in data | strict construction/update throws | covered |
| TL-015 | remove track with events | associated events are removed with it | covered |
| TL-016 | invalid update helper input | update rejected; input Project value unchanged | covered |
| TL-017 | durationBeats non-positive or non-finite | validateTimelineProject ok:false; update helpers throw TypeError | covered |
| TL-018 | sequenceProjectToTimeline usage | function does not exist on the v2 public surface | covered |
| TL-019 | construction with a domain validator that throws | rejection propagates like a structural validation failure | covered |
| TL-019A | construction with a domain validator that does not throw | event accepted; behavior identical to Core-only checks | covered |
| TL-019B | construction with no domain validator | no extra domain validation performed | covered |

## TimelineQueryOptions and range queries (`TL-Q-*`)

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| TL-Q-001 | default query options | global events included; disabled-track events excluded | covered |
| TL-Q-002 | includeGlobalEvents false | global events excluded regardless of trackIds | covered |
| TL-Q-003 | trackIds filter with a global event present | trackIds has no effect on the global event's inclusion | covered |
| TL-Q-004 | includeDisabledTracks true | disabled-track events included | covered |
| TL-Q-005 | eventTypes filter | only matching types returned | covered |
| TL-Q-006 | valid half-open range query | returns events in [fromBeat, toBeat) | covered |
| TL-Q-007 | range query with fromBeat > toBeat | throws RangeError; not reordered | covered |
| TL-Q-008 | range query outside [0, durationBeats] | throws RangeError; not clamped | covered |

## TimelineEngine semantics (`TL-EN-*`)

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| TL-EN-001 | TimelineEngine implements ChannelSource | type check/verification fails; no sampleChannels methods present | covered |
| TL-EN-002 | valid seekBeat | transport position updated; no cue events emitted | covered |
| TL-EN-003 | invalid seekBeat (out of range, non-finite) | synchronous RangeError; no queued operation | covered |
| TL-EN-004 | natural playback with missedCuePolicy emit | every crossed event dispatches in beat order with lateByMs | covered |
| TL-EN-005 | natural playback with missedCuePolicy skip | only the most-advanced due event dispatches, unconditionally (no lateness threshold) | covered |
| TL-EN-006 | explicit seek across pending cues | missedCuePolicy not invoked; zero cues emitted for the traversed range | covered |
| TL-EN-007 | looping playback crossing beat 0 | beat-0 event dispatches again on each iteration | covered |
| TL-EN-008 | dispatch event fields | iteration, scheduledPositionMs, transportPositionMs, lateByMs all present | covered |
| TL-EN-009 | Project hot-swap during playback | beat position preserved; no transport seek | covered |
| TL-EN-010 | hot-swap adds event at/before current beat | not emitted retroactively; eligible on next pass | covered |
| TL-EN-011 | non-looping local end | transitions to local ended; shared transport unaffected | covered |
| TL-EN-012 | 100,000-event fixture range query | bounded index probes independent of total event count | covered |
| TL-EN-013 | 100,000-event fixture per-tick dispatch | no full-event-list scan per tick | covered |

## ArrangementProject v2 (`AR-*`)

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| AR-001 | construct minimal valid v2 arrangement | version 2, timing TimingMap present, no top-level bpm field | covered |
| AR-002 | construct arrangement with legacy bpm field | strict construction rejects removed v1 field | covered |
| AR-003 | durationBeats missing/non-positive | strict construction throws | covered |
| AR-004 | durationBeats exceeds last section endBeat | trailing gap outputs 0 on every channel | covered |
| AR-005 | section beats outside [0, durationBeats] | strict construction throws RangeError | covered |
| AR-006 | overlapping sections | strict construction throws | covered |
| AR-007 | pattern-local bpm on a SequenceProject pattern | ignored; Arrangement TimingMap governs conversion | covered |
| AR-008 | tempo change mid-arrangement | beat-to-position conversion changes; section/pattern beat placement unchanged | covered |
| AR-009 | non-looping hot-swap shortens duration below current beat | moves to new end and transitions to ended | covered |
| AR-010 | looping hot-swap shortens duration below current beat | modulo into new duration and continues | covered |
| AR-011 | hot-swap forced reposition | exactly one destination step with cause project-change | planned |

## Migration (`MIG-*`)

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| MIG-001 | migrateTimelineProject with valid v1 offsetMs | maps to startPositionMs unchanged | covered |
| MIG-002 | migrateTimelineProject with invalid v1 offsetMs | returns ok:false with a MigrationIssue | covered |
| MIG-003 | migrateTimelineProject with trackId "global" | rewritten to trackId null with no warning | covered |
| MIG-004 | migrateTimelineProject with event durationBeats/value present | ok:true with one warning per affected event, or ok:false when meaning cannot be preserved without caller option | covered |
| MIG-005 | migrateTimelineProject with track type present | ok:true with one warning per affected track | covered |
| MIG-006 | migrateArrangementProject with v1 bpm | maps to one TempoEvent at beat 0 | covered |
| MIG-007 | migrateArrangementProject without explicit durationBeats option | returns ok:false; no inferred value | covered |
| MIG-008 | migrateArrangementProject with explicit durationBeats option | ok:true using the supplied value | covered |
| MIG-009 | normalize*() called on already-v2 data | no version change; repairs stay within v2 schema | covered |
| MIG-010 | migrate*() never invoked implicitly by Engine/Project construction | strict construction throws instead of migrating | covered |
