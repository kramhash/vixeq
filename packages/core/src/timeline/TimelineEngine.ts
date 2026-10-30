import { browserClock } from "../clock";
import {
  createClockTransport,
  PlaybackError,
  type ListenerErrorContext,
  type PlaybackSnapshot,
  type PlaybackState,
  type PlaybackTransport,
  type PlaybackTransportEvent,
} from "../playbackTransport";
import type {
  ChannelPosition,
  EnginePlaybackEvent,
  EnginePlaybackSnapshot,
  MissedStepPolicy,
  Unsubscribe,
} from "../types";
import { createTimelineEventIndex, type TimelineEventIndex } from "./eventIndex";
import { beatToMs, msToBeat } from "./timing";
import { validateTimelineProject } from "./project";
import type {
  TimelineCueEvent,
  TimelineEngineOptions,
  TimelineEvent,
  TimelineEventHandler,
  TimelineEventMap,
  TimelineEventName,
  TimelinePlaybackEvent,
  TimelineProject,
  TimelineProjectEvent,
} from "./types";

type ProjectPositionAnchor = {
  transportPositionMs: number;
  projectPositionMs: number;
};

// A pause that took a playing Engine to local end, as dispatch stood before
// its listeners ran (see finishLocalEndPause).
type LocalEndPause = {
  generation: number;
  endedExits: number;
};

// A cue due in a dispatch batch, at its loop-monotonic transport-relative position.
type DueCue<TEvent extends TimelineEvent> = {
  event: TEvent;
  iteration: number;
  scheduledPositionMs: number;
};

const POSITION_EPSILON_MS = 1e-9;
const BEAT_EPSILON = 1e-9;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const assertFiniteNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
};

const assertValidTimelineProject = <TEvent extends TimelineEvent>(
  project: TimelineProject<TEvent>,
  options: TimelineEngineOptions<TEvent>,
): void => {
  const result = validateTimelineProject(
    project,
    options.eventValidator ? (event) => options.eventValidator?.(event as TEvent) : undefined,
  );
  if (!result.ok) {
    // validateTimelineProject reports at least one issue whenever ok is false.
    throw new TypeError(`Invalid TimelineProject: ${result.errors[0].path} ${result.errors[0].message}`);
  }
};

const reportListenerError = (
  error: unknown,
  eventName: string,
  onListenerError?: (error: unknown, context: ListenerErrorContext) => void,
): void => {
  if (onListenerError) {
    try {
      onListenerError(error, { source: "engine", eventName });
      return;
    } catch (reportingError) {
      error = reportingError;
    }
  }

  const reportError = (globalThis as typeof globalThis & {
    reportError?: (error: unknown) => void;
  }).reportError;
  if (reportError) {
    reportError.call(globalThis, error);
  } else if (typeof console !== "undefined") {
    console.error(error);
  }
};

/**
 * Tempo-mapped sparse cue scheduler for TimelineProject v2.
 */
export class TimelineEngine<TEvent extends TimelineEvent = TimelineEvent> {
  private project: TimelineProject<TEvent>;
  private eventIndex: TimelineEventIndex<TEvent>;
  private readonly transport: PlaybackTransport;
  private readonly ownsTransport: boolean;
  private readonly lookaheadMs: number;
  private readonly missedCuePolicy: MissedStepPolicy;
  private readonly options: TimelineEngineOptions<TEvent>;
  private readonly onListenerError?: TimelineEngineOptions<TEvent>["onListenerError"];
  private readonly listeners: {
    [TEventName in TimelineEventName]: Set<TimelineEventHandler<TEventName, TEvent>>;
  };
  private readonly unsubscribeTransport: Unsubscribe;
  private disposed = false;
  private transportDisposed = false;
  // Last transport-relative position reported before the transport was
  // disposed. Kept separate from cachedPositionMs, which is project-relative
  // once setProject() has anchored a hot-swap.
  private disposedTransportPositionMs = 0;
  private transportTimerId: ReturnType<typeof setTimeout> | undefined;
  private playbackState: PlaybackState = "stopped";
  private buffering = false;
  private localLoop: boolean;
  private cachedPositionMs = 0;
  private projectAnchor: ProjectPositionAnchor | null = null;
  private lastDispatchedRawPositionMs: number | null = null;
  private endedReplaySeekMode: "seek-as-play" | "suppress-seek" | null = null;
  private pendingEndedReplayPlay = false;
  private readonly pendingCommandEvents: PlaybackTransportEvent["type"][] = [];
  // Bumped by every command or transport event that re-anchors or ends cue
  // dispatch (seek, stop, ended, play from stopped/ended, setProject, setLoop,
  // transport or Engine disposal). Pause does not bump: it leaves the cursor
  // in place. A dispatch batch compares it after
  // each cue listener and abandons the rest of the batch when it changed: the
  // re-entrant call has already re-anchored the cursor and rescheduled.
  private dispatchGeneration = 0;
  // Set while a dispatch batch runs (see runDispatch). A cue listener whose
  // pause takes the Engine to local end records that pause and leaves the
  // local-end dispatch and announcement to the batch, because a nested batch
  // would re-dispatch the cues already sent (the cursor moves at batch end).
  private activeDispatch: { pause: LocalEndPause | null } | null = null;
  // Incremented whenever the Engine leaves `ended`. A listener that moves the
  // Engine out of `ended` after a pause took it to local end has taken over
  // (even if a later command re-enters `ended` and announces it), so that pause
  // no longer owes the `ended` announcement.
  private endedExits = 0;

