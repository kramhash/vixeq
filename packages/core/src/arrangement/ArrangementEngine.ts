import { browserClock } from "../clock";
import { linear, type EasingFunction } from "../easing";
import {
  createClockTransport,
  type ListenerErrorContext,
  PlaybackError,
  type PlaybackSnapshot,
  type PlaybackState,
  type PlaybackTransport,
  type PlaybackTransportEvent,
} from "../playbackTransport";
import { beatToMs, msToBeat } from "../timeline/timing";
import {
  arrangementDurationBeats,
  resolveArrangementStep,
  sampleArrangement,
  sectionAtBeat,
  unionTrackIds,
} from "./resolve";
import { validateArrangement } from "./project";
import type {
  ChannelPosition,
  EnginePlaybackEvent,
  EnginePlaybackSnapshot,
  MissedStepPolicy,
  StepEvent,
  StepEventCause,
  Unsubscribe,
} from "../types";
import type {
  ArrangementEventHandler,
  ArrangementEventMap,
  ArrangementEventName,
  ArrangementPlaybackEvent,
  ArrangementProject,
  ArrangementProjectEvent,
  ArrangementSection,
} from "./types";

type ProjectPositionAnchor = {
  transportPositionMs: number;
  projectPositionMs: number;
};

type ArrangementStepResolution = {
  section: ArrangementSection;
  stepIndex: number;
  nextStepIndex: number;
  phase: number;
  absoluteSectionStep: number;
  scheduledBeat: number;
  scheduledPositionMs: number;
};

// One section boundary or step start that a tick dispatches, at its raw
// (anchor-adjusted, un-normalized) position.
type DueItem =
  | {
    kind: "section";
    rawPositionMs: number;
    section: ArrangementSection | null;
    beat: number;
  }
  | {
    kind: "step";
    rawPositionMs: number;
    iteration: number;
    resolved: ArrangementStepResolution;
  };

// A pause that took a playing Engine to local end, as dispatch stood before
// its listeners ran (see finishLocalEndPause).
type LocalEndPause = {
  generation: number;
  endedExits: number;
};

export type ArrangementEngineOptions = {
  transport?: PlaybackTransport;
  /** Max ms between polls while playing. Default 25. */
  lookaheadMs?: number;
  /** Repeat from beat 0 at the arrangement end. Default false. */
  loop?: boolean;
  missedStepPolicy?: MissedStepPolicy;
  onStep?: ArrangementEventHandler<"step">;
  onSection?: ArrangementEventHandler<"section">;
  onListenerError?: (error: unknown, context: ListenerErrorContext) => void;
};

const POSITION_EPSILON_MS = 1e-9;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const assertFiniteNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
};

const assertValidArrangement = (arrangement: ArrangementProject): void => {
  const result = validateArrangement(arrangement);
  if (!result.ok) {
    // validateArrangement reports at least one issue whenever ok is false.
    throw new TypeError(`Invalid ArrangementProject: ${result.errors[0].path} ${result.errors[0].message}`);
  }
};

