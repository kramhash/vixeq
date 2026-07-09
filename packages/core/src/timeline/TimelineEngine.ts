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

const POSITION_EPSILON_MS = 1e-9;

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
    throw new TypeError(`Invalid TimelineProject: ${result.errors[0]?.path ?? "$"} ${result.errors[0]?.message ?? ""}`.trim());
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
    if (this.playbackState === "playing" && !this.buffering) {
      this.scheduleNextTick();
    }
  }

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
    if (!Number.isFinite(beat) || beat < 0 || beat > this.project.durationBeats) {
      throw new RangeError(`beat must be a finite number from 0 to ${this.project.durationBeats}.`);
    }
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommands(["seek"], () => this.transport.seekMs(beatToMs(this.project.timing, beat)));
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

  getProject(): TimelineProject<TEvent> {
    this.assertLive();
    return this.project;
  }

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
    const nextPositionMs = beatToMs(project.timing, nextBeat);

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

  getPlaybackState(): PlaybackState {
    this.assertLive();
    return this.playbackState;
  }

  getPosition(): { positionMs: number; beat: number } {
    this.assertLive();
    const positionMs = this.getLogicalPositionMs();
    return {
      positionMs,
      beat: msToBeat(this.project.timing, positionMs),
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
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
        this.clearTimer();
        this.emitPlayback("ended", "local-end", previousState);
        return;
      }

      const playbackPreviousState = isEndedReplayPlay ? "ended" : previousState;
      this.emitPlayback(event.type, cause, playbackPreviousState);
      if (previousState === "stopped" || previousState === "ended" || isEndedReplayPlay) {
        this.lastDispatchedRawPositionMs = null;
        this.emitCurrentCues();
      }
      this.rescheduleIfPlaying();
      return;
    }

    if (event.type === "pause") {
      this.clearTimer();
      this.lastDispatchedRawPositionMs = this.rawPositionFromTransportPosition(event.snapshot.positionMs);
      this.emitPlayback(event.type, cause, previousState);
      return;
    }

    if (event.type === "stop") {
      this.clearTimer();
      this.cachedPositionMs = 0;
      this.lastDispatchedRawPositionMs = null;
      this.emitPlayback(event.type, cause, previousState);
      return;
    }

    if (event.type === "seek") {
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
        this.emitCurrentCues();
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
      return;
    }

    const rawPositionMs = this.rawPositionFromTransportPosition(snapshot.positionMs);
    this.cachedPositionMs = this.normalizePosition(rawPositionMs);

    if (snapshot.state === "ended") {
      this.playbackState = "ended";
      this.cachedPositionMs = this.getDurationMs();
      return;
    }

    if (this.isAtOrPastLocalEnd(rawPositionMs)) {
      this.playbackState = "ended";
      this.cachedPositionMs = this.getDurationMs();
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
      this.emitDueCues(this.getDurationMs());
      this.cachedPositionMs = this.getDurationMs();
      this.lastDispatchedRawPositionMs = this.getDurationMs();
      this.playbackState = "ended";
      this.emitPlayback("ended", "local-end", previousState);
      return;
    }

    this.cachedPositionMs = this.normalizePosition(rawPositionMs);
    this.emitDueCues(rawPositionMs);
    this.scheduleNextTick();
  }

  private emitCurrentCues(): void {
    const rawPositionMs = this.rawPositionFromTransportPosition(this.getTransportPositionMs());
    const durationMs = this.getDurationMs();
    const iteration = this.localLoop && durationMs > 0 ? Math.floor(rawPositionMs / durationMs) : 0;
    const localPositionMs = this.normalizePosition(rawPositionMs);
    const beat = msToBeat(this.project.timing, localPositionMs);
    const events = this.eventIndex.getEventsAtBeat(beat).filter((event) => {
      const scheduledPositionMs = beatToMs(this.project.timing, event.beat);
      return Math.abs(scheduledPositionMs - localPositionMs) <= POSITION_EPSILON_MS;
    });

    for (const event of events) {
      this.emitCue(event, iteration, iteration * durationMs + beatToMs(this.project.timing, event.beat), rawPositionMs);
    }

    this.lastDispatchedRawPositionMs = rawPositionMs;
  }

  private emitDueCues(toRawPositionMs: number): void {
    const fromRawPositionMs = this.lastDispatchedRawPositionMs;
    if (fromRawPositionMs === null) {
      this.emitCurrentCues();
      return;
    }

    if (toRawPositionMs <= fromRawPositionMs) {
      this.lastDispatchedRawPositionMs = toRawPositionMs;
      return;
    }

    const durationMs = this.getDurationMs();
    if (!this.localLoop) {
      this.emitDueCuesForIteration(0, fromRawPositionMs, Math.min(toRawPositionMs, durationMs), toRawPositionMs);
      this.lastDispatchedRawPositionMs = toRawPositionMs;
      return;
    }

    const startIteration = Math.floor(fromRawPositionMs / durationMs);
    const endIteration = Math.floor(toRawPositionMs / durationMs);

    for (let iteration = startIteration; iteration <= endIteration; iteration += 1) {
      const iterationStartRaw = iteration * durationMs;
      const fromLocalPositionMs = iteration === startIteration
        ? fromRawPositionMs - iterationStartRaw
        : -POSITION_EPSILON_MS;
      const toLocalPositionMs = iteration === endIteration
        ? toRawPositionMs - iterationStartRaw
        : durationMs;
      this.emitDueCuesForIteration(iteration, fromLocalPositionMs, toLocalPositionMs, toRawPositionMs);
    }

    this.lastDispatchedRawPositionMs = toRawPositionMs;
  }

  private emitDueCuesForIteration(
    iteration: number,
    fromLocalPositionMs: number,
    toLocalPositionMs: number,
    transportPositionMs: number,
  ): void {
    const durationMs = this.getDurationMs();
    const fromPositionMs = Math.max(0, fromLocalPositionMs);
    const toPositionMs = Math.min(durationMs, Math.max(0, toLocalPositionMs));
    if (toPositionMs + POSITION_EPSILON_MS < fromPositionMs) {
      return;
    }

    const fromBeat = msToBeat(this.project.timing, fromPositionMs);
    const toBeat = msToBeat(this.project.timing, toPositionMs);
    const events = this.eventIndex.getEventsInBeatRangeInclusiveEnd(fromBeat, toBeat);
    const exclusiveFromPositionMs = fromLocalPositionMs < 0 ? fromLocalPositionMs : fromLocalPositionMs + POSITION_EPSILON_MS;

    const dueEvents: Array<{ event: TEvent; scheduledLocalPositionMs: number }> = [];
    for (const event of events) {
      const scheduledLocalPositionMs = beatToMs(this.project.timing, event.beat);
      if (
        scheduledLocalPositionMs <= exclusiveFromPositionMs ||
        scheduledLocalPositionMs > toLocalPositionMs + POSITION_EPSILON_MS
      ) {
        continue;
      }

      dueEvents.push({ event, scheduledLocalPositionMs });
    }

    if (dueEvents.length === 0) {
      return;
    }

    // "skip" discards every earlier missed cue unconditionally and keeps only
    // the most-advanced (highest-beat) due event, mirroring ArrangementEngine's
    // missedStepPolicy "skip" (resolve-and-emit-only-the-current-position).
    // There is no separate lateness threshold here; lookaheadMs governs only
    // the poll interval (see tick()'s setTimeout), not this policy.
    const toDispatch = this.missedCuePolicy === "skip" ? [dueEvents[dueEvents.length - 1]] : dueEvents;

    for (const { event, scheduledLocalPositionMs } of toDispatch) {
      const scheduledRawPositionMs = iteration * durationMs + scheduledLocalPositionMs;
      this.emitCue(event, iteration, scheduledRawPositionMs, transportPositionMs);
    }
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
    const durationMs = this.getDurationMs();
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
    return !this.localLoop && positionMs >= this.getDurationMs();
  }

  private getDurationMs(project = this.project): number {
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
