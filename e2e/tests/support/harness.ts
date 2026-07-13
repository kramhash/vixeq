// Ambient type for `window.__h`, the control surface exposed by
// e2e/harness/src/main.ts. Kept in sync by hand — the harness is the only
// producer of this shape.
export type PlaybackState = "stopped" | "playing" | "paused" | "ended";

export type CallResult = { ok: true } | { ok: false; error: string };

export type HarnessSnapshot = {
  state: PlaybackState;
  positionMs: number;
  durationMs: number | null;
  playbackRate: number;
  loop: boolean;
  buffering: boolean;
};

export type HarnessCue = { label: unknown; positionMs: number } | null;

export type HarnessWindow = {
  trackId: string;
  play(): Promise<CallResult>;
  pause(): Promise<CallResult>;
  stop(): Promise<CallResult>;
  seekMs(positionMs: number): Promise<CallResult>;
  setPlaybackRate(rate: number): Promise<CallResult>;
  setLoop(loop: boolean): Promise<CallResult>;
  dispose(): Promise<CallResult>;
  getSnapshot(): HarnessSnapshot;
  sample(): Record<string, number>;
  getSequencerPosition(): { positionMs: number; beat: number };
  getTimelinePosition(): { positionMs: number; beat: number };
  getLastCue(): HarnessCue;
  getTransportEvents(): string[];
  getErrors(): string[];
};

declare global {
  interface Window {
    __h: HarnessWindow;
  }
}
