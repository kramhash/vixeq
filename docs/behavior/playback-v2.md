# Playback v2 Behavioral Contract

- Status: Approved for 0.7 implementation
- Target: `0.7.0-beta.1`
- Parent plan: [`../plans/v1-collaboration-spec.md`](../plans/v1-collaboration-spec.md)
- Test contract: [`playback-v2-matrix.md`](playback-v2-matrix.md)
- Migration: [`../migrations/0.7-playback-v2.md`](../migrations/0.7-playback-v2.md)

This document is normative for Playback v2. Public names, arguments, return
types, event payloads, errors, and state transitions are frozen for the 0.7
implementation. Private implementation structure is not prescribed.

## 1. Playback state and snapshot

```ts
export type PlaybackState = "stopped" | "playing" | "paused" | "ended";

export type PlaybackSnapshot = {
  state: PlaybackState;
  positionMs: number;
  durationMs: number | null;
  playbackRate: number;
  loop: boolean;
  buffering: boolean;
};
```

- `stopped` always has `positionMs === 0`.
- `playing` means playback is intended to advance. A buffering transport stays
  `playing` with `buffering: true` while its position is temporarily frozen.
- `paused` preserves a non-terminal position for later resume.
- `ended` preserves the finite end position. `play()` from `ended` first
  returns to position 0.
- `durationMs: null` means unknown or unbounded duration.
- Playback rate is finite and greater than zero. Reverse playback is not
  supported.
- Disposal is a lifecycle condition, not a playback state.

## 2. PlaybackTransport

```ts
export type PlaybackOperation =
  | "play"
  | "pause"
  | "stop"
  | "seek"
  | "ratechange"
  | "transport-loop";

export type PlaybackTransportEvent =
  | { type: "play"; snapshot: PlaybackSnapshot }
  | { type: "pause"; snapshot: PlaybackSnapshot }
  | { type: "stop"; snapshot: PlaybackSnapshot }
  | {
      type: "seek";
      previousPositionMs: number;
      snapshot: PlaybackSnapshot;
    }
  | {
      type: "ratechange";
      previousPlaybackRate: number;
      snapshot: PlaybackSnapshot;
    }
  | {
      type: "loopchange";
      previousLoop: boolean;
      snapshot: PlaybackSnapshot;
    }
  | { type: "loop"; iteration: number; snapshot: PlaybackSnapshot }
  | {
      type: "durationchange";
      previousDurationMs: number | null;
      snapshot: PlaybackSnapshot;
    }
  | {
      type: "bufferingchange";
      previousBuffering: boolean;
      snapshot: PlaybackSnapshot;
    }
  | { type: "ended"; snapshot: PlaybackSnapshot }
  | { type: "error"; error: unknown; snapshot: PlaybackSnapshot }
  | { type: "dispose"; snapshot: PlaybackSnapshot };

export type PlaybackTransport = {
  getSnapshot(): PlaybackSnapshot;
  getPlaybackState(): PlaybackState;
  getPositionMs(): number;
  getDurationMs(): number | null;
  getPlaybackRate(): number;
  getLoop(): boolean;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekMs(positionMs: number): Promise<void>;
  setPlaybackRate(rate: number): Promise<void>;
  setLoop(loop: boolean): Promise<void>;
  subscribe(listener: (event: PlaybackTransportEvent) => void): () => void;
  dispose(): void;
};
```

`getSnapshot()` is the canonical atomic read. Individual getters are
conveniences and must describe the same state when no intervening operation
occurs.

### 2.1 Factories

```ts
export type PlaybackClock = {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timerId: unknown): void;
};

createClockTransport(
  clock: PlaybackClock,
  options?: ClockTransportOptions,
): PlaybackTransport;
```

`SequencerClock` is renamed to `PlaybackClock`; no compatibility alias is
retained. `browserClock` implements `PlaybackClock`.

Keep or add:

- `createMediaElementTransport(media, options?)`
- `createAudioBufferTransport(audioContext, buffer, options?)`
- `createClockTransport(clock, options?)`
- low-level `browserClock`

