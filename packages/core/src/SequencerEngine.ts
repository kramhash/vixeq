import { browserClock } from "./clock";
import { linear, lerp, type EasingFunction } from "./easing";
import { SEQUENCER_LIMITS } from "./limits";
import { clamp } from "./project";
import { normalizeProject } from "./validation";
import type {
  ProjectEvent,
  SequenceProject,
  PlaybackClock,
  SequencerEngineOptions,
  SequencerEventHandler,
  SequencerEventMap,
  SequencerEventName,
  StepEvent,
  TransportEvent,
  Unsubscribe,
} from "./types";

export class SequencerEngine {
  private project: SequenceProject;
  private readonly clock: PlaybackClock;
  private readonly lookaheadMs: number;
  private readonly listeners: {
    [TEventName in SequencerEventName]: Set<SequencerEventHandler<TEventName>>;
  };
  private readonly missedStepPolicy: "emit" | "skip";
  private readonly timeDriven: boolean;
  private originMs: number;
  private lastEmittedAbsoluteStep: number | null = null;
  private timerId: unknown;
  private playing = false;
  private currentStepIndex = 0;
  private nextStepAt = 0;

  constructor(project: SequenceProject, options: SequencerEngineOptions = {}) {
    this.project = normalizeProject(project);
    this.clock = options.clock ?? browserClock;
    this.lookaheadMs = options.lookaheadMs ?? 25;
    this.missedStepPolicy = options.missedStepPolicy ?? "emit";
    this.timeDriven = options.timeDriven ?? false;
    this.originMs = options.originMs ?? 0;
    this.listeners = {
      step: new Set(),
      transport: new Set(),
      project: new Set(),
    };

    if (options.onStep) {
      this.on("step", options.onStep);
    }
  }

  on<TEventName extends SequencerEventName>(
    eventName: TEventName,
    handler: SequencerEventHandler<TEventName>,
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
    this.playing = true;
    if (this.timeDriven) {
      this.lastEmittedAbsoluteStep = null;
    } else {
      this.nextStepAt = now;
    }
    this.emitTransport({ type: "start", bpm: this.project.bpm, stepIndex: this.currentStepIndex, timestamp: now });
    this.tick();
  }

  stop(): void {
    if (!this.playing) {
      return;
    }

    this.playing = false;
    this.clearTimer();
    this.emitTransport({
      type: "stop",
      bpm: this.project.bpm,
      stepIndex: this.currentStepIndex,
      timestamp: this.clock.now(),
    });
  }

  reset(stepIndex = 0): void {
    this.currentStepIndex = this.normalizeStepIndex(stepIndex);
    if (this.timeDriven) {
      this.originMs = this.clock.now() - this.currentStepIndex * this.getStepDurationMs();
      this.lastEmittedAbsoluteStep = null;
    } else if (this.playing) {
      this.nextStepAt = this.clock.now();
    }

    this.emitTransport({
      type: "reset",
      bpm: this.project.bpm,
      stepIndex: this.currentStepIndex,
      timestamp: this.clock.now(),
    });
  }

  dispose(): void {
    this.stop();
    this.listeners.step.clear();
    this.listeners.transport.clear();
    this.listeners.project.clear();
  }

  setBpm(bpm: number): void {
    const previousBpm = this.project.bpm;
    const nextBpm = clamp(bpm, SEQUENCER_LIMITS.minBpm, SEQUENCER_LIMITS.maxBpm);
    if (previousBpm === nextBpm) {
      return;
    }

    this.project = { ...this.project, bpm: nextBpm };
    if (this.playing) {
      this.nextStepAt = this.clock.now() + this.getStepDurationMs();
    }
    this.emitTransport({
      type: "bpm",
      bpm: nextBpm,
      previousBpm,
      stepIndex: this.currentStepIndex,
      timestamp: this.clock.now(),
    });
  }

  setProject(project: SequenceProject): void {
    const previousProject = this.project;
    const nextProject = normalizeProject(project);
    this.project = nextProject;
    this.currentStepIndex = this.normalizeStepIndex(this.currentStepIndex);

    const event: ProjectEvent = {
      project: nextProject,
      previousProject,
      stepIndex: this.currentStepIndex,
      timestamp: this.clock.now(),
    };
    this.emit("project", event);
  }

