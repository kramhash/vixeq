# Playback v2 Behavior Matrix

- Status: Approved test plan; implementation coverage is `planned`
- Normative contract: [`playback-v2.md`](playback-v2.md)

Each matrix ID is stable. Tests added during P1–P7 must include the ID in the
test name or an adjacent comment, then change the row status to `covered`.
P0 does not add intentionally failing tests.

Status values: `planned`, `covered`, `blocked`.

## Transport state and commands

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| PB-TR-001 | New unbounded clock transport | stopped at 0, duration null, rate 1, loop/buffering false | covered |
| PB-TR-001A | createClockTransport with PlaybackClock | clock drives position/timers through the renamed low-level contract | covered |
| PB-TR-002 | play from stopped | play event precedes Promise resolution; position advances | covered |
| PB-TR-003 | pause while playing | position freezes and pause event emits once | covered |
| PB-TR-004 | play from paused | resumes frozen position without reset | covered |
| PB-TR-005 | stop from any live state | position becomes 0 and state stopped | covered |
| PB-TR-006 | play from ended | resets to 0 before play | covered |
| PB-TR-007 | duplicate play/pause/stop | resolves with no duplicate event | covered |
| PB-TR-007A | pause from stopped or ended | state-preserving no-op with no event | covered |
| PB-TR-007B | stop from ended | transitions to stopped at 0 and emits stop | covered |
| PB-TR-008 | seek to same position | emits one seek event | covered |
| PB-TR-009 | valid seek | event contains previous position and post-seek snapshot | covered |
| PB-TR-009A | seek while playing/paused | preserves playing/paused state | covered |
| PB-TR-009B | seek from stopped | stays stopped at 0; becomes paused above 0 | covered |
| PB-TR-009C | seek from ended | stays ended at end; becomes paused below end | covered |
| PB-TR-010 | negative/non-finite/out-of-duration seek | synchronous RangeError; operation not queued | covered |
| PB-TR-011 | valid rate change | ratechange includes previous rate; scheduler follows new rate | covered |
| PB-TR-012 | zero/negative/non-finite rate | synchronous RangeError | covered |
| PB-TR-013 | enable loop with finite duration | loopchange emitted; full range loops | covered |
| PB-TR-013A | non-boolean loop input | synchronous TypeError | covered |
| PB-TR-014 | enable loop without duration | rejects with DURATION_UNAVAILABLE | covered |
| PB-TR-014A | construct clock transport with loop but no duration | synchronous DURATION_UNAVAILABLE | covered |
| PB-TR-015 | natural transport loop | loop event includes monotonically increasing iteration | covered |
| PB-TR-016 | natural finite end | ended at duration | covered |
| PB-TR-017 | duration becomes known/changes | durationchange contains previous duration | covered |
| PB-TR-018 | media waiting then resumes | bufferingchange toggles without leaving playing | covered |
| PB-TR-018A | buffering ends | state remains playing, buffering becomes false, scheduling resumes | covered |
| PB-TR-019 | platform command failure | Promise rejects once; no error event | covered |
| PB-TR-020 | unsolicited media failure | one error event with final snapshot | covered |
| PB-TR-020A | media command causes DOM side events | suppress side events and emit only the command's matching public event before Promise resolution | covered |
| PB-TR-020B | external media manipulation | emit the normal matching public event without command deduplication | covered |

## Transport queue, sharing, and lifecycle

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| PB-TR-021 | play then pause before play settles | operations execute in call order; final state paused | covered |
| PB-TR-022 | first queued operation rejects | later queued operation still executes | covered |
| PB-TR-023 | listener queues another operation | reentrant operation runs after current operation | covered |
| PB-TR-024 | listener throws | other listeners run and Promise still resolves | covered |
| PB-TR-025 | multiple subscribers share transport | all receive one ordered event stream independently | covered |
| PB-TR-026 | one Engine disposes | shared transport and second Engine remain active | planned |
| PB-TR-027 | attach during playback | snapshot adopted; no synthetic step/cue | planned |
| PB-TR-028 | transport dispose | dispose event precedes listener removal | covered |
| PB-TR-029 | repeated transport dispose | no-op and no second event | covered |
| PB-TR-030 | use transport after dispose | getters/actions/subscribe throw TRANSPORT_DISPOSED | covered |