Remove:

- `createAudioClock`
- `createAudioContextClock`
- `SequencerTransport`
- `stopAtMs`

`createClockTransport` accepts an optional finite positive `durationMs`. With
no duration it is unbounded and cannot enable transport looping.
Passing `{ loop: true }` without `durationMs` throws a synchronous
`PlaybackError` with code `"DURATION_UNAVAILABLE"` because no transport can be
constructed in that configuration. Calling `setLoop(true)` on an existing
unbounded transport reports the same code through Promise rejection.

```ts
export type PlaybackTransportBaseOptions = {
  onListenerError?: (error: unknown, context: ListenerErrorContext) => void;
};

export type ClockTransportOptions = PlaybackTransportBaseOptions & {
  durationMs?: number;
  loop?: boolean;
};

export type MediaElementTransportOptions = PlaybackTransportBaseOptions & {
  audioContext?: AudioContext;
};

export type AudioBufferTransportOptions = PlaybackTransportBaseOptions & {
  destination?: AudioNode;
  loop?: boolean;
};
```

Factory option `loop` is the initial transport-loop setting. Media-element
transport reads the media element's current `loop`, `playbackRate`, duration,
position, and paused/ended state when constructed.

### 2.2 Input validation and failures

Invalid public arguments throw synchronously before an operation is queued:

- `seekMs`: finite, non-negative, and not beyond known duration.
- `setPlaybackRate`: finite and greater than zero.
- `setLoop`: argument must be a boolean.

Valid operations return `Promise<void>`. Platform/media failures reject the
Promise with the original error. A command rejection does not also emit an
`error` event. The `error` event is reserved for unsolicited asynchronous
media failures after an operation has completed. `setLoop(true)` with unknown
or unbounded duration rejects with a `PlaybackError` whose code is
`"DURATION_UNAVAILABLE"`; it is not a synchronous argument error.

```ts
export type PlaybackErrorCode =
  | "TRANSPORT_DISPOSED"
  | "DURATION_UNAVAILABLE";

export class PlaybackError extends Error {
  readonly code: PlaybackErrorCode;
  constructor(code: PlaybackErrorCode, message?: string);
}
```

Use standard `TypeError` and `RangeError` for invalid arguments. Use
`PlaybackError` only for library-defined operational conditions.

### 2.3 Ordering and idempotence

- Operations execute in invocation order.
- A rejected operation does not poison the operation queue.
- A successful state-changing operation updates internal state, emits its
  event synchronously, then resolves its Promise.
- One successful command emits at most its one corresponding public event.
  Media-element DOM events caused by that command are suppressed: `stop()`
  exposes only `stop`, `seekMs()` only `seek`, `setPlaybackRate()` only
  `ratechange`, and `setLoop()` only `loopchange`. Events caused by external
  media-element manipulation remain observable as their normal matching
  public events.
- Repeating `play`, `pause`, `stop`, rate, or loop with no state change emits
  no event and resolves successfully.
- Explicit seek emits `seek` even when the target equals the current position.
- A listener exception is isolated from other listeners and from operation
  completion. Report via `onListenerError`, then `globalThis.reportError`,
  then `console.error`.

### 2.4 Sharing and ownership

- A transport supports multiple subscribers and Engines.
- Operations are global to the shared transport.
- A transport passed to an Engine is borrowed. Engine disposal only
  unsubscribes from it.
- A default transport created by an Engine is owned by that Engine.
- Attaching to an already-playing transport adopts its current snapshot and
  begins future scheduling without synthetic step/cue events.
- Transport loop and Engine Project loop are independent.

### 2.5 Transport disposal

- `dispose()` emits `dispose` with the final snapshot, then removes listeners
  and resources owned by the transport.
- Disposal is idempotent and terminal.
- All getters, operations, and subscriptions after disposal throw
  `PlaybackError` with `TRANSPORT_DISPOSED`.
- A borrowed media element or AudioContext is not itself destroyed.
- Attached Engines cache the final position, stop scheduling, expose sampling
  at that position, and forward an Engine playback `error`.