  getProject(): SequenceProject {
    return this.project;
  }

  getCurrentStepIndex(): number {
    return this.currentStepIndex;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Sample the interpolated 0–1 value for each track at an arbitrary absolute timestamp.
   * Uses linear easing by default; pass a custom EasingFunction to change the curve.
   * Works regardless of whether timeDriven is enabled.
   */
  sampleChannels(timeMs: number, easing: EasingFunction = linear): Record<string, number> {
    const stepDur = this.getStepDurationMs();
    const elapsed = timeMs - this.originMs;
    const absoluteStep = elapsed <= 0 ? 0 : Math.floor(elapsed / stepDur);
    const phase = elapsed <= 0 ? 0 : (elapsed % stepDur) / stepDur;
    const stepCount = Math.max(1, this.project.stepCount);

    const result: Record<string, number> = {};
    for (const track of this.project.tracks) {
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

  private tick(): void {
    if (!this.playing) {
      return;
    }

    if (this.timeDriven) {
      this.tickTimeDriven();
    } else {
      this.tickIncrement();
    }
  }

  private tickTimeDriven(): void {
    const now = this.clock.now();
    const stepDur = this.getStepDurationMs();
    const elapsed = now - this.originMs;

    let delay: number;

    if (elapsed >= 0) {
      const absoluteStep = Math.floor(elapsed / stepDur);
      const last = this.lastEmittedAbsoluteStep;

      if (last === null || absoluteStep !== last) {
        this.currentStepIndex = this.normalizeStepIndex(absoluteStep);
        this.emitStep(now);
        this.lastEmittedAbsoluteStep = absoluteStep;
      }

      // Schedule next poll at the start of the next step boundary
      const phaseMs = elapsed % stepDur;
      const msUntilNextStep = stepDur - phaseMs;
      delay = Math.max(0, Math.min(this.lookaheadMs, msUntilNextStep));
    } else {
      // Before origin: wait until origin
      delay = Math.min(this.lookaheadMs, -elapsed);
    }

    this.timerId = this.clock.setTimer(() => this.tickTimeDriven(), delay);
  }

  private tickIncrement(): void {
    const now = this.clock.now();
    if (now >= this.nextStepAt) {
      this.emitDueSteps(now);
    }

    const delay = Math.max(0, Math.min(this.lookaheadMs, this.nextStepAt - this.clock.now()));
    this.timerId = this.clock.setTimer(() => this.tickIncrement(), delay);
  }

  private emitDueSteps(now: number): void {
    if (this.missedStepPolicy === "skip" && now > this.nextStepAt + this.getStepDurationMs()) {
      const missedSteps = Math.floor((now - this.nextStepAt) / this.getStepDurationMs());
      this.currentStepIndex = this.normalizeStepIndex(this.currentStepIndex + missedSteps);
      this.nextStepAt += missedSteps * this.getStepDurationMs();
    }

    while (now >= this.nextStepAt) {
      const timestamp = this.nextStepAt;
      this.emitStep(timestamp);
      this.currentStepIndex = this.normalizeStepIndex(this.currentStepIndex + 1);
      this.nextStepAt += this.getStepDurationMs();

      if (this.missedStepPolicy === "skip") {
        break;
      }
    }
  }

  private emitStep(timestamp: number): void {
    const nextIndex = this.normalizeStepIndex(this.currentStepIndex + 1);
    const durationMs = this.getStepDurationMs();
    const event: StepEvent = {
      stepIndex: this.currentStepIndex,
      bpm: this.project.bpm,
      timestamp,
      durationMs,
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

  private getStepDurationMs(): number {
    return 60_000 / this.project.bpm / this.project.stepsPerBeat;
  }

  private normalizeStepIndex(stepIndex: number): number {
    const stepCount = Math.max(1, this.project.stepCount);
    return ((Math.trunc(stepIndex) % stepCount) + stepCount) % stepCount;
  }

  private emitTransport(event: TransportEvent): void {
    this.emit("transport", event);
  }

  private emit<TEventName extends SequencerEventName>(
    eventName: TEventName,
    event: SequencerEventMap[TEventName],
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
