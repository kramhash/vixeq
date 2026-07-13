import {
  browserClock,
  createClockTransport,
  createProject,
  createTimelineProject,
  setStepValue,
  SequencerEngine,
  TimelineEngine,
  type PlaybackTransportEvent,
} from "@vixeq/core";
import { bindChannelsToElement } from "@vixeq/core/dom";

// A shared PlaybackTransport driving both engines is the harness's whole
// point: R3's "shared-Engine synchronization" gate needs one clock feeding
// a SequencerEngine (continuous channel output) and a TimelineEngine
// (sparse cue dispatch) at once, exactly as website-pulse does with a real
// audio transport.
const DURATION_MS = 4000;

let sequenceProject = createProject({ bpm: 120, stepCount: 16, trackCount: 1 });
const trackId = sequenceProject.tracks[0]!.id;
for (const stepIndex of [0, 4, 8, 12]) {
  sequenceProject = setStepValue(sequenceProject, trackId, stepIndex, 1);
}

const timelineProject = createTimelineProject({
  timing: { bpm: 120 },
  durationBeats: 8,
  events: [
    { id: "cue-start", trackId: null, beat: 0, type: "marker", data: { label: "start" } },
    { id: "cue-mid", trackId: null, beat: 4, type: "marker", data: { label: "mid" } },
  ],
});

const transport = createClockTransport(browserClock, { durationMs: DURATION_MS, loop: false });

const state = {
  errors: [] as string[],
  transportEvents: [] as string[],
  lastCue: null as { label: unknown; positionMs: number } | null,
};

const engine = new SequencerEngine(sequenceProject, {
  transport,
  onListenerError: (error) => state.errors.push(String(error)),
});

const timeline = new TimelineEngine(timelineProject, {
  transport,
  onCue: (event) => {
    const data = event.event.data as { label?: unknown } | undefined;
    state.lastCue = { label: data?.label, positionMs: event.transportPositionMs };
  },
  onListenerError: (error) => state.errors.push(String(error)),
});

transport.subscribe((event: PlaybackTransportEvent) => {
  state.transportEvents.push(event.type);
  if (event.type === "error") state.errors.push(String(event.error));
});

const channelTarget = document.getElementById("channel-target") as HTMLElement;

type CallResult = { ok: true } | { ok: false; error: string };

async function safeCall(fn: () => Promise<void> | void): Promise<CallResult> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    if (error instanceof Error) {
      // PlaybackError carries a machine-readable `code` (e.g.
      // "TRANSPORT_DISPOSED") in addition to its human-readable message;
      // surface both so tests can assert on the stable code.
      const code = (error as Error & { code?: string }).code;
      return { ok: false, error: code ? `${error.name}[${code}]: ${error.message}` : `${error.name}: ${error.message}` };
    }
    return { ok: false, error: String(error) };
  }
}

const harness = {
  trackId,
  play: () => safeCall(() => transport.play()),
  pause: () => safeCall(() => transport.pause()),
  stop: () => safeCall(() => transport.stop()),
  seekMs: (positionMs: number) => safeCall(() => transport.seekMs(positionMs)),
  setPlaybackRate: (rate: number) => safeCall(() => transport.setPlaybackRate(rate)),
  setLoop: (loop: boolean) => safeCall(() => transport.setLoop(loop)),
  dispose: () => safeCall(() => transport.dispose()),
  getSnapshot: () => transport.getSnapshot(),
  // Recomputes channel output for the transport's current position and
  // writes it to `#channel-target` as CSS custom properties, mirroring how
  // website-pulse drives its hero visuals via bindChannelsToElement.
  sample: () => {
    const values = engine.sampleChannels();
    bindChannelsToElement(channelTarget, values, { [trackId]: "--channel-value" });
    return values;
  },
  getSequencerPosition: () => engine.getPosition(),
  getTimelinePosition: () => timeline.getPosition(),
  getLastCue: () => state.lastCue,
  getTransportEvents: () => state.transportEvents.slice(),
  getErrors: () => state.errors.slice(),
};

declare global {
  interface Window {
    __h: typeof harness;
  }
}

window.__h = harness;