const reportListenerError = (
  error: unknown,
  eventName: string,
  onListenerError?: ArrangementEngineOptions["onListenerError"],
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
 * Plays an ArrangementProject with Playback v2 controls while keeping the v1
 * arrangement schema. The transport is the shared time source; arrangement end
 * and loop behavior are local Engine semantics.
 */
export class ArrangementEngine {
  private arrangement: ArrangementProject;
  private trackIds: string[];
  private readonly transport: PlaybackTransport;
  private readonly ownsTransport: boolean;
  private readonly lookaheadMs: number;
  private readonly missedStepPolicy: MissedStepPolicy;
  private readonly onListenerError?: ArrangementEngineOptions["onListenerError"];
  private readonly listeners: {
    [TEventName in ArrangementEventName]: Set<ArrangementEventHandler<TEventName>>;
  };
  private readonly unsubscribeTransport: Unsubscribe;
  private disposed = false;
  private transportDisposed = false;
  // Last transport-relative position reported before the transport was
  // disposed. Kept separate from cachedPositionMs, which is project-relative
  // once setArrangement() has anchored a hot-swap.
  private disposedTransportPositionMs = 0;
  private transportTimerId: ReturnType<typeof setTimeout> | undefined;
  private playbackState: PlaybackState = "stopped";
  private buffering = false;
  private localLoop: boolean;
  private cachedPositionMs = 0;
  private currentSection: ArrangementSection | null = null;
  private lastSectionId: string | null | undefined = undefined;
  // Identity (loop iteration, section, and absolute section step) of the last
  // emitted step. Only a position that moves backwards without a seek compares
  // it (see emitDueItems); forward dispatch is deduplicated by the cursor.
  private lastEmittedStepKey: string | null = null;
  // Exclusive dispatch cursor in the raw position domain
  // (positionFromTransportPosition()). It advances with every dispatched item,
  // so a batch abandoned by a re-entrant setLoop() resumes without duplicates.
  private lastDispatchedRawPositionMs = 0;
  private projectAnchor: ProjectPositionAnchor | null = null;
  private endedReplaySeekMode: "seek-as-play" | "suppress-seek" | null = null;
  private pendingEndedReplayPlay = false;
  private readonly pendingCommandEvents: PlaybackTransportEvent["type"][] = [];
  // Bumped by every command or transport event that re-anchors or ends step
  // dispatch (seek, stop, ended, play from stopped/ended, setArrangement,
  // setLoop unless it keeps the Engine at local end, transport or Engine
  // disposal). Pause does not bump: it leaves the
  // cursor in place. A tick compares it
  // after each listener and abandons the rest of its dispatch when it changed:
  // the re-entrant call has already re-anchored the cursor and rescheduled.
  private dispatchGeneration = 0;
  // Set while a dispatch batch runs (see runDispatch). A step or section
  // listener whose pause takes the Engine to local end records that pause and
  // leaves the batch to finish local end once it is complete.
  private activeDispatch: { pause: LocalEndPause | null } | null = null;
  // Counts every move out of `ended` (see applyTransportSnapshot). A move out
  // of `ended` after a pause took it to local end has taken over (even if a
  // later command re-enters `ended` and announces it), so that pause no longer
  // announces `ended`.
  private endedExits = 0;

  constructor(arrangement: ArrangementProject, options: ArrangementEngineOptions = {}) {
    if (!isRecord(options)) {
      throw new TypeError("ArrangementEngine options must be an object.");
    }
    if (options.lookaheadMs !== undefined) {
      assertFiniteNonNegative(options.lookaheadMs, "lookaheadMs");
    }
    if (options.loop !== undefined && typeof options.loop !== "boolean") {
      throw new TypeError("loop must be a boolean.");
    }

    assertValidArrangement(arrangement);
    this.arrangement = arrangement;
    this.trackIds = unionTrackIds(this.arrangement);
    this.transport = options.transport ?? createClockTransport(browserClock);
    this.ownsTransport = options.transport === undefined;
    this.lookaheadMs = options.lookaheadMs ?? 25;
    this.localLoop = options.loop ?? false;
    this.missedStepPolicy = options.missedStepPolicy ?? "emit";
    this.onListenerError = options.onListenerError;
    this.listeners = {
      step: new Set(),
      playback: new Set(),
      project: new Set(),
      section: new Set(),
    };

    if (options.onStep) {
      this.on("step", options.onStep);
    }
    if (options.onSection) {
      this.on("section", options.onSection);
    }

    const snapshot = this.transport.getSnapshot();
    this.applyTransportSnapshot(snapshot);
    const resolved = this.resolveAtPosition(this.cachedPositionMs);
    this.currentSection = resolved?.section ?? null;
    this.lastSectionId = this.currentSection?.id ?? null;
    this.lastDispatchedRawPositionMs = this.getRawPositionMs();
    this.lastEmittedStepKey = resolved ? this.stepKey(resolved, this.getIteration(this.lastDispatchedRawPositionMs)) : null;

    this.unsubscribeTransport = this.transport.subscribe((event) => this.handleTransportEvent(event));
    this.rescheduleIfPlaying();
  }

  on<TEventName extends ArrangementEventName>(
    eventName: TEventName,
    handler: ArrangementEventHandler<TEventName>,
  ): Unsubscribe {
    this.assertLive();
    this.listeners[eventName].add(handler as never);

    return () => {
      this.listeners[eventName].delete(handler as never);
    };
  }

  play(): Promise<void> {
    this.assertLive();
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));

    if (this.playbackState === "ended") {
      const mode = this.transport.getPlaybackState() === "playing" ? "seek-as-play" : "suppress-seek";
      this.endedReplaySeekMode = mode;
      const command = mode === "seek-as-play"
        ? this.runTransportCommands(["seek"], () => this.transport.seekMs(0))
        : this.runTransportCommands(["seek", "play"], async () => {
          await this.transport.seekMs(0);
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

  pause(): Promise<void> {
    this.assertLive();
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommands(["pause"], () => this.transport.pause());
  }

  stop(): Promise<void> {
    this.assertLive();
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommands(["stop"], () => this.transport.stop());
  }

  seekBeat(beat: number): Promise<void> {
    this.assertLive();
    const durationBeats = this.getDurationBeats();
    if (!Number.isFinite(beat) || beat < 0 || beat > durationBeats) {
      throw new RangeError(`beat must be a finite number from 0 to ${durationBeats}.`);
    }
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    // A beat before transport position 0 (negative startPositionMs) seeks to 0.
    const positionMs = Math.max(0, beatToMs(this.arrangement.timing, beat));
    return this.runTransportCommands(["seek"], () => this.transport.seekMs(positionMs));
  }

  seekPositionMs(positionMs: number): Promise<void> {
    this.assertLive();
    assertFiniteNonNegative(positionMs, "positionMs");
    const durationMs = this.getDurationMs();
    if (positionMs > durationMs) {
      throw new RangeError(`positionMs must be a finite number from 0 to ${durationMs}.`);
    }
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommands(["seek"], () => this.transport.seekMs(positionMs));
  }

  setLoop(loop: boolean): void {
    this.assertLive();
    if (typeof loop !== "boolean") {
      throw new TypeError("loop must be a boolean.");
    }
    if (loop === this.localLoop) {
      return;
    }

    const previousState = this.playbackState;
    this.localLoop = loop;
    if (!(previousState === "ended" && loop)) {
      this.applyTransportSnapshot(this.readTransportSnapshot());
    }
    // A toggle that keeps the Engine at local end (enabling loop from `ended`,
    // or disabling it while still past the end) does not re-anchor dispatch,
    // so a local-end pause in progress still finishes.
    if (previousState !== "ended" || this.playbackState !== "ended") {
      this.dispatchGeneration += 1;
    }
    this.emitPlayback("loopchange", "command", previousState);

    if (!loop && previousState === "playing" && this.playbackState === "ended") {
      this.clearTimer();
      this.emitSectionForPosition(this.cachedPositionMs, "tick", true);
      this.emitPlayback("ended", "local-end", previousState);
      return;
    }

    this.rescheduleIfPlaying();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.dispatchGeneration += 1;
    this.clearTimer();
    this.unsubscribeTransport();
    this.listeners.step.clear();
    this.listeners.playback.clear();
    this.listeners.project.clear();
    this.listeners.section.clear();
    if (this.ownsTransport) {
      this.transport.dispose();
    }
  }

  getArrangement(): ArrangementProject {
    this.assertLive();
    return this.arrangement;
  }

  /** Atomically replaces arrangement data while preserving the current fractional beat. */
  setArrangement(arrangement: ArrangementProject): void {
    this.assertLive();
    assertValidArrangement(arrangement);

    const previousArrangement = this.arrangement;
    if (previousArrangement === arrangement) {
      return;
    }

    const previousPositionMs = this.getLogicalPositionMs();
    const previousBeat = msToBeat(previousArrangement.timing, previousPositionMs);
    const previousChannels = this.sampleArrangementChannels(previousArrangement, previousPositionMs);
    const previousState = this.playbackState;
    const transportPositionMs = this.getTransportPositionMs();

    this.dispatchGeneration += 1;
    this.arrangement = arrangement;
    this.trackIds = unionTrackIds(this.arrangement);

    const nextBeat = this.normalizeBeatForArrangement(previousBeat, arrangement);
    const nextPositionMs = Math.max(0, beatToMs(arrangement.timing, nextBeat));
    this.projectAnchor = {
      transportPositionMs,
      projectPositionMs: nextPositionMs,
    };
    this.cachedPositionMs = nextPositionMs;
    // Steps of the new arrangement at or before the anchored position are not
    // dispatched retroactively.
    this.lastDispatchedRawPositionMs = nextPositionMs;
    this.applyTransportSnapshot(this.readTransportSnapshot());

    const channels = this.sampleArrangementChannels(this.arrangement, this.cachedPositionMs);
    const event: ArrangementProjectEvent = {
      arrangement,
      previousArrangement,
      changedChannelIds: this.getChangedChannelIds(previousChannels, channels),
      previousChannels,
      channels,
      positionMs: this.cachedPositionMs,
      beat: msToBeat(this.arrangement.timing, this.cachedPositionMs),
    };
    this.emit("project", event);

    if (this.getStepKeyAtPosition(previousPositionMs, previousArrangement) !== this.getStepKeyAtPosition(this.cachedPositionMs)) {
      this.emitStepForPosition(this.cachedPositionMs, "project-change");
    }
    this.emitSectionForPosition(this.cachedPositionMs, "project-change", true);

    if (previousState !== "ended" && this.playbackState === "ended") {
      this.clearTimer();
      this.emitPlayback("ended", "local-end", previousState);
      return;
    }

    this.rescheduleIfPlaying();
  }

  getCurrentSection(): ArrangementSection | null {
    this.assertLive();
    return this.currentSection;
  }

  getPlaybackState(): PlaybackState {
    this.assertLive();
    return this.playbackState;
  }

  getPosition(): ChannelPosition {
    this.assertLive();
    const positionMs = this.getLogicalPositionMs();
    return {
      positionMs,
      beat: msToBeat(this.arrangement.timing, positionMs),
    };
  }

  sampleChannels(easing: EasingFunction = linear): Record<string, number> {
    this.assertLive();
    return this.sampleArrangementChannels(this.arrangement, this.getLogicalPositionMs(), easing);
  }

  sampleChannelsAt(timeMs: number, easing: EasingFunction = linear): Record<string, number> {
    this.assertLive();
    assertFiniteNonNegative(timeMs, "timeMs");
    return this.sampleArrangementChannels(this.arrangement, timeMs, easing);
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

    if (
      event.type === "seek" ||
      event.type === "stop" ||
      (event.type === "play" && previousState === "ended")
    ) {
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
        this.lastDispatchedRawPositionMs = this.getRawPositionMs();
        this.emitSectionForPosition(this.getLogicalPositionMs(), "play", true);
        this.emitStepForPosition(this.getLogicalPositionMs(), "play");
      }
      this.rescheduleIfPlaying();
      return;
    }

    if (event.type === "pause") {
      // Pause neither moves the dispatch cursor nor bumps dispatchGeneration:
      // steps passed before a late pause go out on the first tick after resume,
      // and a batch that a listener pauses runs to completion. The local-end
      // tick sets "ended" before its terminal section event, so a pause from a
      // section listener there arrives with previousState "ended" and is
      // announced by tick() instead.
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
      this.lastSectionId = undefined;
      this.lastEmittedStepKey = null;
      this.lastDispatchedRawPositionMs = 0;
      this.emitPlayback(event.type, cause, previousState);
      return;
    }

    if (event.type === "seek") {
      this.dispatchGeneration += 1;
      this.clearTimer();
      this.lastDispatchedRawPositionMs = this.getRawPositionMs();
      if (previousState === "ended" && this.endedReplaySeekMode === "suppress-seek") {
        this.endedReplaySeekMode = null;
        this.pendingEndedReplayPlay = true;
        return;
      }
      if (previousState === "ended" && this.endedReplaySeekMode === "seek-as-play") {
        this.endedReplaySeekMode = null;
        this.emitPlayback("play", cause, previousState);
        this.emitSectionForPosition(this.getLogicalPositionMs(), "play", true);
        this.emitStepForPosition(this.getLogicalPositionMs(), "play");
        this.rescheduleIfPlaying();
        return;
      }
      this.emitPlayback(event.type, cause, previousState);
      this.emitSectionForPosition(this.getLogicalPositionMs(), "seek", true);
      this.emitStepForPosition(this.getLogicalPositionMs(), "seek");
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
    this.cachedPositionMs = this.normalizePosition(this.positionFromTransportPosition(snapshot.positionMs));
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
      this.syncCurrentSection(0);
      return;
    }

    const positionMs = this.positionFromTransportPosition(snapshot.positionMs);
    this.cachedPositionMs = this.normalizePosition(positionMs);
    this.syncCurrentSection(this.cachedPositionMs);

    if (snapshot.state === "ended") {
      this.playbackState = "ended";
      return;
    }

    if (this.isAtOrPastLocalEnd(positionMs)) {
      this.playbackState = "ended";
      this.cachedPositionMs = this.getDurationMs();
      this.syncCurrentSection(this.cachedPositionMs);
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
    const rawPositionMs = this.getRawPositionMs();

    if (this.isAtOrPastLocalEnd(rawPositionMs)) {
      // A listener that re-entrantly seeks, stops, hot-swaps, toggles loop, or
      // disposes has already re-anchored playback (and announced any local end
      // itself); one that pauses has had local end finished by runDispatch.
      if (!this.runDispatch(() => this.emitDueItems(this.getDurationMs()))) {
        return;
      }
      this.cachedPositionMs = this.getDurationMs();
      this.playbackState = "ended";
      this.emitSectionForPosition(this.cachedPositionMs, "tick", true);
      // A section listener may re-entrantly seek, stop, or hot-swap to a longer
      // arrangement; announce local end only while the Engine is still there.
      if (this.playbackState !== "ended") {
        return;
      }
      this.emitPlayback("ended", "local-end", previousState);
      return;
    }

    this.cachedPositionMs = this.normalizePosition(rawPositionMs);
    // A listener that re-entrantly reset dispatch has already rescheduled.
    if (this.runDispatch(() => this.emitDueItems(rawPositionMs))) {
      this.scheduleNextTick();
    }
  }

  /**
   * Runs one dispatch batch. When a listener's pause takes the Engine to local
   * end during it, the batch runs to completion first, then local end is
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
   * local-end tick: the steps and section changes due up to local end, the
   * terminal section, then `ended`. The dispatch is skipped when a listener
   * re-anchored it after the pause. Announce unless a listener disposed the
   * Engine or moved it out of `ended` since the pause (a command that later
   * re-enters `ended`, such as a replay or a shorter hot-swap, announces its
   * own).
   */
  private finishLocalEndPause(pause: LocalEndPause): void {
    if (this.dispatchGeneration === pause.generation) {
      // Local end was reached without loop; a pause listener that enabled loop
      // since then has left the Engine ended there.
      this.emitDueItems(this.getDurationMs(), false);
    }
    if (!this.isLocalEndPauseCurrent(pause)) {
      return;
    }
    this.emitSectionForPosition(this.getDurationMs(), "tick", true);
    if (!this.isLocalEndPauseCurrent(pause)) {
      return;
    }
    this.emitPlayback("ended", "local-end", "playing");
  }

  private isLocalEndPauseCurrent(pause: LocalEndPause): boolean {
    return !this.disposed && this.playbackState === "ended" && this.endedExits === pause.endedExits;
  }

  /**
   * Dispatches the section changes and step starts in
   * `(lastDispatchedRawPositionMs, toRawPositionMs]` in time order. Returns
   * `false` when a listener re-entrantly reset dispatch (seek, stop, hot-swap,
   * loop toggle, disposal): the rest of the batch is stale then.
   */
  private emitDueItems(toRawPositionMs: number, looping = this.localLoop): boolean {
    const fromRawPositionMs = this.lastDispatchedRawPositionMs;
    const transportPositionMs = looping
      ? this.normalizePosition(toRawPositionMs)
      : Math.min(toRawPositionMs, this.getDurationMs());

    if (toRawPositionMs < fromRawPositionMs) {
      return this.emitAfterBackwardMove(toRawPositionMs, transportPositionMs);
    }

    const durationMs = this.getDurationMs();
    // Positions are reported relative to the loop iteration the tick landed
    // in, so steps of earlier iterations have negative scheduled positions.
    const landingOffsetMs = this.getIteration(toRawPositionMs, looping) * durationMs;
    let items = this.getDueItems(fromRawPositionMs, toRawPositionMs, looping);
    if (this.missedStepPolicy === "skip") {
      items = this.getSkipItems(items, transportPositionMs);
    }

    const generation = this.dispatchGeneration;
    for (const item of items) {
      this.lastDispatchedRawPositionMs = item.rawPositionMs;
      const positionMs = item.rawPositionMs - landingOffsetMs;
      if (item.kind === "section") {
        this.emitSectionChange(item.section, item.beat, positionMs, transportPositionMs);
      } else {
        this.emitStepResolution(item.resolved, item.iteration, "tick", transportPositionMs, positionMs);
      }
      if (this.dispatchGeneration !== generation) {
        return false;
      }
    }

    this.lastDispatchedRawPositionMs = toRawPositionMs;
    return true;
  }

  /**
   * A position that moves backwards without a seek (a shared transport that
   * wraps on its own loop, or a media clock that jitters) re-anchors the
   * cursor and emits the landing section and step only when they changed.
   */
  private emitAfterBackwardMove(toRawPositionMs: number, transportPositionMs: number): boolean {
    const generation = this.dispatchGeneration;
    this.lastDispatchedRawPositionMs = toRawPositionMs;
    this.emitSectionForPosition(transportPositionMs, "tick", false);
    if (this.dispatchGeneration !== generation) {
      return false;
    }
    const resolved = this.resolveAtPosition(transportPositionMs);
    const iteration = this.getIteration(toRawPositionMs);
    if (resolved && this.stepKey(resolved, iteration) !== this.lastEmittedStepKey) {
      this.skipSnappedStepStart(resolved, transportPositionMs);
      // A step already under way at transport position 0 (negative
      // startPositionMs) is scheduled there, as at a local loop wrap.
      this.emitStepResolution(resolved, iteration, "tick", transportPositionMs, Math.max(0, resolved.scheduledPositionMs));
    }
    return this.dispatchGeneration === generation;
  }

  /**
   * `"skip"` resolves the landing position only: the section change into it
   * (at the boundary where it began) and the step there, when that step began
   * after the cursor. Both are the last items of their kind in the batch.
   */
  private getSkipItems(items: DueItem[], transportPositionMs: number): DueItem[] {
    let sectionItem: DueItem | undefined;
    let stepItem: DueItem | undefined;
    for (const item of items) {
      if (item.kind === "section") {
        sectionItem = item;
      } else {
        stepItem = item;
      }
    }

    const skipItems = sectionItem ? [sectionItem] : [];
    // A landing position in a gap or at local end resolves no step; the last
    // due step then belongs to an earlier section and is skipped.
    if (stepItem && this.resolveAtPosition(transportPositionMs)) {
      skipItems.push(stepItem);
    }
    return skipItems;
  }

  private emitStepForPosition(positionMs: number, cause: StepEventCause): void {
    const resolved = this.resolveAtPosition(positionMs);
    if (!resolved) {
      this.lastEmittedStepKey = null;
      return;
    }
    this.skipSnappedStepStart(resolved, positionMs);
    this.emitStepResolution(resolved, this.getIteration(this.getRawPositionMs()), cause, positionMs, positionMs);
  }

  /**
   * Moves the dispatch cursor past a step start that beatAtPosition snapped up
   * to from just before it, so the next tick does not dispatch that step again.
   */
  private skipSnappedStepStart(resolved: ArrangementStepResolution, positionMs: number): void {
    this.lastDispatchedRawPositionMs += Math.max(0, resolved.scheduledPositionMs - positionMs);
  }

  private emitStepResolution(
    resolved: ArrangementStepResolution,
    iteration: number,
    cause: StepEventCause,
    transportPositionMs: number,
    scheduledPositionMs = resolved.scheduledPositionMs,
  ): void {
    this.lastEmittedStepKey = this.stepKey(resolved, iteration);
    const pattern = this.arrangement.patterns[resolved.section.patternId];
    const nextStepBeat = Math.min(
      resolved.section.endBeat,
      resolved.scheduledBeat + 1 / pattern.stepsPerBeat,
    );
    const durationMs = Math.max(
      0,
      beatToMs(this.arrangement.timing, nextStepBeat) - resolved.scheduledPositionMs,
    );
    const event: StepEvent = {
      stepIndex: resolved.stepIndex,
      bpm: this.getBpmAtBeat(resolved.scheduledBeat),
      scheduledPositionMs,
      transportPositionMs,
      lateByMs: Math.max(0, transportPositionMs - scheduledPositionMs),
      durationMs,
      cause,
      tracks: this.trackIds.map((trackId) => {
        const track = pattern.tracks.find((candidate) => candidate.id === trackId);
        return {
          id: trackId,
          name: track?.name ?? trackId,
          enabled: track?.enabled ?? false,
          value: track?.enabled ? track.steps[resolved.stepIndex] : 0,
          nextValue: track?.enabled ? track.steps[resolved.nextStepIndex] : 0,
        };
      }),
    };
    this.emit("step", event);
  }

  private emitSectionForPosition(positionMs: number, cause: StepEventCause, force: boolean): void {
    const beat = this.beatAtPosition(positionMs);
    const lookup = sectionAtBeat(this.arrangement, beat);
    const section = lookup?.section ?? null;
    const sectionId = section?.id ?? null;

    if (!force && sectionId === this.lastSectionId) {
      return;
    }

    this.emitSection(section, beat, positionMs, positionMs, cause);
  }

  /** Emits a section boundary crossed by a tick when it changes the section. */
  private emitSectionChange(
    section: ArrangementSection | null,
    beat: number,
    positionMs: number,
    transportPositionMs: number,
  ): void {
    if ((section?.id ?? null) === this.lastSectionId) {
      return;
    }

    this.emitSection(section, beat, positionMs, transportPositionMs, "tick");
  }

  private emitSection(
    section: ArrangementSection | null,
    beat: number,
    positionMs: number,
    transportPositionMs: number,
    cause: StepEventCause,
  ): void {
    this.lastSectionId = section?.id ?? null;
    this.currentSection = section;
    this.emit("section", {
      section,
      beat,
      positionMs,
      transportPositionMs,
      lateByMs: Math.max(0, transportPositionMs - positionMs),
      cause,
    });
  }

  private syncCurrentSection(positionMs: number): void {
    const beat = this.beatAtPosition(positionMs);
    this.currentSection = sectionAtBeat(this.arrangement, beat)?.section ?? null;
  }

  private emitPlayback(
    type: EnginePlaybackEvent["type"],
    cause: EnginePlaybackEvent["cause"],
    previousState: PlaybackState,
    error?: unknown,
  ): void {
    const baseSnapshot = this.createPlaybackSnapshot();
    const event: ArrangementPlaybackEvent = {
      type,
      cause,
      previousState,
      snapshot: {
        ...baseSnapshot,
        section: this.currentSection,
      },
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
      beat: msToBeat(this.arrangement.timing, positionMs),
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
    return this.normalizePosition(this.positionFromTransportPosition(this.getTransportPositionMs()));
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

  private positionFromTransportPosition(transportPositionMs: number): number {
    if (!this.projectAnchor) {
      return transportPositionMs;
    }
    return Math.max(
      0,
      this.projectAnchor.projectPositionMs + (transportPositionMs - this.projectAnchor.transportPositionMs),
    );
  }

  private normalizePosition(positionMs: number): number {
    const durationMs = this.getDurationMs();
    if (this.localLoop && durationMs > 0) {
      return ((positionMs % durationMs) + durationMs) % durationMs;
    }
    return Math.max(0, Math.min(positionMs, durationMs));
  }

  private normalizeBeatForArrangement(beat: number, arrangement: ArrangementProject): number {
    const durationBeats = arrangementDurationBeats(arrangement);
    if (this.localLoop && durationBeats > 0) {
      return ((beat % durationBeats) + durationBeats) % durationBeats;
    }
    return Math.max(0, Math.min(beat, durationBeats));
  }

  private isAtOrPastLocalEnd(positionMs: number): boolean {
    return !this.localLoop && positionMs >= this.getDurationMs();
  }

  /**
   * The beat at a position, snapped up to the next section edge or step start
   * when that lies within POSITION_EPSILON_MS: an ms -> beat round trip can
   * land an ulp below it (for example at transport position 0 when a negative
   * startPositionMs puts a section or step start exactly there).
   */
  private beatAtPosition(positionMs: number, arrangement = this.arrangement): number {
    const beat = msToBeat(arrangement.timing, positionMs);
    let nextBeat = Number.POSITIVE_INFINITY;
    for (const section of arrangement.sections) {
      if (section.startBeat >= beat) {
        nextBeat = Math.min(nextBeat, section.startBeat);
      } else if (section.endBeat > beat) {
        const { stepsPerBeat } = arrangement.patterns[section.patternId];
        const stepBeat = section.startBeat + Math.ceil((beat - section.startBeat) * stepsPerBeat) / stepsPerBeat;
        nextBeat = Math.min(nextBeat, stepBeat, section.endBeat);
      }
    }
    return beatToMs(arrangement.timing, nextBeat) - positionMs <= POSITION_EPSILON_MS ? nextBeat : beat;
  }

  private resolveAtPosition(positionMs: number, arrangement = this.arrangement): ArrangementStepResolution | null {
    const beat = this.beatAtPosition(positionMs, arrangement);
    const resolved = resolveArrangementStep(arrangement, beat);
    if (!resolved) {
      return null;
    }

    const localBeat = beat - resolved.section.startBeat;
    const pattern = arrangement.patterns[resolved.section.patternId];
    const absoluteSectionStep = Math.floor(localBeat * pattern.stepsPerBeat);
    const scheduledBeat = resolved.section.startBeat + absoluteSectionStep / pattern.stepsPerBeat;
    return {
      ...resolved,
      absoluteSectionStep,
      scheduledBeat,
      scheduledPositionMs: beatToMs(arrangement.timing, scheduledBeat),
    };
  }

  /**
   * Collects the section boundaries and step starts in
   * `(fromRawPositionMs, toRawPositionMs]`, iteration by iteration when
   * looping, in time order with a section boundary before a step at the same
   * time. Without loop, local end is exclusive: a step cannot start there.
   */
  private getDueItems(fromRawPositionMs: number, toRawPositionMs: number, looping: boolean): DueItem[] {
    const durationMs = this.getDurationMs();
    const startIteration = this.getIteration(fromRawPositionMs, looping);
    const endIteration = this.getIteration(toRawPositionMs, looping);
    const items: DueItem[] = [];

    for (let iteration = startIteration; iteration <= endIteration; iteration += 1) {
      const iterationStartMs = iteration * durationMs;
      // Each later iteration starts with its beat-0 boundary and steps.
      const fromLocalMs = iteration === startIteration ? fromRawPositionMs - iterationStartMs : -1;
      const toLocalMs = Math.min(toRawPositionMs - iterationStartMs, durationMs);
      this.collectIterationItems(items, iteration, iterationStartMs, fromLocalMs, toLocalMs);
    }

    const kindOrder = (item: DueItem): number => (item.kind === "section" ? 0 : 1);
    return items.sort((left, right) =>
      left.rawPositionMs - right.rawPositionMs || kindOrder(left) - kindOrder(right),
    );
  }

  private collectIterationItems(
    items: DueItem[],
    iteration: number,
    iterationStartMs: number,
    fromLocalMs: number,
    toLocalMs: number,
  ): void {
    const { timing, sections, patterns } = this.arrangement;
    // Positions before transport 0 (a negative startPositionMs) are never due.
    const isDue = (localMs: number): boolean => localMs >= 0 && localMs > fromLocalMs && localMs <= toLocalMs;
    const durationBeats = this.getDurationBeats();

    // A negative startPositionMs puts beat 0 before transport position 0, so an
    // iteration starts at local 0 inside the arrangement. Like play() from
    // there, its start dispatches the section and the step already under way.
    const startsBeforeTransport = timing.startPositionMs < 0;
    if (startsBeforeTransport && isDue(0)) {
      const beat = this.beatAtPosition(0);
      items.push({
        kind: "section",
        rawPositionMs: iterationStartMs,
        section: sectionAtBeat(this.arrangement, beat)?.section ?? null,
        beat,
      });
      const resolved = this.resolveAtPosition(0);
      if (resolved && resolved.scheduledPositionMs < 0) {
        items.push({ kind: "step", rawPositionMs: iterationStartMs, iteration, resolved });
      }
    }

    const sectionEdges = sections.flatMap((section) => [section.startBeat, section.endBeat]);
    const boundaryBeats = new Set(startsBeforeTransport ? sectionEdges : [0, ...sectionEdges]);
    for (const beat of boundaryBeats) {
      const localMs = beatToMs(timing, beat);
      if (beat >= durationBeats || !isDue(localMs)) {
        continue;
      }
      items.push({
        kind: "section",
        rawPositionMs: iterationStartMs + localMs,
        section: sectionAtBeat(this.arrangement, beat)?.section ?? null,
        beat,
      });
    }

    const fromBeat = msToBeat(timing, Math.max(0, fromLocalMs));
    const toBeat = msToBeat(timing, toLocalMs);
    for (const section of sections) {
      const pattern = patterns[section.patternId];
      // The beat range is widened by one step on each side because a ms -> beat
      // round trip can land an ulp below a step's beat; isDue decides in ms.
      const sectionLastStep = Math.ceil((section.endBeat - 1e-9 - section.startBeat) * pattern.stepsPerBeat) - 1;
      const firstStep = Math.max(0, Math.floor((fromBeat - section.startBeat) * pattern.stepsPerBeat) - 1);
      const lastStep = Math.min(
        sectionLastStep,
        Math.floor((toBeat - section.startBeat) * pattern.stepsPerBeat) + 1,
      );

      for (let absoluteSectionStep = firstStep; absoluteSectionStep <= lastStep; absoluteSectionStep += 1) {
        const scheduledBeat = section.startBeat + absoluteSectionStep / pattern.stepsPerBeat;
        const scheduledPositionMs = beatToMs(timing, scheduledBeat);
        if (!isDue(scheduledPositionMs)) {
          continue;
        }
        const stepIndex = ((absoluteSectionStep % pattern.stepCount) + pattern.stepCount) % pattern.stepCount;
        items.push({
          kind: "step",
          rawPositionMs: iterationStartMs + scheduledPositionMs,
          iteration,
          resolved: {
            section,
            stepIndex,
            nextStepIndex: (stepIndex + 1) % pattern.stepCount,
            phase: 0,
            absoluteSectionStep,
            scheduledBeat,
            scheduledPositionMs,
          },
        });
      }
    }
  }

  private getStepKeyAtPosition(positionMs: number, arrangement = this.arrangement): string | null {
    const resolved = this.resolveAtPosition(positionMs, arrangement);
    return resolved ? `${resolved.section.id}:${resolved.absoluteSectionStep}` : null;
  }

  private stepKey(resolved: ArrangementStepResolution, iteration: number): string {
    return `${iteration}:${resolved.section.id}:${resolved.absoluteSectionStep}`;
  }

  /** Current position in the raw domain (see lastDispatchedRawPositionMs). */
  private getRawPositionMs(): number {
    return this.positionFromTransportPosition(this.getTransportPositionMs());
  }

  /** Loop iteration of a raw position; always 0 without Project loop. */
  private getIteration(rawPositionMs: number, looping = this.localLoop): number {
    return looping ? Math.floor(rawPositionMs / this.getDurationMs()) : 0;
  }

  private sampleArrangementChannels(
    arrangement: ArrangementProject,
    positionMs: number,
    easing: EasingFunction = linear,
  ): Record<string, number> {
    const beat = this.beatAtPosition(positionMs, arrangement);
    return sampleArrangement(arrangement, beat, easing, unionTrackIds(arrangement));
  }

  private getChangedChannelIds(
    previousChannels: Record<string, number>,
    channels: Record<string, number>,
  ): string[] {
    return [...new Set([...Object.keys(previousChannels), ...Object.keys(channels)])].filter(
      (channelId) => previousChannels[channelId] !== channels[channelId],
    );
  }

  private getDurationBeats(arrangement = this.arrangement): number {
    return arrangementDurationBeats(arrangement);
  }

  private getDurationMs(arrangement = this.arrangement): number {
    return beatToMs(arrangement.timing, this.getDurationBeats(arrangement));
  }

  private getBpmAtBeat(beat: number): number {
    let bpm = this.arrangement.timing.tempos[0].bpm;
    for (const tempo of this.arrangement.timing.tempos) {
      if (tempo.beat > beat) {
        break;
      }
      bpm = tempo.bpm;
    }
    return bpm;
  }

  private emit<TEventName extends ArrangementEventName>(
    eventName: TEventName,
    event: ArrangementEventMap[TEventName],
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
      throw new PlaybackError("TRANSPORT_DISPOSED", "ArrangementEngine has been disposed.");
    }
  }
}