## Engine state and position

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| PB-EN-001 | default Sequencer play | always time-driven; step 0 emitted | planned |
| PB-EN-002 | Sequencer pause/resume mid-step | position and phase freeze; no duplicate step | planned |
| PB-EN-003 | Engine stop | local position and shared transport return to 0 | planned |
| PB-EN-004 | valid seekStep | transport seeks; one destination step with cause seek | planned |
| PB-EN-005 | invalid seekStep | synchronous RangeError | planned |
| PB-EN-006 | valid seekBeat | mapped transport position; one Arrangement destination step | planned |
| PB-EN-007 | valid seekPositionMs | transport position is authoritative | planned |
| PB-EN-008 | delayed callback with emit | every crossed step emitted in order with lateByMs | planned |
| PB-EN-009 | delayed callback with skip | stale steps omitted; current scheduling resumes | planned |
| PB-EN-010 | explicit forward/backward seek | missedStepPolicy ignored | planned |
| PB-EN-011 | BPM/stepsPerBeat hot-swap | fractional beat preserved; media not sought | planned |
| PB-EN-011A | Sequencer Project update | one strict setProject path and one Project event | planned |
| PB-EN-012 | external seek after live tempo edit | temporary anchor discarded; evaluate from position 0 | planned |
| PB-EN-013 | invalid hot-swap | old Project/state/position/cursor remain atomic | planned |
| PB-EN-013A | invalid Engine constructor input | Sequencer and Arrangement throw TypeError without normalization | planned |
| PB-EN-014 | non-loop finite Project shortened | move to new end and enter ended | planned |
| PB-EN-015 | looping finite Project shortened | modulo position and continue | planned |
| PB-EN-016 | local Project end on shared transport | Engine ends; transport and peers continue | planned |
| PB-EN-017 | transport end | all attached Engines enter ended | planned |
| PB-EN-018 | transport dispose while playing | cache final position, become paused, controls reject | planned |
| PB-EN-018A | transport dispose while stopped/paused/ended | preserve local state and cached position | planned |
| PB-EN-019 | Engine dispose | idempotent; borrowed transport survives | planned |
| PB-EN-020 | Engine API after dispose | update/sample/subscribe/controls throw | planned |
| PB-EN-021 | Engine listener throws | peers/listeners/scheduler continue | planned |
| PB-EN-022 | Arrangement setLoop changes value | projectLoop updates and one command loopchange emits | planned |
| PB-EN-023 | Arrangement setLoop gets non-boolean | synchronous TypeError and no event | planned |
| PB-EN-024 | Arrangement setLoop gets current value | no-op and no event | planned |
| PB-EN-025 | Arrangement setArrangement succeeds | one strict atomic Project event | planned |
| PB-EN-026 | two Engines share one transport | both adopt and receive the ordered transport state stream | planned |

## Sampling, Project events, and Envelopes

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| PB-CH-001 | sampleChannels with browser transport | uses Engine logical position | planned |
| PB-CH-002 | sampleChannels with media transport | phase follows media position without clock-domain input | planned |
| PB-CH-003 | sample while paused/buffering/ended | returns frozen position values | planned |
| PB-CH-004 | sampleChannelsAt | evaluates Project-relative milliseconds independent of state | planned |
| PB-CH-005 | metadata-only Project change | project event has no changedChannelIds | planned |
| PB-CH-006 | active value change | project event contains only affected channel IDs | planned |
| PB-CH-007 | normal Project change | no synthetic StepEvent | planned |
| PB-CH-008 | Project-shortening reposition | one destination step with cause project-change | planned |
| PB-CH-009 | Sequence Project event | positionMs/beat/stepIndex present; no timestamp | planned |
| PB-CH-010 | Arrangement section transition | scheduled/current positions, lateByMs, and cause present | planned |
| PB-EV-001 | Envelope pause/resume | transport-position sampling freezes and resumes decay | planned |
| PB-EV-002 | seek or stop | all Envelopes reset before destination trigger | planned |
| PB-EV-003 | Project value change | affected Envelope resets without retrigger | planned |
| PB-EV-004 | decay Envelope backward seek | old state does not leak after reset | planned |

## React, reduced motion, SSR, and cleanup

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| PB-RE-001 | hook mount with valid Project | Engine snapshot becomes hook state | planned |
| PB-RE-002 | invalid initial Project | engine null and projectError populated | planned |
| PB-RE-003 | invalid Project hot-swap | old Engine data survives; projectError populated | planned |
| PB-RE-004 | command rejects | transportError populated and Promise rethrows | planned |
| PB-RE-005 | unsolicited playback error | transportError populated | planned |
| PB-RE-006 | later command succeeds | only transportError clears | planned |
| PB-RE-007 | overlapping toggle calls | queued calls evaluate latest execution-time state | planned |
| PB-RE-008 | queued operations | isBusy remains true; pendingOperation is queue head | planned |
| PB-RE-009 | playing position updates | positionRef/onPosition update without component rerender per frame | planned |
| PB-RM-001 | system reduce enabled after mount | sample once then stop rAF | planned |
| PB-RM-002 | reduced mode ordinary steps | no frame or discrete updates | planned |
| PB-RM-003 | reduced mode seek/stop/Project update | one static sample per explicit change | planned |
| PB-RM-004 | reduction disabled | rAF resumes from current logical position | planned |
| PB-SSR-001 | import all public entries in Node | no browser-global access | planned |
| PB-SSR-002 | SSR render hooks/components | no module/render-phase browser access | planned |
| PB-LC-001 | React StrictMode remount | borrowed transport is not disposed | planned |
| PB-LC-002 | unmount during queued operation | no state update after unmount; caller transport survives | planned |
| PB-LC-003 | animation cleanup ordering | rAF/subscriptions detach before Engine reference release | planned |

## Player React

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| PB-UI-001 | stopped controls | Play enabled; Stop has stable dimensions/state | planned |
| PB-UI-002 | playing controls | Play becomes Pause; Stop remains separate | planned |
| PB-UI-003 | paused controls | Resume and Stop are available | planned |
| PB-UI-004 | pending operation | loading/disabled state reflects isBusy | planned |
| PB-UI-005 | stop | UI and playhead return to position 0 | planned |
| PB-UI-006 | seekPositionMs scrub | long media seeks without limiting to one pattern | planned |
| PB-UI-007 | transport error | visible recoverable error state; layout remains stable | planned |