- A playing Engine becomes `paused`; an already stopped, paused, or ended
  Engine keeps its existing local state.
- Further playback operations on those Engines reject with
  `TRANSPORT_DISPOSED`; recreating the Engine is required.

## 3. Engine playback contract

```ts
export type ListenerErrorContext = {
  source: "transport" | "engine";
  eventName: string;
};

export type SequencerEngineOptions = {
  transport?: PlaybackTransport;
  lookaheadMs?: number;
  missedStepPolicy?: MissedStepPolicy;
  onStep?: (event: StepEvent) => void;
  onListenerError?: (error: unknown, context: ListenerErrorContext) => void;
};

export type ArrangementEngineOptions = {
  transport?: PlaybackTransport;
  lookaheadMs?: number;
  loop?: boolean;
  onStep?: (event: StepEvent) => void;
  onListenerError?: (error: unknown, context: ListenerErrorContext) => void;
};
```

Omitting `transport` creates an Engine-owned default browser transport.
`lookaheadMs` remains an advanced scheduling option and must be finite and
non-negative. `missedStepPolicy` remains `"emit" | "skip"`.

All Engines use:

```ts
play(): Promise<void>;
pause(): Promise<void>;
stop(): Promise<void>;
seekPositionMs(positionMs: number): Promise<void>;
```

Unit-specific APIs are:

```ts
SequencerEngine.seekStep(stepIndex: number): Promise<void>;
ArrangementEngine.seekBeat(beat: number): Promise<void>;
// Added in 0.8:
TimelineEngine.seekBeat(beat: number): Promise<void>;
```

- Remove `start()` and `reset()`.
- Remove `setBpm()`; callers update BPM through `setProject()`.
- Remove raw `clock`, `timeDriven`, and `originMs` Engine options.
- `SequencerEngine` is always time-driven and its pattern always loops.
- `ArrangementEngine` defaults to local Project loop off.
- `TimelineEngine` defaults to local Project loop off.
- Only Arrangement and Timeline expose synchronous local
  `setLoop(loop: boolean): void`.
- Seek arguments are validated synchronously. Transport failures reject.
- Sequence step index is an integer in `[0, stepCount)`.
- Arrangement/Timeline beat is in `[0, durationBeats]`.
- `seekPositionMs` uses transport-relative milliseconds and delegates range
  validation to the transport.

In 0.7, Arrangement exposes:

```ts
ArrangementEngine.setLoop(loop: boolean): void;
```

The argument must be boolean or the method throws `TypeError`. A real change
updates `projectLoop` and emits one Engine playback `loopchange` with
`cause: "command"`; setting the current value is a no-op. Timeline adopts the
same contract when introduced in 0.8. Sequencer has no local loop setter.

### 3.1 Engine playback event

```ts
export type EnginePlaybackCause =
  | "command"
  | "transport"
  | "local-end";

export type EnginePlaybackSnapshot = {
  state: PlaybackState;
  positionMs: number;
  beat: number;
  playbackRate: number;
  projectLoop: boolean;
  transportLoop: boolean;
  buffering: boolean;
};

export type EnginePlaybackEvent = {
  type:
    | "play"
    | "pause"
    | "stop"
    | "seek"
    | "ratechange"
    | "loopchange"
    | "loop"
    | "durationchange"
    | "bufferingchange"
    | "ended"
    | "error";
  cause: EnginePlaybackCause;
  previousState: PlaybackState;
  snapshot: EnginePlaybackSnapshot;
  error?: unknown;
};
```

Sequence snapshots additionally expose `stepIndex`. Arrangement/Timeline
snapshots additionally expose `iteration`. Engine events use the event name
`"playback"`; transport events are not exposed as Engine `"transport"`
events.

An Engine playback `error` is only an unsolicited notification forwarded from
an asynchronous transport failure or transport disposal. A failed explicit
command is reported only by that command's Promise rejection and never emits a
duplicate Engine playback `error`. This preserves the Core command-error rule
in the parent collaboration specification.

