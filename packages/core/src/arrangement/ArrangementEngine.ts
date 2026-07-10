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
    throw new TypeError(`Invalid ArrangementProject: ${result.errors[0]?.path ?? "$"} ${result.errors[0]?.message ?? ""}`.trim());
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
  private transportTimerId: ReturnType<typeof setTimeout> | undefined;
  private playbackState: PlaybackState = "stopped";
  private buffering = false;
  private localLoop: boolean;
  private cachedPositionMs = 0;
  private currentSection: ArrangementSection | null = null;
  private lastSectionId: string | null | undefined = undefined;
  private lastEmittedStepKey: string | null = null;
  private lastEmittedScheduledPositionMs: number | null = null;
  private projectAnchor: ProjectPositionAnchor | null = null;
  private endedReplaySeekMode: "seek-as-play" | "suppress-seek" | null = null;
  private pendingEndedReplayPlay = false;
  private readonly pendingCommandEvents: PlaybackTransportEvent["type"][] = [];

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
    this.lastEmittedStepKey = resolved ? this.stepKey(resolved) : null;

    this.unsubscribeTransport = this.transport.subscribe((event) => this.handleTransportEvent(event));
    if (this.playbackState === "playing" && !this.buffering) {
      this.scheduleNextTick();
    }
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
    return this.runTransportCommands(["seek"], () => this.transport.seekMs(beatToMs(this.arrangement.timing, beat)));
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

    this.arrangement = arrangement;
    this.trackIds = unionTrackIds(this.arrangement);

    const nextBeat = this.normalizeBeatForArrangement(previousBeat, arrangement);
    const nextPositionMs = beatToMs(arrangement.timing, nextBeat);
    this.projectAnchor = {
      transportPositionMs,
      projectPositionMs: nextPositionMs,
    };
    this.cachedPositionMs = nextPositionMs;
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
        this.clearTimer();
        this.emitPlayback("ended", "local-end", previousState);
        return;
      }

      const playbackPreviousState = isEndedReplayPlay ? "ended" : previousState;
      this.emitPlayback(event.type, cause, playbackPreviousState);
      if (previousState === "stopped" || previousState === "ended" || isEndedReplayPlay) {
        this.emitSectionForPosition(this.getLogicalPositionMs(), "play", true);
        this.emitStepForPosition(this.getLogicalPositionMs(), "play");
      }
      this.rescheduleIfPlaying();
      return;
    }

    if (event.type === "pause") {
      this.clearTimer();
      this.emitPlayback(event.type, cause, previousState);
      return;
    }

    if (event.type === "stop") {
      this.clearTimer();
      this.cachedPositionMs = 0;
      this.lastSectionId = undefined;
      this.lastEmittedStepKey = null;
      this.lastEmittedScheduledPositionMs = null;
      this.emitPlayback(event.type, cause, previousState);
      return;
    }

    if (event.type === "seek") {
      this.clearTimer();
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
    this.transportDisposed = true;
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
    const rawPositionMs = this.positionFromTransportPosition(this.getTransportPositionMs());
    const positionMs = this.normalizePosition(rawPositionMs);

    if (this.isAtOrPastLocalEnd(rawPositionMs)) {
      this.emitDueSteps(this.getDurationMs());
      this.cachedPositionMs = this.getDurationMs();
      this.playbackState = "ended";
      this.emitSectionForPosition(this.cachedPositionMs, "tick", true);
      this.emitPlayback("ended", "local-end", previousState);
      return;
    }

    this.cachedPositionMs = positionMs;
    this.emitSectionForPosition(positionMs, "tick", false);
    this.emitDueSteps(positionMs);
    this.scheduleNextTick();
  }

  private emitDueSteps(positionMs: number): void {
    const resolved = this.resolveAtPosition(positionMs);
    if (!resolved) {
      return;
    }

    // Unlike SequencerEngine's ever-increasing absolute-step counter (which
    // needed an explicit "loop" transport-event branch to re-anchor after a
    // position wrap — see StepEventCause's "loop" member and
    // SequencerEngine.ts), this guard compares section+step identity. A
    // transport loop wrap naturally produces a different stepKey than the
    // one last emitted, so re-emission resumes on its own; ArrangementEngine
    // does not need (and does not implement) a "loop"-caused step.
    const stepKey = this.stepKey(resolved);
    if (this.lastEmittedStepKey === stepKey) {
      return;
    }

    if (this.missedStepPolicy === "skip" || this.lastEmittedScheduledPositionMs === null) {
      this.emitStepResolution(resolved, "tick", positionMs);
      return;
    }

    const dueSteps = this.getDueStepResolutions(this.lastEmittedScheduledPositionMs, positionMs);
    if (dueSteps.length === 0) {
      this.emitStepResolution(resolved, "tick", positionMs);
      return;
    }

    for (const dueStep of dueSteps) {
      this.emitStepResolution(dueStep, "tick", positionMs);
    }
  }

  private emitStepForPosition(positionMs: number, cause: StepEventCause): void {
    const resolved = this.resolveAtPosition(positionMs);
    if (!resolved) {
      this.lastEmittedStepKey = null;
      this.lastEmittedScheduledPositionMs = null;
      return;
    }
    this.emitStepResolution(resolved, cause, positionMs, positionMs);
  }

  private emitStepResolution(
    resolved: ArrangementStepResolution,
    cause: StepEventCause,
    transportPositionMs: number,
    scheduledPositionMs = resolved.scheduledPositionMs,
  ): void {
    this.lastEmittedStepKey = this.stepKey(resolved);
    this.lastEmittedScheduledPositionMs = scheduledPositionMs;
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
          value: track?.enabled ? track.steps[resolved.stepIndex] ?? 0 : 0,
          nextValue: track?.enabled ? track.steps[resolved.nextStepIndex] ?? 0 : 0,
        };
      }),
    };
    this.emit("step", event);
  }

  private emitSectionForPosition(positionMs: number, cause: StepEventCause, force: boolean): void {
    const beat = msToBeat(this.arrangement.timing, positionMs);
    const lookup = sectionAtBeat(this.arrangement, beat);
    const section = lookup?.section ?? null;
    const sectionId = section?.id ?? null;

    if (!force && sectionId === this.lastSectionId) {
      return;
    }

    this.lastSectionId = sectionId;
    this.currentSection = section;
    this.emit("section", {
      section,
      beat,
      positionMs,
      transportPositionMs: positionMs,
      lateByMs: 0,
      cause,
    });
  }

  private syncCurrentSection(positionMs: number): void {
    const beat = msToBeat(this.arrangement.timing, positionMs);
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
      return this.cachedPositionMs;
    }
    return this.transport.getPositionMs();
  }

  private readTransportSnapshot(): PlaybackSnapshot {
    if (this.transportDisposed) {
      return {
        state: this.playbackState,
        positionMs: this.cachedPositionMs,
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

  private resolveAtPosition(positionMs: number, arrangement = this.arrangement): ArrangementStepResolution | null {
    const beat = msToBeat(arrangement.timing, positionMs);
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

  private getDueStepResolutions(afterPositionMs: number, toPositionMs: number): ArrangementStepResolution[] {
    const due: ArrangementStepResolution[] = [];
    const fromBeat = msToBeat(this.arrangement.timing, afterPositionMs);
    const toBeat = msToBeat(this.arrangement.timing, toPositionMs);

    for (const section of this.arrangement.sections) {
      const pattern = this.arrangement.patterns[section.patternId];
      const firstStep = Math.max(0, Math.floor((fromBeat - section.startBeat) * pattern.stepsPerBeat));
      const lastStep = Math.floor(
        (Math.min(toBeat, section.endBeat - 1e-9) - section.startBeat) * pattern.stepsPerBeat,
      );

      for (let absoluteSectionStep = firstStep; absoluteSectionStep <= lastStep; absoluteSectionStep += 1) {
        const scheduledBeat = section.startBeat + absoluteSectionStep / pattern.stepsPerBeat;
        const scheduledPositionMs = beatToMs(this.arrangement.timing, scheduledBeat);
        if (scheduledPositionMs <= afterPositionMs || scheduledPositionMs > toPositionMs) {
          continue;
        }
        const stepIndex = ((absoluteSectionStep % pattern.stepCount) + pattern.stepCount) % pattern.stepCount;
        due.push({
          section,
          stepIndex,
          nextStepIndex: (stepIndex + 1) % pattern.stepCount,
          phase: 0,
          absoluteSectionStep,
          scheduledBeat,
          scheduledPositionMs,
        });
      }
    }

    return due.sort((left, right) => left.scheduledPositionMs - right.scheduledPositionMs);
  }

  private getStepKeyAtPosition(positionMs: number, arrangement = this.arrangement): string | null {
    const resolved = this.resolveAtPosition(positionMs, arrangement);
    return resolved ? `${resolved.section.id}:${resolved.absoluteSectionStep}` : null;
  }

  private stepKey(resolved: ArrangementStepResolution): string {
    return `${resolved.section.id}:${resolved.absoluteSectionStep}`;
  }

  private sampleArrangementChannels(
    arrangement: ArrangementProject,
    positionMs: number,
    easing: EasingFunction = linear,
  ): Record<string, number> {
    const beat = msToBeat(arrangement.timing, positionMs);
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