  /**
   * @param project - The project to play. Validated eagerly, with
   *   `options.eventValidator` when given.
   * @param options - Transport, loop, scheduling, validation, and listener options.
   * @throws TypeError if `project` is invalid or an option has the wrong type.
   * @throws RangeError if `lookaheadMs` is negative or not finite.
   */
  constructor(project: TimelineProject<TEvent>, options: TimelineEngineOptions<TEvent> = {}) {
    if (!isRecord(options)) {
      throw new TypeError("TimelineEngine options must be an object.");
    }
    if (options.lookaheadMs !== undefined) {
      assertFiniteNonNegative(options.lookaheadMs, "lookaheadMs");
    }
    if (options.loop !== undefined && typeof options.loop !== "boolean") {
      throw new TypeError("loop must be a boolean.");
    }
    if (
      options.missedCuePolicy !== undefined &&
      options.missedCuePolicy !== "emit" &&
      options.missedCuePolicy !== "skip"
    ) {
      throw new TypeError('missedCuePolicy must be "emit" or "skip".');
    }

    assertValidTimelineProject(project, options);
    this.project = project;
    this.eventIndex = createTimelineEventIndex(project);
    this.transport = options.transport ?? createClockTransport(browserClock);
    this.ownsTransport = options.transport === undefined;
    this.lookaheadMs = options.lookaheadMs ?? 25;
    this.localLoop = options.loop ?? false;
    this.missedCuePolicy = options.missedCuePolicy ?? "emit";
    this.options = options;
    this.onListenerError = options.onListenerError;
    this.listeners = {
      cue: new Set(),
      playback: new Set(),
      project: new Set(),
    };

    if (options.onCue) {
      this.on("cue", options.onCue);
    }

    const snapshot = this.transport.getSnapshot();
    this.applyTransportSnapshot(snapshot);
    this.lastDispatchedRawPositionMs = snapshot.state === "stopped" ? null : this.rawPositionFromTransportPosition(snapshot.positionMs);

    this.unsubscribeTransport = this.transport.subscribe((event) => this.handleTransportEvent(event));
    this.rescheduleIfPlaying();
  }

  /**
   * Subscribe to an engine event: `"cue"`, `"playback"`, or `"project"`.
   *
   * @param eventName - The event to listen for.
   * @param handler - Called with that event's payload.
   * @returns A function that removes the listener.
   */
  on<TEventName extends TimelineEventName>(
    eventName: TEventName,
    handler: TimelineEventHandler<TEventName, TEvent>,
  ): Unsubscribe {
    this.assertLive();
    this.listeners[eventName].add(handler);

    return () => {
      this.listeners[eventName].delete(handler);
    };
  }