### 3.2 State transitions

| From | Operation/event | To | Position |
| --- | --- | --- | --- |
| stopped | play | playing | starts at 0 |
| stopped | pause | stopped | no-op at 0 |
| playing | pause | paused | frozen |
| playing | play | playing | no-op |
| paused | play | playing | resumes frozen position |
| any live state | stop | stopped | 0 |
| ended | play | playing | resets to 0 first |
| ended | pause | ended | no-op at end |
| ended | stop | stopped | 0 |
| playing | seek | playing | requested position |
| paused | seek | paused | requested position |
| stopped | seek to 0 | stopped | 0 |
| stopped | seek above 0 | paused | requested position |
| ended | seek below end | paused | requested position |
| ended | seek to end | ended | end position |
| playing | local finite end, no Project loop | ended | local end |
| any | transport ended | ended | transport end |
| playing | buffering starts | playing | frozen, `buffering: true` |
| playing | transport dispose | paused | cached final position |
| stopped/paused/ended | transport dispose | unchanged | cached final position |

State-preserving operations are no-ops except explicit seek.

### 3.3 Position, Project changes, and local end

- First play anchors logical position without exposing a clock epoch.
- Pause/replay re-anchors from the frozen logical position.
- BPM or `stepsPerBeat` hot-swap preserves fractional beat and does not seek
  external media.
- `setProject()` is the only Sequencer Project mutation entry point and emits
  one atomic Project event.
- A later external `seekMs` discards that temporary live-edit anchor and
  evaluates the current Project from transport position 0.
- A failed hot-swap preserves old Project, position, state, and dispatch
  cursor.
- If a finite Project is shortened below current position:
  - Project loop off: move to the new end and enter `ended`;
  - Project loop on: modulo into the new duration and continue.
- Reaching a local end never stops a borrowed/shared transport.
- A pause that lands at or past a local finite end while playing (no Project
  loop) enters `ended` and emits `pause`, then dispatches what is due up to
  the local end exactly as the local-end tick does, then emits `ended` with
  cause `local-end`. A listener that seeks, replays, stops, enables loop,
  hot-swaps to a longer Project, or disposes the Engine during the pause or
  that dispatch takes over, and `ended` is not emitted; a command that the
  transport applies only later (such as a replay on the built-in clock
  transport) follows `ended` instead. When a listener pauses during a
  dispatch, local end is finished after that dispatch returns, from the
  cursor as an earlier command in the same listener left it, and nothing is
  dispatched twice. A listener that takes over and then returns the Engine to
  `ended` gets only what that later command emits on its own: a replay that
  reaches local end again or a shorter hot-swap announces `ended` once, and
  disabling loop again from `paused` stays silent. Arrangement keeps an
  `ended` Engine at local end when loop is enabled, so there toggling loop
  without leaving `ended` does not take over: local end is still finished (the steps due before it,
  the terminal `section`, then `ended`).
- Known limitation: these re-entrancy guarantees are verified for the
  built-in transports, which apply commands asynchronously. With a
  third-party `PlaybackTransport` that applies `pause`, `seek`, `stop`, and
  `play` synchronously, a listener that issues several such commands in a row
  around local end may still see a duplicated or missing `ended`; steps and
  cues are not dispatched twice.

### 3.4 Disposal

- Engine `dispose()` is idempotent and terminal.
- It stops owned timers, removes listeners, and disposes only an internally
  owned default transport.
- Playback, seek, update, subscribe, and sample APIs throw after Engine
  disposal.
- Transport disposal is different: the Engine remains sampleable at its
  cached final position but cannot resume.
- `PlaybackErrorCode` has no dedicated code for "the Engine itself is
  disposed." APIs called after Engine disposal intentionally reuse
  `TRANSPORT_DISPOSED`, distinguished only by the error `message`; this does
  not imply the Engine's transport is also disposed.

## 4. Sampling and ChannelSource

