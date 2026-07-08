import { browserClock } from "../clock";
import { linear, type EasingFunction } from "../easing";
import { normalizeArrangement } from "./project";
import { validateArrangement } from "./project";
import {
  arrangementDurationBeats,
  resolveArrangementStep,
  sampleArrangement,
  unionTrackIds,
  type ResolvedArrangementStep,
} from "./resolve";
import type { PlaybackClock, StepEvent, Unsubscribe } from "../types";
import type {
  ArrangementEventHandler,
  ArrangementEventMap,
  ArrangementEventName,
  ArrangementProject,
  ArrangementSection,
} from "./types";

export type ArrangementEngineOptions = {
  clock?: PlaybackClock;
  /** Max ms between polls while playing. Default 25. */
  lookaheadMs?: number;
  /** Absolute ms that corresponds to beat 0. Omit to anchor on first start(). */
  originMs?: number;
  /** Repeat from beat 0 at the arrangement end. Default false. */
  loop?: boolean;
  onStep?: ArrangementEventHandler<"step">;
  onSection?: ArrangementEventHandler<"section">;
};

/**
 * Plays an ArrangementProject: resolves which section (and which step
 * within that section's pattern) is active at the current time, and
 * emits `step`/`section` events as the active position crosses
 * boundaries. Always time-driven (position is derived from the clock,
 * not incremented) so seek/scrub/audio-sync are correct by construction —
 * there is no increment-mode counterpart, unlike SequencerEngine.
 *
 * Implements the same public shape as SequencerEngine's ChannelSource
 * subset (`on("step", ...)`, `sampleChannels`, `start`/`stop`/`reset`/
 * `isPlaying`/`dispose`), so existing consumers like useAnimatedChannels
 * and bindChannelsToElement work unmodified.
 */
export class ArrangementEngine {
  private arrangement: ArrangementProject;
  private trackIds: string[];
  private readonly clock: PlaybackClock;
  private readonly lookaheadMs: number;
  private msPerBeat: number;
  private readonly loop: boolean;
  private readonly listeners: {
    [TEventName in ArrangementEventName]: Set<ArrangementEventHandler<TEventName>>;
  };
  private originMs: number;
  private anchored: boolean;
  private pausedBeat = 0;
  private paused = false;
  private playing = false;
  private currentSection: ArrangementSection | null = null;
  private lastSectionId: string | null | undefined = undefined;
  private lastEmittedKey: string | null = null;
  private timerId: unknown;

  constructor(arrangement: ArrangementProject, options: ArrangementEngineOptions = {}) {
    this.assertValid(arrangement);
    this.arrangement = normalizeArrangement(arrangement);
    this.trackIds = unionTrackIds(this.arrangement);
    this.clock = options.clock ?? browserClock;
    this.lookaheadMs = options.lookaheadMs ?? 25;
    this.msPerBeat = 60_000 / this.arrangement.bpm;
    this.loop = options.loop ?? false;
    this.originMs = options.originMs ?? 0;
    this.anchored = options.originMs !== undefined;
    this.listeners = {
      step: new Set(),
      transport: new Set(),
      section: new Set(),
    };

    if (options.onStep) {
      this.on("step", options.onStep);
    }
    if (options.onSection) {
      this.on("section", options.onSection);
    }
  }

  on<TEventName extends ArrangementEventName>(
    eventName: TEventName,
    handler: ArrangementEventHandler<TEventName>,
  ): Unsubscribe {
    this.listeners[eventName].add(handler as never);

    return () => {
      this.listeners[eventName].delete(handler as never);
    };
  }

  start(): void {
    if (this.playing) {
      return;
    }

    const now = this.clock.now();
    if (!this.anchored) {
      this.originMs = now - this.pausedBeat * this.msPerBeat;
      this.anchored = true;
    } else if (this.paused) {
      this.originMs = now - this.pausedBeat * this.msPerBeat;
    }
    this.paused = false;
    this.playing = true;
    this.lastSectionId = undefined;
    this.lastEmittedKey = null;
    this.emit("transport", { type: "start", timestamp: now });
    this.tick();
  }

  stop(): void {
    if (!this.playing) {
      return;
    }

    this.pausedBeat = this.beatAt(this.clock.now());
    this.paused = true;
    this.playing = false;
    this.clearTimer();
    this.emit("transport", { type: "stop", timestamp: this.clock.now() });
  }

  /** Rewinds to beat 0. Use seek(beat) to move to an arbitrary position. */
  reset(): void {
    const now = this.clock.now();
    this.originMs = now;
    this.anchored = true;
    this.pausedBeat = 0;
    this.paused = !this.playing;
    this.lastSectionId = undefined;
    this.lastEmittedKey = null;
    this.emit("transport", { type: "reset", beat: 0, timestamp: now });
    this.emitPosition(now, 0, true);
  }