  /**
   * Start or resume playback. From `stopped` or `ended` it starts at beat 0 and
   * dispatches the cues there.
   *
   * @returns A promise that resolves once the transport has started.
   * @throws {@link PlaybackError} (`TRANSPORT_DISPOSED`) if the transport or the
   *   engine has been disposed.
   */
  play(): Promise<void> {
    this.assertLive();
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));

    if (this.playbackState === "ended") {
      const mode = this.transport.getPlaybackState() === "playing" ? "seek-as-play" : "suppress-seek";
      this.endedReplaySeekMode = mode;
      const command = mode === "seek-as-play"
        ? this.runTransportCommands(["seek"], () => this.transport.seekPositionMs(0))
        : this.runTransportCommands(["seek", "play"], async () => {
          await this.transport.seekPositionMs(0);
          await this.transport.play();
        });
      return command.catch((error) => {
        if (this.endedReplaySeekMode === mode) {
          this.endedReplaySeekMode = null;
        }
        this.pendingEndedReplayPlay = false;
        throw error;
      });
    }

    return this.runTransportCommands(["play"], () => this.transport.play());
  }

  /**
   * Pause playback, keeping the position.
   *
   * @returns A promise that resolves once the transport has paused.
   * @throws {@link PlaybackError} (`TRANSPORT_DISPOSED`) if the transport or the
   *   engine has been disposed.
   */
  pause(): Promise<void> {
    this.assertLive();
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommands(["pause"], () => this.transport.pause());
  }

  /**
   * Stop playback and return to position 0.
   *
   * @returns A promise that resolves once the transport has stopped.
   * @throws {@link PlaybackError} (`TRANSPORT_DISPOSED`) if the transport or the
   *   engine has been disposed.
   */
  stop(): Promise<void> {
    this.assertLive();
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommands(["stop"], () => this.transport.stop());
  }

  /**
   * Seek to a beat of the timeline, mapped through its timing map. A seek
   * dispatches no cues; a beat before transport position 0 (with a negative
   * `startPositionMs`) seeks to 0.
   *
   * @param beat - From 0 to `durationBeats`.
   * @returns A promise that resolves once the seek completes.
   * @throws RangeError if `beat` is outside that range or not finite.
   */
  seekBeat(beat: number): Promise<void> {
    this.assertLive();
    if (!Number.isFinite(beat) || beat < 0 || beat > this.project.durationBeats) {
      throw new RangeError(`beat must be a finite number from 0 to ${this.project.durationBeats}.`);
    }
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    // A beat before transport position 0 (negative startPositionMs) seeks to 0.
    const positionMs = Math.max(0, beatToMs(this.project.timing, beat));
    return this.runTransportCommands(["seek"], () => this.transport.seekPositionMs(positionMs));
  }

  /**
   * Seek the transport to a transport-relative position. The transport checks
   * the upper bound, so a position past the local end behaves as a direct
   * transport seek there.
   *
   * @param positionMs - Finite and non-negative.
   * @returns A promise that resolves once the seek completes.
   * @throws RangeError if `positionMs` is negative or not finite.
   */
  seekPositionMs(positionMs: number): Promise<void> {
    this.assertLive();
    assertFiniteNonNegative(positionMs, "positionMs");
    // The transport owns the upper bound (a position past local end is valid
    // on a longer transport), exactly as when it is sought directly.
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommands(["seek"], () => this.transport.seekPositionMs(positionMs));
  }

  /**
   * Turn the engine's own loop on or off: when on, playback repeats from beat 0
   * at `durationBeats`, independently of the transport's loop. A change emits a
   * `loopchange` playback event; setting the current value does nothing.
   *
   * @param loop - Whether to loop.
   * @throws TypeError if `loop` is not a boolean.
   */
  setLoop(loop: boolean): void {
    this.assertLive();
    if (typeof loop !== "boolean") {
      throw new TypeError("loop must be a boolean.");
    }
    if (loop === this.localLoop) {
      return;
    }

    const previousState = this.playbackState;
    this.dispatchGeneration += 1;
    this.localLoop = loop;
    this.applyTransportSnapshot(this.readTransportSnapshot());
    this.lastDispatchedRawPositionMs = this.rawPositionFromTransportPosition(this.getTransportPositionMs());
    this.emitPlayback("loopchange", "command", previousState);

    if (!loop && previousState === "playing" && this.playbackState === "ended") {
      this.clearTimer();
      this.emitPlayback("ended", "local-end", previousState);
      return;
    }

    this.rescheduleIfPlaying();
  }

  /**
   * Returns the project's length in beats (`durationBeats`): local end, where
   * playback ends unless local loop is on. Follows `setProject`.
   */
  getDurationBeats(): number {
    this.assertLive();
    return this.project.durationBeats;
  }

  /**
   * Returns the project's length in ms: the transport position of local end
   * (`beatToMs(timing, durationBeats)`). This is the project's length, not the
   * media length that `transport.getDurationMs()` reports. Follows
   * `setProject`.
   */
  getDurationMs(): number {
    this.assertLive();
    return this.durationMsOf();
  }

  /** Returns the loaded project. */
  getProject(): TimelineProject<TEvent> {
    this.assertLive();
    return this.project;
  }

  /**
   * Replace the project while keeping the current fractional beat, without
   * seeking the transport. Emits `"project"`. Events added at or before the
   * current beat are not dispatched retroactively. Does nothing if `project` is
   * the loaded object.
   *
   * @param project - The new project. Validated eagerly.
   * @throws TypeError if `project` is invalid; the engine keeps the old one.
   */
  setProject(project: TimelineProject<TEvent>): void {
    this.assertLive();
    assertValidTimelineProject(project, this.options);

    const previousProject = this.project;
    if (previousProject === project) {
      return;
    }

    const previousBeat = this.getPosition().beat;
    const previousState = this.playbackState;
    const transportPositionMs = this.getTransportPositionMs();
    const nextBeat = this.normalizeBeatForProject(previousBeat, project);
    const nextPositionMs = Math.max(0, beatToMs(project.timing, nextBeat));

    this.dispatchGeneration += 1;
    this.project = project;
    this.eventIndex = createTimelineEventIndex(project);
    this.projectAnchor = {
      transportPositionMs,
      projectPositionMs: nextPositionMs,
    };
    this.cachedPositionMs = this.normalizePosition(nextPositionMs);
    this.applyTransportSnapshot(this.readTransportSnapshot());
    this.lastDispatchedRawPositionMs = this.rawPositionFromTransportPosition(transportPositionMs);

    const event: TimelineProjectEvent<TEvent> = {
      project,
      previousProject,
      positionMs: this.cachedPositionMs,
      beat: this.getPosition().beat,
    };
    this.emit("project", event);

    if (previousState !== "ended" && this.playbackState === "ended") {
      this.clearTimer();
      this.emitPlayback("ended", "local-end", previousState);
      return;
    }

    this.rescheduleIfPlaying();
  }

  /** Returns the engine's playback state. */
  getPlaybackState(): PlaybackState {
    this.assertLive();
    return this.playbackState;
  }

  /**
   * Returns the engine's logical position, frozen while paused, stopped,
   * buffering, or ended.
   */
  getPosition(): ChannelPosition {
    this.assertLive();
    const positionMs = this.getLogicalPositionMs();
    return {
      positionMs,
      beat: msToBeat(this.project.timing, positionMs),
    };
  }

  /**
   * Tear down the engine: clears timers and listeners and unsubscribes from the
   * transport. A transport the engine created is disposed too; one you supplied
   * is left as it is. Calling it again does nothing; afterwards, other methods
   * throw.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.dispatchGeneration += 1;
    this.clearTimer();
    this.unsubscribeTransport();
    this.listeners.cue.clear();
    this.listeners.playback.clear();
    this.listeners.project.clear();
    if (this.ownsTransport) {
      this.transport.dispose();
    }
  }

  private runTransportCommands(
    expectedEventTypes: PlaybackTransportEvent["type"][],
    command: () => Promise<void>,
  ): Promise<void> {
    const markerIndexes = expectedEventTypes.map((eventType) => {
      this.pendingCommandEvents.push(eventType);
      return this.pendingCommandEvents.length - 1;
    });

    const clearPendingCommands = (): void => {
      expectedEventTypes.forEach((eventType, index) => {
        const markerIndex = markerIndexes[index];
        if (this.pendingCommandEvents[markerIndex] === eventType) {
          this.pendingCommandEvents.splice(markerIndex, 1);
          return;
        }

        const staleIndex = this.pendingCommandEvents.indexOf(eventType);
        if (staleIndex >= 0) {
          this.pendingCommandEvents.splice(staleIndex, 1);
        }
      });
    };

    try {
      return command().finally(clearPendingCommands);
    } catch (error) {
      clearPendingCommands();
      throw error;
    }
  }

  private handleTransportEvent(event: PlaybackTransportEvent): void {
    if (this.disposed) {
      return;
    }

    if (event.type === "dispose") {
      this.handleTransportDispose(event.snapshot);
      return;
    }

    const previousState = this.playbackState;
    const cause = this.consumeCommandCause(event.type) ? "command" : "transport";

    if (event.type === "seek" || event.type === "stop" || (event.type === "play" && previousState === "ended")) {
      this.projectAnchor = null;
    }

    this.applyTransportSnapshot(event.snapshot);

    if (event.type === "play") {
      const isEndedReplayPlay = this.pendingEndedReplayPlay;
      if (isEndedReplayPlay) {
        this.pendingEndedReplayPlay = false;
      }
      if (this.playbackState === "ended") {
        this.dispatchGeneration += 1;
        this.clearTimer();
        this.emitPlayback("ended", "local-end", previousState);
        return;
      }

      const playbackPreviousState = isEndedReplayPlay ? "ended" : previousState;
      this.emitPlayback(event.type, cause, playbackPreviousState);
      if (previousState === "stopped" || previousState === "ended" || isEndedReplayPlay) {
        this.dispatchGeneration += 1;
        this.lastDispatchedRawPositionMs = null;
        this.runDispatch(() => this.emitCurrentCues());
      }
      this.rescheduleIfPlaying();
      return;
    }

    if (event.type === "pause") {
      // Pause neither moves the dispatch cursor nor bumps dispatchGeneration:
      // cues passed before a late pause go out on the first tick after resume,
      // and a batch that a cue listener pauses runs to completion.
      this.clearTimer();
      const reachedLocalEnd = previousState === "playing" && this.playbackState === "ended";
      // Captured before the pause listeners run: one that re-entrantly replays,
      // seeks, or hot-swaps has already re-anchored dispatch.
      const pause: LocalEndPause = { generation: this.dispatchGeneration, endedExits: this.endedExits };
      this.emitPlayback(event.type, cause, previousState);
      if (!reachedLocalEnd) {
        return;
      }
      if (this.activeDispatch) {
        this.activeDispatch.pause = pause;
        return;
      }
      this.finishLocalEndPause(pause);
      return;
    }

    if (event.type === "stop") {
      this.dispatchGeneration += 1;
      this.clearTimer();
      this.cachedPositionMs = 0;
      this.lastDispatchedRawPositionMs = null;
      this.emitPlayback(event.type, cause, previousState);
      return;
    }

    if (event.type === "seek") {
      this.dispatchGeneration += 1;
      this.clearTimer();
      this.lastDispatchedRawPositionMs = null;
      if (previousState === "ended" && this.endedReplaySeekMode === "suppress-seek") {
        this.endedReplaySeekMode = null;
        this.pendingEndedReplayPlay = true;
        return;
      }
      if (previousState === "ended" && this.endedReplaySeekMode === "seek-as-play") {
        this.endedReplaySeekMode = null;
        this.emitPlayback("play", cause, previousState);
        this.runDispatch(() => this.emitCurrentCues());
        this.rescheduleIfPlaying();
        return;
      }

      this.lastDispatchedRawPositionMs = this.rawPositionFromTransportPosition(event.snapshot.positionMs);
      this.emitPlayback(event.type, cause, previousState);
      this.rescheduleIfPlaying();
      return;
    }

    if (event.type === "ratechange") {
      this.emitPlayback(event.type, cause, previousState);
      this.rescheduleIfPlaying();
      return;
    }

    if (event.type === "bufferingchange") {
      if (event.snapshot.buffering) {
        this.clearTimer();
      }
      this.emitPlayback(event.type, cause, previousState);
      this.rescheduleIfPlaying();
      return;
    }

    if (event.type === "ended") {
      this.dispatchGeneration += 1;
      this.clearTimer();
      this.emitPlayback(event.type, cause, previousState);
      return;
    }

    if (event.type === "error") {
      this.emitPlayback(event.type, "transport", previousState, event.error);
      return;
    }

    this.emitPlayback(event.type, cause, previousState);
    this.rescheduleIfPlaying();
  }

  private handleTransportDispose(snapshot: PlaybackSnapshot): void {
    const previousState = this.playbackState;
    this.cachedPositionMs = this.normalizePosition(this.rawPositionFromTransportPosition(snapshot.positionMs));
    this.disposedTransportPositionMs = snapshot.positionMs;
    this.transportDisposed = true;
    this.dispatchGeneration += 1;
    this.clearTimer();
    if (this.playbackState === "playing") {
      this.playbackState = "paused";
    }
    this.buffering = snapshot.buffering;
    this.emitPlayback(
      "error",
      "transport",
      previousState,
      new PlaybackError("TRANSPORT_DISPOSED"),
    );
  }

  private consumeCommandCause(eventType: PlaybackTransportEvent["type"]): boolean {
    const index = this.pendingCommandEvents.indexOf(eventType);
    if (index < 0) {
      return false;
    }
    this.pendingCommandEvents.splice(index, 1);
    return true;
  }

  private applyTransportSnapshot(snapshot: PlaybackSnapshot): void {
    const wasEnded = this.playbackState === "ended";
    this.applySnapshotState(snapshot);
    if (wasEnded && this.playbackState !== "ended") {
      this.endedExits += 1;
    }
  }

  private applySnapshotState(snapshot: PlaybackSnapshot): void {
    this.buffering = snapshot.buffering;

    if (snapshot.state === "stopped") {
      this.playbackState = "stopped";
      this.cachedPositionMs = 0;
      return;
    }

    const rawPositionMs = this.rawPositionFromTransportPosition(snapshot.positionMs);
    this.cachedPositionMs = this.normalizePosition(rawPositionMs);

    if (snapshot.state === "ended") {
      this.playbackState = "ended";
      this.cachedPositionMs = this.durationMsOf();
      return;
    }

    if (this.isAtOrPastLocalEnd(rawPositionMs)) {
      this.playbackState = "ended";
      this.cachedPositionMs = this.durationMsOf();
      return;
    }

    this.playbackState = snapshot.state;
  }

  private scheduleNextTick(): void {
    if (this.playbackState !== "playing" || this.buffering || this.transportDisposed) {
      return;
    }

    this.clearTimer();
    this.transportTimerId = setTimeout(() => this.tick(), this.lookaheadMs);
  }

  private rescheduleIfPlaying(): void {
    if (this.playbackState === "playing" && !this.buffering && !this.transportDisposed) {
      this.scheduleNextTick();
    }
  }

  private tick(): void {
    this.transportTimerId = undefined;
    if (this.disposed || this.playbackState !== "playing" || this.buffering || this.transportDisposed) {
      return;
    }

    const previousState = this.playbackState;
    const rawPositionMs = this.rawPositionFromTransportPosition(this.getTransportPositionMs());

    if (this.isAtOrPastLocalEnd(rawPositionMs)) {
      // A cue listener that re-entrantly seeks, stops, hot-swaps, toggles loop,
      // or disposes has already re-anchored playback (and announced any local
      // end itself); one that pauses has had local end finished by runDispatch.
      if (!this.runDispatch(() => this.emitDueCues(this.durationMsOf()))) {
        return;
      }
      this.cachedPositionMs = this.durationMsOf();
      this.lastDispatchedRawPositionMs = this.durationMsOf();
      this.playbackState = "ended";
      this.emitPlayback("ended", "local-end", previousState);
      return;
    }

    this.cachedPositionMs = this.normalizePosition(rawPositionMs);
    this.runDispatch(() => this.emitDueCues(rawPositionMs));
    this.scheduleNextTick();
  }

  /**
   * Runs one dispatch batch. When a cue listener's pause takes the Engine to
   * local end during it, the batch runs to completion first, then local end is
   * finished. Returns `false` when the batch was abandoned or ended that way.
   */
  private runDispatch(dispatch: () => boolean): boolean {
    const outerDispatch = this.activeDispatch;
    const batch: { pause: LocalEndPause | null } = { pause: null };
    this.activeDispatch = batch;
    const completed = dispatch();
    this.activeDispatch = outerDispatch;
    if (batch.pause === null) {
      return completed;
    }
    this.finishLocalEndPause(batch.pause);
    return false;
  }

  /**
   * Finishes a pause that took a playing Engine to local end, like the
   * local-end tick: the cues due up to local end, then `ended`. The dispatch is
   * skipped when a listener re-anchored it after the pause; unchanged since the
   * pause, the cursor is either where the batch left it or where a command
   * before the pause re-anchored it. The Engine is already `ended`, so a
   * re-entrant hot-swap does not announce it; announce unless a listener
   * disposed the Engine or moved it out of `ended` since the pause (a command
   * that later re-enters `ended`, such as a replay or a shorter hot-swap,
   * announces its own).
   */
  private finishLocalEndPause(pause: LocalEndPause): void {
    if (this.dispatchGeneration === pause.generation) {
      this.emitDueCues(this.durationMsOf());
    }
    if (this.disposed || this.playbackState !== "ended" || this.endedExits !== pause.endedExits) {
      return;
    }
    this.emitPlayback("ended", "local-end", "playing");
  }

  /** Returns `false` when a cue listener re-entrantly reset dispatch (see dispatchGeneration). */
  private emitCurrentCues(): boolean {
    const generation = this.dispatchGeneration;
    const rawPositionMs = this.rawPositionFromTransportPosition(this.getTransportPositionMs());
    const durationMs = this.durationMsOf();
    const iteration = this.localLoop && durationMs > 0 ? Math.floor(rawPositionMs / durationMs) : 0;
    const localPositionMs = this.normalizePosition(rawPositionMs);
    const beat = msToBeat(this.project.timing, localPositionMs);
    // The ms filter decides; the beat tolerance only absorbs an ms -> beat
    // round trip that lands an ulp off the event's beat.
    const events = this.eventIndex.getEventsAtBeat(beat, BEAT_EPSILON).filter((event) => {
      const scheduledPositionMs = beatToMs(this.project.timing, event.beat);
      return Math.abs(scheduledPositionMs - localPositionMs) <= POSITION_EPSILON_MS;
    });

    for (const event of events) {
      this.emitCue(event, iteration, iteration * durationMs + beatToMs(this.project.timing, event.beat), rawPositionMs);
      if (this.dispatchGeneration !== generation) {
        return false;
      }
    }

    this.lastDispatchedRawPositionMs = rawPositionMs;
    return true;
  }

  /** Returns `false` when a cue listener re-entrantly reset dispatch (see dispatchGeneration). */
  private emitDueCues(toRawPositionMs: number): boolean {
    const fromRawPositionMs = this.lastDispatchedRawPositionMs;
    if (fromRawPositionMs === null) {
      return this.emitCurrentCues();
    }

    if (toRawPositionMs <= fromRawPositionMs) {
      this.lastDispatchedRawPositionMs = toRawPositionMs;
      return true;
    }

    const durationMs = this.durationMsOf();
    const dueCues: DueCue<TEvent>[] = [];
    if (!this.localLoop) {
      this.collectDueCues(dueCues, 0, fromRawPositionMs, Math.min(toRawPositionMs, durationMs));
    } else {
      const startIteration = Math.floor(fromRawPositionMs / durationMs);
      const endIteration = Math.floor(toRawPositionMs / durationMs);
      const collectIteration = (iteration: number): void => {
        const iterationStartRaw = iteration * durationMs;
        const fromLocalPositionMs = iteration === startIteration
          ? fromRawPositionMs - iterationStartRaw
          : -POSITION_EPSILON_MS;
        const toLocalPositionMs = iteration === endIteration
          ? toRawPositionMs - iterationStartRaw
          : durationMs;
        this.collectDueCues(dueCues, iteration, fromLocalPositionMs, toLocalPositionMs);
      };

      if (this.missedCuePolicy === "skip") {
        // Only the last due cue survives "skip", so walk back from the landing
        // iteration and stop at the first one that has a due cue.
        for (let iteration = endIteration; iteration >= startIteration && dueCues.length === 0; iteration -= 1) {
          collectIteration(iteration);
        }
      } else {
        for (let iteration = startIteration; iteration <= endIteration; iteration += 1) {
          collectIteration(iteration);
        }
      }
    }

    // "skip" applies to the whole batch, across every loop iteration it
    // crosses: it discards every earlier missed cue unconditionally and keeps
    // only the most-advanced due cue (highest iteration, then highest beat),
    // mirroring ArrangementEngine's missedStepPolicy "skip"
    // (resolve-and-emit-only-the-current-position). There is no separate
    // lateness threshold here; lookaheadMs governs only the poll interval (see
    // tick()'s setTimeout), not this policy.
    const toDispatch = this.missedCuePolicy === "skip" ? dueCues.slice(-1) : dueCues;
    if (!this.dispatchDueCues(toDispatch, toRawPositionMs)) {
      return false;
    }

    this.lastDispatchedRawPositionMs = toRawPositionMs;
    return true;
  }

  /**
   * Appends the cues of one loop iteration that are due after
   * fromLocalPositionMs (exclusive; a negative value includes beat 0) up to
   * toLocalPositionMs (inclusive), in beat order.
   */
  private collectDueCues(
    dueCues: DueCue<TEvent>[],
    iteration: number,
    fromLocalPositionMs: number,
    toLocalPositionMs: number,
  ): void {
    const durationMs = this.durationMsOf();
    // Callers keep fromLocalPositionMs <= toLocalPositionMs within the
    // iteration, so this range is never inverted.
    const fromPositionMs = Math.max(0, fromLocalPositionMs);
    const toPositionMs = Math.min(durationMs, Math.max(0, toLocalPositionMs));

    // The beat range starts an ulp-absorbing BEAT_EPSILON early because an
    // ms -> beat round trip can land above an event exactly at
    // fromPositionMs (transport position 0 with a negative startPositionMs);
    // the ms checks below decide.
    const fromBeat = Math.max(0, msToBeat(this.project.timing, fromPositionMs) - BEAT_EPSILON);
    const toBeat = msToBeat(this.project.timing, toPositionMs);
    const events = this.eventIndex.getEventsInBeatRangeInclusiveEnd(fromBeat, toBeat);
    const exclusiveFromPositionMs = fromLocalPositionMs < 0 ? fromLocalPositionMs : fromLocalPositionMs + POSITION_EPSILON_MS;

    for (const event of events) {
      const scheduledLocalPositionMs = beatToMs(this.project.timing, event.beat);
      if (
        scheduledLocalPositionMs <= exclusiveFromPositionMs ||
        scheduledLocalPositionMs > toLocalPositionMs + POSITION_EPSILON_MS
      ) {
        continue;
      }

      dueCues.push({ event, iteration, scheduledPositionMs: iteration * durationMs + scheduledLocalPositionMs });
    }
  }

  /**
   * Dispatches a batch of due cues. Returns `false` when a cue listener
   * re-entrantly reset dispatch (seek, stop, hot-swap, loop toggle,
   * disposal): the rest of this catch-up is stale and must not be
   * dispatched (explicit seeks skip passed cues, and newly loaded events are
   * never emitted retroactively).
   */
  private dispatchDueCues(dueCues: DueCue<TEvent>[], transportPositionMs: number): boolean {
    const generation = this.dispatchGeneration;
    for (const { event, iteration, scheduledPositionMs } of dueCues) {
      this.emitCue(event, iteration, scheduledPositionMs, transportPositionMs);
      if (this.dispatchGeneration !== generation) {
        return false;
      }
    }

    return true;
  }

  private emitCue(
    event: TEvent,
    iteration: number,
    scheduledPositionMs: number,
    transportPositionMs: number,
  ): void {
    const cue: TimelineCueEvent<TEvent> = {
      event,
      iteration,
      scheduledPositionMs,
      transportPositionMs,
      lateByMs: Math.max(0, transportPositionMs - scheduledPositionMs),
    };
    this.emit("cue", cue);
  }

  private emitPlayback(
    type: EnginePlaybackEvent["type"],
    cause: EnginePlaybackEvent["cause"],
    previousState: PlaybackState,
    error?: unknown,
  ): void {
    const event: TimelinePlaybackEvent = {
      type,
      cause,
      previousState,
      snapshot: this.createPlaybackSnapshot(),
      ...(error !== undefined ? { error } : {}),
    };
    this.emit("playback", event);
  }

  private createPlaybackSnapshot(): EnginePlaybackSnapshot {
    const positionMs = this.getLogicalPositionMs();
    const transportSnapshot = this.transportDisposed ? null : this.transport.getSnapshot();
    return {
      state: this.playbackState,
      positionMs,
      beat: msToBeat(this.project.timing, positionMs),
      playbackRate: transportSnapshot?.playbackRate ?? 1,
      projectLoop: this.localLoop,
      transportLoop: transportSnapshot?.loop ?? false,
      buffering: this.buffering,
    };
  }

  private getLogicalPositionMs(): number {
    if (this.transportDisposed || this.buffering || this.playbackState === "ended") {
      return this.cachedPositionMs;
    }
    return this.normalizePosition(this.rawPositionFromTransportPosition(this.getTransportPositionMs()));
  }

  private getTransportPositionMs(): number {
    if (this.transportDisposed) {
      return this.disposedTransportPositionMs;
    }
    return this.transport.getPositionMs();
  }

  private readTransportSnapshot(): PlaybackSnapshot {
    if (this.transportDisposed) {
      return {
        state: this.playbackState,
        positionMs: this.disposedTransportPositionMs,
        durationMs: null,
        playbackRate: 1,
        loop: false,
        buffering: this.buffering,
      };
    }
    return this.transport.getSnapshot();
  }

  private rawPositionFromTransportPosition(transportPositionMs: number): number {
    if (!this.projectAnchor) {
      return transportPositionMs;
    }
    return Math.max(
      0,
      this.projectAnchor.projectPositionMs + (transportPositionMs - this.projectAnchor.transportPositionMs),
    );
  }

  private normalizePosition(positionMs: number): number {
    const durationMs = this.durationMsOf();
    if (this.localLoop && durationMs > 0) {
      return ((positionMs % durationMs) + durationMs) % durationMs;
    }
    return Math.max(0, Math.min(positionMs, durationMs));
  }

  private normalizeBeatForProject(beat: number, project: TimelineProject<TEvent>): number {
    if (this.localLoop && project.durationBeats > 0) {
      return ((beat % project.durationBeats) + project.durationBeats) % project.durationBeats;
    }
    return Math.max(0, Math.min(beat, project.durationBeats));
  }

  private isAtOrPastLocalEnd(positionMs: number): boolean {
    return !this.localLoop && positionMs >= this.durationMsOf();
  }

  private durationMsOf(project = this.project): number {
    return beatToMs(project.timing, project.durationBeats);
  }

  private emit<TEventName extends TimelineEventName>(
    eventName: TEventName,
    event: TimelineEventMap<TEvent>[TEventName],
  ): void {
    for (const handler of [...this.listeners[eventName]]) {
      try {
        handler(event as never);
      } catch (error) {
        reportListenerError(error, eventName, this.onListenerError);
      }
    }
  }

  private clearTimer(): void {
    if (this.transportTimerId !== undefined) {
      clearTimeout(this.transportTimerId);
      this.transportTimerId = undefined;
    }
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new PlaybackError("TRANSPORT_DISPOSED", "TimelineEngine has been disposed.");
    }
  }
}