```ts
export type ChannelPosition = {
  positionMs: number;
  beat: number;
};

export type ChannelProjectEvent = {
  changedChannelIds: string[];
  previousChannels: Record<string, number>;
  channels: Record<string, number>;
  positionMs: number;
  beat: number;
};

export type ChannelSource = {
  sampleChannels(easing?: EasingFunction): Record<string, number>;
  sampleChannelsAt(timeMs: number, easing?: EasingFunction): Record<string, number>;
  getPosition(): ChannelPosition;
  getPlaybackState(): PlaybackState;
  on(event: "step", listener: (event: StepEvent) => void): Unsubscribe;
  on(event: "playback", listener: (event: EnginePlaybackEvent) => void): Unsubscribe;
  on(event: "project", listener: (event: ChannelProjectEvent) => void): Unsubscribe;
};
```

- `sampleChannels()` uses the Engine's current logical transport position.
- It freezes while paused, stopped, buffering, locally ended, or detached by
  transport disposal.
- `sampleChannelsAt()` is pure evaluation at Project-relative elapsed
  milliseconds, never a clock-domain timestamp.
- Timeline is not a `ChannelSource`.
- The inclusion of pure `sampleChannelsAt()` and the `project` event in this
  generic surface is intentional. Animation consumers need preview sampling
  and selective Envelope reset without depending on a concrete Engine.
- Project hot-swap emits `project`. Ordinary value/metadata changes do not
  emit a synthetic step.
- `changedChannelIds` compares channel output at the preserved logical
  position. Metadata-only changes do not mark unchanged channels.

Concrete Engine Project events extend `ChannelProjectEvent` with their typed
`project` and `previousProject` values. The Sequence event also includes
`stepIndex`. No Project event contains a clock-domain `timestamp`.

## 5. Step event contract

```ts
export type StepEventCause = "play" | "tick" | "seek" | "project-change";

export type StepEvent = {
  stepIndex: number;
  bpm: number;
  scheduledPositionMs: number;
  transportPositionMs: number;
  lateByMs: number;
  durationMs: number;
  cause: StepEventCause;
  tracks: StepEventTrack[];
};
```

Remove `timestamp`.

- `stopped -> play`: emit step 0 with `cause: "play"`.
- `paused -> play`: do not re-emit the current step.
- `ended -> play`: reset and emit step 0.
- Natural progress uses `cause: "tick"` and `missedStepPolicy`.
- Explicit seek never replays crossed steps. Sequence/Arrangement emit only
  the destination step with `cause: "seek"`.
- Timeline seek emits no cue.
- Normal Project hot-swap emits only `project`.
- Forced position change caused by Project shortening emits one destination
  step with `cause: "project-change"`.

Arrangement section transitions use:

```ts
export type ArrangementSectionEvent = {
  section: ArrangementSection | null;
  beat: number;
  positionMs: number;
  transportPositionMs: number;
  lateByMs: number;
  cause: StepEventCause;
};
```

Section events follow the same seek, delayed-callback, and Project-change
position rules as Step events. They do not expose `timestamp`.

Arrangement delayed-callback dispatch:

- A tick dispatches every section change and step start after the previous
  tick's position, up to and including its own, across a local loop wrap,
  inter-section and trailing gaps, and local end. Items are emitted in
  timeline order; a section change precedes a step that starts at the same
  time, so the remaining steps of one section come before the next section
  (or `null` on entering a gap), then that section's steps.
- A section change is a boundary (beat `0`, a section's `startBeat`, or its
  `endBeat`) where the active section differs from the last one emitted. A
  single-section loop crosses its iteration boundary without a section event.
- `scheduledPositionMs` of a step and `positionMs` of a section event are
  measured from the start of the loop iteration the tick landed in. Items of
  that iteration keep their in-iteration values; items of earlier iterations
  are negative (step 3 of the previous iteration of a 4000 ms loop is
  `-1000`). `transportPositionMs` is the landing position (loop-normalized,
  or local end), and `lateByMs = transportPositionMs - scheduledPositionMs`
  (`- positionMs` for a section event), so an Envelope triggered at
  `scheduledPositionMs` and sampled at the Engine position sees the real
  lateness. A section event's `beat` is the boundary's beat within its own
  iteration and is never negative.