  seek(beat: number): void {
    if (!Number.isFinite(beat) || beat < 0) {
      throw new RangeError("Seek beat must be a finite, non-negative number.");
    }
    const now = this.clock.now();
    this.originMs = now - beat * this.msPerBeat;
    this.anchored = true;
    this.pausedBeat = beat;
    this.paused = !this.playing;
    this.lastSectionId = undefined;
    this.lastEmittedKey = null;
    this.emit("transport", { type: "seek", beat, timestamp: now });
    this.emitPosition(now, beat, true);
  }

  dispose(): void {
    this.stop();
    this.listeners.step.clear();
    this.listeners.transport.clear();
    this.listeners.section.clear();
  }

  getArrangement(): ArrangementProject {
    return this.arrangement;
  }

  /** Atomically replaces arrangement data while preserving the current beat. */
  setArrangement(arrangement: ArrangementProject): void {
    this.assertValid(arrangement);
    const now = this.clock.now();
    const beat = this.anchored ? this.beatAt(now) : this.pausedBeat;
    this.arrangement = normalizeArrangement(arrangement);
    this.trackIds = unionTrackIds(this.arrangement);
    this.msPerBeat = 60_000 / this.arrangement.bpm;
    this.originMs = now - beat * this.msPerBeat;
    this.anchored = true;
    this.pausedBeat = beat;
    this.paused = !this.playing;
    this.lastSectionId = undefined;
    this.lastEmittedKey = null;
    this.emitPosition(now, beat, true);
  }

  getCurrentSection(): ArrangementSection | null {
    return this.currentSection;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Sample the interpolated 0-1 value for every track (union across all
   * patterns) at an arbitrary absolute timestamp. Works regardless of
   * playing state — same contract as SequencerEngine.sampleChannels.
   */
  sampleChannels(timeMs: number, easing: EasingFunction = linear): Record<string, number> {
    return sampleArrangement(this.arrangement, this.normalizeLoopBeat(this.beatAt(timeMs)), easing, this.trackIds);
  }

  private beatAt(timeMs: number): number {
    return (timeMs - this.originMs) / this.msPerBeat;
  }

  private tick(): void {
    if (!this.playing) {
      return;
    }

    const now = this.clock.now();
    const beat = this.beatAt(now);
    const duration = arrangementDurationBeats(this.arrangement);
    if (!this.loop && beat >= duration) {
      this.pausedBeat = duration;
      this.playing = false;
      this.clearTimer();
      this.emitPosition(now, duration, false);
      this.emit("transport", { type: "end", timestamp: now });
      return;
    }
    this.emitPosition(now, this.normalizeLoopBeat(beat), false);
    this.timerId = this.clock.setTimer(() => this.tick(), this.lookaheadMs);
  }

  private emitPosition(now: number, beat: number, force: boolean): void {
    const resolved = resolveArrangementStep(this.arrangement, beat);
    const sectionId = resolved ? resolved.section.id : null;

    if (force || sectionId !== this.lastSectionId) {
      this.lastSectionId = sectionId;
      this.currentSection = resolved?.section ?? null;
      this.emit("section", { section: this.currentSection, timestamp: now });
    }

    const stepKey = resolved ? `${resolved.section.id}:${resolved.stepIndex}` : null;
    if (force || stepKey !== this.lastEmittedKey) {
      this.lastEmittedKey = stepKey;
      if (resolved) {
        this.emitStep(resolved, now);
      }
    }

  }

  private normalizeLoopBeat(beat: number): number {
    if (!this.loop) return beat;
    const duration = arrangementDurationBeats(this.arrangement);
    return duration > 0 ? ((beat % duration) + duration) % duration : beat;
  }

  private assertValid(arrangement: ArrangementProject): void {
    const result = validateArrangement(arrangement);
    if (!result.ok) {
      throw new TypeError(`Invalid arrangement: ${result.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    }
  }

  private emitStep(resolved: ResolvedArrangementStep, timestamp: number): void {
    const pattern = this.arrangement.patterns[resolved.section.patternId];
    const durationMs = this.msPerBeat / pattern.stepsPerBeat;
    const positionMs = this.beatAt(timestamp) * this.msPerBeat;
    const event: StepEvent = {
      stepIndex: resolved.stepIndex,
      bpm: this.arrangement.bpm,
      timestamp,
      scheduledPositionMs: positionMs,
      transportPositionMs: positionMs,
      lateByMs: 0,
      durationMs,
      cause: "tick",
      tracks: pattern.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        enabled: track.enabled,
        value: track.enabled ? track.steps[resolved.stepIndex] ?? 0 : 0,
        nextValue: track.enabled ? track.steps[resolved.nextStepIndex] ?? 0 : 0,
      })),
    };
    this.emit("step", event);
  }

  private emit<TEventName extends ArrangementEventName>(
    eventName: TEventName,
    event: ArrangementEventMap[TEventName],
  ): void {
    for (const handler of this.listeners[eventName]) {
      handler(event as never);
    }
  }

  private clearTimer(): void {
    if (this.timerId !== undefined) {
      this.clock.clearTimer(this.timerId);
      this.timerId = undefined;
    }
  }
}
