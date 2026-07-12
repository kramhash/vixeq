import { browserClock } from "./clock";
import { linear, lerp, type EasingFunction } from "./easing";
import {
  createClockTransport,
  PlaybackError,
  type PlaybackSnapshot,
  type PlaybackState,
  type PlaybackTransport,
  type PlaybackTransportEvent,
} from "./playbackTransport";
import { validateProject } from "./validation";
import type {
  ChannelPosition,
  EnginePlaybackEvent,
  EnginePlaybackSnapshot,
  ProjectEvent,
  SequenceProject,
  SequencerEngineOptions,
  SequencerEventHandler,
  SequencerEventMap,
  SequencerEventName,
  SequencerPlaybackEvent,
  StepEvent,
  StepEventCause,
  Unsubscribe,
} from "./types";

type ProjectPositionAnchor = {
  transportPositionMs: number;
  projectPositionMs: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const assertFiniteNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
};

const assertStepIndex = (value: number, stepCount: number): void => {
  if (!Number.isInteger(value) || value < 0 || value >= stepCount) {
    throw new RangeError(`stepIndex must be an integer from 0 to ${stepCount - 1}.`);
  }
};

const assertValidProject = (project: SequenceProject): void => {
  const result = validateProject(project);
  if (!result.ok) {
    throw new TypeError(`Invalid SequenceProject: ${result.errors[0]?.path ?? "$"} ${result.errors[0]?.message ?? ""}`.trim());
  }
};