- Without Project loop, local end is exclusive: steps that start before it
  and crossed section changes are emitted, then the terminal `section`
  (`null`) and `ended` (§3.3).
- `missedStepPolicy: "skip"` resolves the landing position only: the section
  change into the landing section (if it changed, at the boundary where it
  began) and the landing step if it began after the previous tick. A landing
  position in a gap or at local end emits no step.
- A position that moves backwards without a seek (a shared transport that
  wraps on its own loop, or a media clock that jitters) emits the landing
  section and step with `cause: "tick"` only when they differ from the last
  ones emitted, and dispatch continues from there.
- Pause keeps the dispatch position: a step that began between the last tick
  and a pause is emitted as a late `"tick"` step on the first tick after
  resume. This is not a re-emission of the current step.
- Catch-up applies to natural delays only. A command never replays the steps
  it passes: besides seek and a shortening hot-swap, `setLoop(false)` while
  the position is already past local end enters `ended` and emits the
  terminal `section` and `ended` without the steps between the last tick and
  local end (Timeline does the same for cues).

## 6. Envelope and animation contract

```ts
export type Envelope = {
  trigger(positionMs: number, value?: number): void;
  sample(positionMs: number): number;
  reset(): void;
};
```

- Trigger Envelopes with `StepEvent.scheduledPositionMs`.
- Sample with current logical transport position.
- Pause/buffering freezes Envelope time.
- Stop and any seek reset all Envelopes before a possible destination trigger.
- Project changes reset only `changedChannelIds`; they do not retrigger.

`useAnimatedChannels` replaces `reducedMotion?: boolean` with:

```ts
motionPreference?: "system" | "reduce" | "no-preference";
```

Default is `"system"`. Under reduced motion:

- stop rAF and sample once;
- do not react to ordinary step ticks;
- sample once for explicit seek, stop, or Project change;
- resume rAF from current position when reduction is disabled.

## 7. React contract

`useSequencerEngine` and `useArrangement` return, where applicable:

```ts
{
  engine;
  playbackState;
  positionRef;
  latestEvent;
  projectError;
  transportError;
  pendingOperation;
  isBusy;
  play;
  pause;
  stop;
  toggle;
  seekPositionMs;
  seekStep; // Sequencer only
  seekBeat; // Arrangement only
  setPlaybackRate;
  setTransportLoop;
  setLoop; // Arrangement local Project loop only
}
```

```ts
type PendingPlaybackOperation =
  | "play"
  | "pause"
  | "stop"
  | "toggle"
  | "seekPositionMs"
  | "seekStep"
  | "seekBeat"
  | "setPlaybackRate"
  | "setTransportLoop"
  | "setLoop"
  | null;
```

- Remove `isStarting`; use `pendingOperation` and `isBusy`.
- Position updates use `positionRef` and optional `onPosition`, not per-frame
  React state.
- `toggle()` is queued and evaluates state when executed.
- `projectError` captures construction/hot-swap validation.
- `transportError` captures synchronous wrapper failures, command rejection,
  and unsolicited Engine playback `error`.
- A successful operation clears only its matching error category.
- Hooks rethrow command errors after updating state.

`SequencePlayer` and its ref expose Play/Resume, Pause, Stop, unit seek, and
`seekPositionMs`. They also expose playback-rate and transport-loop controls;
local Project loop is not configurable for Sequence. Remove Reset. The
built-in controls show a Play/Pause toggle and a separate Stop action.

## 8. SSR and cleanup

- Public module evaluation does not read `window`, `document`, media globals,
  or `performance`.
- Browser factories may read browser globals only when invoked.
- `motionPreference: "system"` reads `matchMedia` after mount.
- StrictMode mount/dispose/remount must not dispose a caller-owned transport.
- Hook cleanup detaches animation and Engine subscriptions before releasing
  the Engine reference.