const reportListenerError = (
  error: unknown,
  eventName: string,
  onListenerError?: SequencerEngineOptions["onListenerError"],
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
 * Plays and samples a single looping {@link SequenceProject}.
 *
 * The engine owns step scheduling (emitting `"step"` events at each step
 * boundary), transport control (play/pause/stop/seek), and continuous
 * channel sampling — interpolated 0–1 values per track, e.g. for driving
 * animation via {@link SequencerEngine.sampleChannels}. It drives itself off
 * a `PlaybackTransport` — either one you supply (to sync against an
 * `<audio>` element or other external clock) or, if `transport` is omitted
 * from the constructor options, an Engine-owned transport backed by the
 * browser clock (`browserClock`, via `createClockTransport`), which the
 * engine disposes automatically.
 *
 * The project is treated as looping forever; use
 * {@link SequencerEngine.setProject} to swap in a new `SequenceProject`
 * without resetting playback — position is preserved proportionally by beat.
 *
 * @example
 * ```ts
 * const engine = new SequencerEngine(createProject());
 * const unsubscribe = engine.on("step", (event) => {
 *   console.log(event.stepIndex, event.tracks);
 * });
 * await engine.play();
 * // ...
 * unsubscribe();
 * engine.dispose();
 * ```
 */
export class SequencerEngine {
  private project: SequenceProject;
  private readonly transport: PlaybackTransport;
  private readonly ownsTransport: boolean;
  private readonly lookaheadMs: number;
  private readonly listeners: {
    [TEventName in SequencerEventName]: Set<SequencerEventHandler<TEventName>>;
  };
  private readonly missedStepPolicy: "emit" | "skip";
  private readonly onListenerError?: SequencerEngineOptions["onListenerError"];
  private readonly unsubscribeTransport: Unsubscribe;
  private disposed = false;
  private transportDisposed = false;
  private transportTimerId: ReturnType<typeof setTimeout> | undefined;
  private playbackState: PlaybackState;
  private buffering = false;
  private cachedPositionMs = 0;
  private currentStepIndex = 0;
  private lastEmittedAbsoluteStep: number | null = null;
  private projectAnchor: ProjectPositionAnchor | null = null;
  private readonly pendingCommandEvents: PlaybackTransportEvent["type"][] = [];

  /**
   * @param project - Initial {@link SequenceProject} to load. Validated
   *   eagerly against {@link validateProject}.
   * @param options - See {@link SequencerEngineOptions}. All fields are
   *   optional; omitting `transport` gives the engine its own browser-clock
   *   transport (created via `createClockTransport(browserClock)`), which it
   *   owns and disposes automatically.
   * @throws {TypeError} if `options` is not an object, or `project` fails
   *   validation.
   * @throws {RangeError} if `options.lookaheadMs` is provided but not a
   *   finite, non-negative number.
   */
  constructor(project: SequenceProject, options: SequencerEngineOptions = {}) {
    if (!isRecord(options)) {
      throw new TypeError("SequencerEngine options must be an object.");
    }
    if (options.lookaheadMs !== undefined) {
      assertFiniteNonNegative(options.lookaheadMs, "lookaheadMs");
    }

    assertValidProject(project);
    this.project = project;
    this.transport = options.transport ?? createClockTransport(browserClock);
    this.ownsTransport = options.transport === undefined;
    this.lookaheadMs = options.lookaheadMs ?? 25;
    this.missedStepPolicy = options.missedStepPolicy ?? "emit";
    this.onListenerError = options.onListenerError;
    this.listeners = {
      step: new Set(),
      playback: new Set(),
      project: new Set(),
    };

    if (options.onStep) {
      this.on("step", options.onStep);
    }

    const snapshot = this.transport.getSnapshot();
    this.playbackState = snapshot.state;
    this.buffering = snapshot.buffering;
    this.cachedPositionMs = snapshot.positionMs;
    this.currentStepIndex = this.stepIndexAt(snapshot.positionMs);
    this.lastEmittedAbsoluteStep = snapshot.state === "stopped" && snapshot.positionMs === 0
      ? null
      : this.absoluteStepAt(snapshot.positionMs);

    this.unsubscribeTransport = this.transport.subscribe((event) => this.handleTransportEvent(event));
    if (snapshot.state === "playing" && !snapshot.buffering) {
      this.scheduleNextTick();
    }
  }

  on<TEventName extends SequencerEventName>(
    eventName: TEventName,
    handler: SequencerEventHandler<TEventName>,
  ): Unsubscribe {
    this.assertLive();
    this.listeners[eventName].add(handler as never);

    return () => {
      this.listeners[eventName].delete(handler as never);
    };
  }

  /**
   * Start (or resume) playback on the underlying transport.
   *
   * When resuming from `"stopped"` or `"ended"`, immediately emits a
   * `"step"` event (`cause: "play"`) for the current position, then
   * schedules the next tick.
   *
   * @returns A promise that resolves once the transport has started.
   * @throws {PlaybackError} with code `"TRANSPORT_DISPOSED"` if the
   *   transport has been disposed (e.g. the underlying `<audio>` element
   *   was torn down).
   */
  play(): Promise<void> {
    this.assertLive();
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommand("play", () => this.transport.play());
  }

  /**
   * Pause playback on the underlying transport. Position is preserved; call
   * {@link SequencerEngine.play} to resume from the same spot.
   *
   * @returns A promise that resolves once the transport has paused.
   * @throws {PlaybackError} with code `"TRANSPORT_DISPOSED"` if the
   *   transport has been disposed.
   */
  pause(): Promise<void> {
    this.assertLive();
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommand("pause", () => this.transport.pause());
  }

  /**
   * Stop playback and reset the logical position back to step 0.
   *
   * @returns A promise that resolves once the transport has stopped.
   * @throws {PlaybackError} with code `"TRANSPORT_DISPOSED"` if the
   *   transport has been disposed.
   */
  stop(): Promise<void> {
    this.assertLive();
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommand("stop", () => this.transport.stop());
  }

  /**
   * Seek to an absolute logical position, in milliseconds.
   *
   * @param positionMs - Target position; must be finite and non-negative.
   * @returns A promise that resolves once the seek completes.
   * @throws {RangeError} if `positionMs` is not finite or is negative.
   * @throws {PlaybackError} with code `"TRANSPORT_DISPOSED"` if the
   *   transport has been disposed.
   */
  seekPositionMs(positionMs: number): Promise<void> {
    this.assertLive();
    assertFiniteNonNegative(positionMs, "positionMs");
    if (this.transportDisposed) return Promise.reject(new PlaybackError("TRANSPORT_DISPOSED"));
    return this.runTransportCommand("seek", () => this.transport.seekMs(positionMs));
  }

  /**
   * Seek to the start of a specific step in the project's step grid.
   * Convenience wrapper around {@link SequencerEngine.seekPositionMs}.
   *
   * @param stepIndex - Integer index in `[0, project.stepCount)`.
   * @returns A promise that resolves once the seek completes.
   * @throws {RangeError} if `stepIndex` is not an integer in range.
   */
  seekStep(stepIndex: number): Promise<void> {
    this.assertLive();
    assertStepIndex(stepIndex, this.project.stepCount);
    return this.seekPositionMs(stepIndex * this.getStepDurationMs());
  }

  /**
   * Tear down the engine: clears any pending scheduling timer, unsubscribes
   * from the transport, and clears all listeners. If the engine created its
   * own transport (i.e. `transport` was omitted from the constructor
   * options), that transport is disposed too — a transport you supplied
   * yourself is left untouched. Safe to call more than once; subsequent
   * calls are no-ops. After disposal, most other methods throw.
   */
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
    if (this.ownsTransport) {
      this.transport.dispose();
    }
  }

  /**
   * Swap in a new {@link SequenceProject} while preserving playback position
   * proportionally by beat (e.g. beat 3.5 of the old project maps to beat
   * 3.5 of the new one, re-scaled for any BPM change) instead of resetting
   * to 0. Emits a `"project"` event describing which channel values changed
   * as a result of the swap.
   *
   * No-op if `project` is reference-equal to the currently loaded project.
   *
   * @param project - The new project to load. Validated eagerly.
   * @throws {TypeError} if `project` fails {@link validateProject}.
   */
  setProject(project: SequenceProject): void {
    this.assertLive();
    assertValidProject(project);

    const previousProject = this.project;
    if (previousProject === project) {
      return;
    }

    const positionMs = this.getLogicalPositionMs();
    const previousChannels = this.sampleProjectChannels(previousProject, positionMs);
    const preservedBeat = positionMs / this.getMsPerBeat(previousProject);
    const nextPositionMs = preservedBeat * this.getMsPerBeat(project);
    const channels = this.sampleProjectChannels(project, nextPositionMs);
    const changedChannelIds = this.getChangedChannelIds(previousChannels, channels);

    this.project = project;
    this.projectAnchor = {
      transportPositionMs: this.getTransportPositionMs(),
      projectPositionMs: nextPositionMs,
    };
    this.cachedPositionMs = nextPositionMs;
    this.currentStepIndex = this.stepIndexAt(nextPositionMs);
    this.lastEmittedAbsoluteStep = this.absoluteStepAt(nextPositionMs);

    const event: ProjectEvent = {
      project,
      previousProject,
      stepIndex: this.currentStepIndex,
      changedChannelIds,
      previousChannels,
      channels,
      positionMs: nextPositionMs,
      beat: preservedBeat,
    };
    this.emit("project", event);
    this.rescheduleIfPlaying();
  }

  getProject(): SequenceProject {
    this.assertLive();
    return this.project;
  }

  getCurrentStepIndex(): number {
    this.assertLive();
    return this.currentStepIndex;
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
      beat: positionMs / this.getMsPerBeat(this.project),
    };
  }

  /**
   * Sample every track's value at the engine's current logical position,
   * interpolating between the active step and the next.
   *
   * @param easing - Easing curve applied to the interpolation phase between
   *   steps. Defaults to {@link linear}.
   * @returns A record of trackId → 0–1 value; disabled tracks sample to 0.
   */
  sampleChannels(easing: EasingFunction = linear): Record<string, number> {
    this.assertLive();
    return this.sampleProjectChannels(this.project, this.getLogicalPositionMs(), easing);
  }

  /**
   * Sample every track's value at an arbitrary logical position, without
   * affecting playback state. Useful for scrubbing/preview UIs.
   *
   * @param timeMs - Logical position, in ms, to sample at; must be finite
   *   and non-negative.
   * @param easing - Easing curve applied to the interpolation phase between
   *   steps. Defaults to {@link linear}.
   * @returns A record of trackId → 0–1 value; disabled tracks sample to 0.
   * @throws {RangeError} if `timeMs` is not finite or is negative.
   */
  sampleChannelsAt(timeMs: number, easing: EasingFunction = linear): Record<string, number> {
    this.assertLive();
    assertFiniteNonNegative(timeMs, "timeMs");
    return this.sampleProjectChannels(this.project, timeMs, easing);
  }

  private runTransportCommand(
    expectedEventType: PlaybackTransportEvent["type"],
    command: () => Promise<void>,
  ): Promise<void> {
    this.pendingCommandEvents.push(expectedEventType);
    const markerIndex = this.pendingCommandEvents.length - 1;

    const clearPendingCommand = (): void => {
      if (this.pendingCommandEvents[markerIndex] === expectedEventType) {
        this.pendingCommandEvents.splice(markerIndex, 1);
      } else {
        const staleIndex = this.pendingCommandEvents.indexOf(expectedEventType);
        if (staleIndex >= 0) {
          this.pendingCommandEvents.splice(staleIndex, 1);
        }
      }
    };

    try {
      return command().finally(clearPendingCommand);
    } catch (error) {
      clearPendingCommand();
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
      this.emitPlayback(event.type, cause, previousState);
      if (previousState === "stopped" || previousState === "ended") {
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
      this.currentStepIndex = 0;
      this.lastEmittedAbsoluteStep = null;
      this.cachedPositionMs = 0;
      this.emitPlayback(event.type, cause, previousState);
      return;
    }

    if (event.type === "seek") {
      this.clearTimer();
      this.emitPlayback(event.type, cause, previousState);
      this.emitStepForPosition(this.getLogicalPositionMs(), "seek");
      this.rescheduleIfPlaying();
      return;
    }

    if (event.type === "loop") {
      // The transport wraps its reported position at each loop boundary, so the
      // absolute step counter must be re-anchored here — otherwise emitDueSteps'
      // monotonicity guard (see below) would permanently suppress further steps
      // once the wrapped position drops back below the pre-loop maximum.
      this.clearTimer();
      this.emitPlayback(event.type, cause, previousState);
      this.emitStepForPosition(this.getLogicalPositionMs(), "loop");
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
    this.cachedPositionMs = this.positionFromTransportPosition(snapshot.positionMs);
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
    this.playbackState = snapshot.state;
    this.buffering = snapshot.buffering;
    this.cachedPositionMs = this.positionFromTransportPosition(snapshot.positionMs);
    this.currentStepIndex = this.stepIndexAt(this.cachedPositionMs);
  }

  private scheduleNextTick(): void {
    if (this.playbackState !== "playing" || this.buffering || this.transportDisposed) {
      return;
    }

    this.clearTimer();
    const positionMs = this.getLogicalPositionMs();
    const stepDurationMs = this.getStepDurationMs();
    const absoluteStep = this.absoluteStepAt(positionMs);
    const phaseMs = positionMs - absoluteStep * stepDurationMs;
    const alreadyEmitted = this.lastEmittedAbsoluteStep === absoluteStep;
    const untilNextStepMs = phaseMs <= 0.000_001 && alreadyEmitted
      ? stepDurationMs
      : Math.max(0, stepDurationMs - phaseMs);
    const rate = this.transportDisposed ? 1 : this.transport.getPlaybackRate();
    const delayMs = Math.max(0, Math.min(this.lookaheadMs, untilNextStepMs / rate));

    this.transportTimerId = setTimeout(() => this.tick(), delayMs);
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

    this.emitDueSteps(this.getLogicalPositionMs());
    this.scheduleNextTick();
  }

  private emitDueSteps(positionMs: number): void {
    const absoluteStep = this.absoluteStepAt(positionMs);
    const last = this.lastEmittedAbsoluteStep;
    if (last !== null && absoluteStep <= last) {
      return;
    }

    if (last === null || this.missedStepPolicy === "skip") {
      this.emitStepAtAbsolute(absoluteStep, "tick", positionMs);
      return;
    }

    for (let next = last + 1; next <= absoluteStep; next += 1) {
      this.emitStepAtAbsolute(next, "tick", positionMs);
    }
  }

  private emitStepForPosition(positionMs: number, cause: StepEventCause): void {
    const absoluteStep = this.absoluteStepAt(positionMs);
    this.emitStepAtAbsolute(absoluteStep, cause, positionMs, positionMs);
  }

  private emitStepAtAbsolute(
    absoluteStep: number,
    cause: StepEventCause,
    transportPositionMs: number,
    scheduledPositionMs = absoluteStep * this.getStepDurationMs(),
  ): void {
    this.currentStepIndex = this.normalizeStepIndex(absoluteStep);
    this.lastEmittedAbsoluteStep = absoluteStep;
    const nextIndex = this.normalizeStepIndex(this.currentStepIndex + 1);
    const durationMs = this.getStepDurationMs();
    const event: StepEvent = {
      stepIndex: this.currentStepIndex,
      bpm: this.project.bpm,
      scheduledPositionMs,
      transportPositionMs,
      lateByMs: Math.max(0, transportPositionMs - scheduledPositionMs),
      durationMs,
      cause,
      tracks: this.project.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        enabled: track.enabled,
        value: track.enabled ? track.steps[this.currentStepIndex] ?? 0 : 0,
        nextValue: track.enabled ? track.steps[nextIndex] ?? 0 : 0,
      })),
    };
    this.emit("step", event);
  }

  private emitPlayback(
    type: EnginePlaybackEvent["type"],
    cause: EnginePlaybackEvent["cause"],
    previousState: PlaybackState,
    error?: unknown,
  ): void {
    const baseSnapshot = this.createPlaybackSnapshot();
    const event: SequencerPlaybackEvent = {
      type,
      cause,
      previousState,
      snapshot: {
        ...baseSnapshot,
        stepIndex: this.currentStepIndex,
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
      beat: positionMs / this.getMsPerBeat(this.project),
      playbackRate: transportSnapshot?.playbackRate ?? 1,
      projectLoop: true,
      transportLoop: transportSnapshot?.loop ?? false,
      buffering: this.buffering,
    };
  }

  private getLogicalPositionMs(): number {
    if (this.transportDisposed || this.buffering) {
      return this.cachedPositionMs;
    }
    return this.positionFromTransportPosition(this.getTransportPositionMs());
  }

  private getTransportPositionMs(): number {
    if (this.transportDisposed) {
      return this.cachedPositionMs;
    }
    return this.transport.getPositionMs();
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

  private sampleProjectChannels(
    project: SequenceProject,
    positionMs: number,
    easing: EasingFunction = linear,
  ): Record<string, number> {
    const stepDur = this.getStepDurationMs(project);
    const absoluteStep = this.absoluteStepAt(positionMs, project);
    const phase = positionMs <= 0 ? 0 : (positionMs % stepDur) / stepDur;
    const stepCount = Math.max(1, project.stepCount);

    const result: Record<string, number> = {};
    for (const track of project.tracks) {
      if (!track.enabled) {
        result[track.id] = 0;
        continue;
      }
      const idx = ((absoluteStep % stepCount) + stepCount) % stepCount;
      const nextIdx = (idx + 1) % stepCount;
      result[track.id] = lerp(track.steps[idx] ?? 0, track.steps[nextIdx] ?? 0, easing(phase));
    }
    return result;
  }

  private getChangedChannelIds(
    previousChannels: Record<string, number>,
    channels: Record<string, number>,
  ): string[] {
    return [...new Set([...Object.keys(previousChannels), ...Object.keys(channels)])].filter(
      (channelId) => previousChannels[channelId] !== channels[channelId],
    );
  }

  private absoluteStepAt(positionMs: number, project = this.project): number {
    return Math.max(0, Math.floor(positionMs / this.getStepDurationMs(project)));
  }

  private stepIndexAt(positionMs: number): number {
    return this.normalizeStepIndex(this.absoluteStepAt(positionMs));
  }

  private getMsPerBeat(project: SequenceProject): number {
    return 60_000 / project.bpm;
  }

  private getStepDurationMs(project = this.project): number {
    return this.getMsPerBeat(project) / project.stepsPerBeat;
  }

  private normalizeStepIndex(stepIndex: number): number {
    const stepCount = Math.max(1, this.project.stepCount);
    return ((Math.trunc(stepIndex) % stepCount) + stepCount) % stepCount;
  }

  private emit<TEventName extends SequencerEventName>(
    eventName: TEventName,
    event: SequencerEventMap[TEventName],
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
      throw new PlaybackError("TRANSPORT_DISPOSED", "SequencerEngine has been disposed.");
    }
  }
}
