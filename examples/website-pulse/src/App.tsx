import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VixeqMark } from "./VixeqMark";
import { SequencePlayer } from "@vixeq/player-react";
import type { SequencePlayerRef } from "@vixeq/player-react";
import {
  createAudioBufferTransport,
  createDecayEnvelope,
  type SequenceProject,
  type SequencerEngine,
  type PlaybackTransport,
  type SequencerPlaybackEvent,
} from "@vixeq/core";
import { bindChannelsToElement } from "@vixeq/core/dom";
import { useAnimatedChannels, useTimeline } from "@vixeq/react";
import {
  brandProject,
  brandTimelineDurationMs,
  brandTimelineProject,
  brandTrackIds,
  initialCaption,
  initialSceneCue,
  type WebsitePulseTimelineEvent,
} from "./brandProject";

const EQ_AMPLITUDES = [0.65, 0.95, 0.8, 1.0, 0.75, 0.9, 0.6];

// Smoothing configs — same values as the previous useSmoothedChannels for visual parity
const ENVELOPE_CONFIGS = {
  beat: { decayRate: 4.5, impact: 1.0, lift: 0 },
  cta:  { decayRate: 3.0, impact: 0.85, lift: 0 },
  eq:   { decayRate: 7.0, impact: 0.9, lift: 0 },
  mood: { decayRate: 1.0, impact: 0.5, lift: 0.02 },
} as const;

const CSS_MAPPING = {
  [brandTrackIds.beat]: "--pulse-beat",
  [brandTrackIds.cta]:  "--pulse-cta",
  [brandTrackIds.eq]:   "--pulse-eq",
  [brandTrackIds.mood]: "--pulse-mood",
};

type TimelineControlApi = {
  seekPositionMs: (positionMs: number) => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
  setTransportLoop: (loop: boolean) => Promise<void>;
};

const formatTime = (positionMs: number) => `${(positionMs / 1000).toFixed(2)}s`;

type TimelineLayerProps = {
  transport: PlaybackTransport;
  playbackRate: number;
  fullShowLoop: boolean;
  onCue: (event: WebsitePulseTimelineEvent) => void;
  onPosition: (positionMs: number) => void;
  onError: (message: string | null) => void;
  onControls: (controls: TimelineControlApi | null) => void;
};

const TimelineLayer = ({
  transport,
  playbackRate,
  fullShowLoop,
  onCue,
  onPosition,
  onError,
  onControls,
}: TimelineLayerProps) => {
  const timeline = useTimeline<WebsitePulseTimelineEvent>({
    project: brandTimelineProject,
    transport,
    onCue: (event) => onCue(event.event),
    onPosition: (position) => onPosition(position.positionMs),
    onProjectError: (error) => onError(error.message),
    onTransportError: (error) => onError(error instanceof Error ? error.message : String(error)),
  });

  useEffect(() => {
    onControls({
      seekPositionMs: timeline.seekPositionMs,
      setPlaybackRate: timeline.setPlaybackRate,
      setTransportLoop: timeline.setTransportLoop,
    });
    return () => onControls(null);
  }, [onControls, timeline.seekPositionMs, timeline.setPlaybackRate, timeline.setTransportLoop]);

  useEffect(() => {
    const message = timeline.projectError?.message
      ?? (timeline.transportError instanceof Error ? timeline.transportError.message : null);
    onError(message);
  }, [onError, timeline.projectError, timeline.transportError]);

  useEffect(() => {
    void timeline.setPlaybackRate(playbackRate).catch((error) => {
      onError(error instanceof Error ? error.message : String(error));
    });
  }, [onError, playbackRate, timeline.setPlaybackRate]);

  useEffect(() => {
    void timeline.setTransportLoop(fullShowLoop).catch((error) => {
      onError(error instanceof Error ? error.message : String(error));
    });
  }, [fullShowLoop, onError, timeline.setTransportLoop]);

  return null;
};

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
};

export const App = () => {
  const [project, setProject] = useState<SequenceProject>(brandProject);
  const [editorOpen, setEditorOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [transport, setTransport] = useState<PlaybackTransport | null>(null);
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);
  const [activeScene, setActiveScene] = useState(initialSceneCue);
  const [caption, setCaption] = useState(initialCaption);
  const [timelinePositionMs, setTimelinePositionMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [fullShowLoop, setFullShowLoop] = useState(false);
  const [timelineControlsReady, setTimelineControlsReady] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<SequencePlayerRef>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const transportRef = useRef<PlaybackTransport | null>(null);
  const timelineControlsRef = useRef<TimelineControlApi | null>(null);

  // Decode the demo loop once; playback is coordinated through vixeq transport.
  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    fetch(`${import.meta.env.BASE_URL}demo-loop.wav`)
      .then((response) => response.arrayBuffer())
      .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        if (cancelled) return;
        const nextTransport = createAudioBufferTransport(ctx, buffer, { loop: false });
        transportRef.current = nextTransport;
        setTransport(nextTransport);
      })
      .catch((error) => {
        if (!cancelled) {
          setTransportError(error instanceof Error ? error.message : "Unable to load demo audio.");
        }
      });

    return () => {
      cancelled = true;
      transportRef.current?.dispose?.();
      transportRef.current = null;
      void ctx.close();
      ctxRef.current = null;
    };
  }, []);

  const handlePlaybackChange = useCallback((e: SequencerPlaybackEvent) => {
    setIsPlaying(e.snapshot.state === "playing");
  }, []);

  const handleTimelineCue = useCallback((event: WebsitePulseTimelineEvent) => {
    if (event.type === "scene" && event.data) {
      setActiveScene(event.data);
      const el = rootRef.current;
      if (el) {
        el.style.setProperty("--scene-accent", event.data.accent);
      }
      return;
    }

    if (event.type === "caption" && event.data) {
      setCaption(event.data.caption);
    }
  }, []);

  const handleTimelineControls = useCallback((controls: TimelineControlApi | null) => {
    timelineControlsRef.current = controls;
    setTimelineControlsReady(controls !== null);
  }, []);

  // Create one envelope per channel; stable for the component's lifetime.
  const envelopes = useMemo(
    () => ({
      [brandTrackIds.beat]: createDecayEnvelope(ENVELOPE_CONFIGS.beat),
      [brandTrackIds.cta]:  createDecayEnvelope(ENVELOPE_CONFIGS.cta),
      [brandTrackIds.eq]:   createDecayEnvelope(ENVELOPE_CONFIGS.eq),
      [brandTrackIds.mood]: createDecayEnvelope(ENVELOPE_CONFIGS.mood),
    }),
    [],
  );

  // Engine exposed by <SequencePlayer> for zero-re-render direct subscription.
  const [engine, setEngine] = useState<SequencerEngine | null>(null);

  // Write envelope values to CSS custom properties every animation frame.
  // Engine direct subscription avoids per-step React re-renders.
  useAnimatedChannels(engine, {
    envelopes,
    motionPreference: reducedMotion ? "reduce" : "no-preference",
    onFrame: (values) => {
      const el = rootRef.current;
      if (el) {
        bindChannelsToElement(el, values, CSS_MAPPING);
      }
    },
  });

  const handlePlay = useCallback(async () => {
    if (!playerRef.current) return;
    setIsBusy(true);
    setTransportError(null);
    try {
      await playerRef.current.play();
    } catch (error) {
      setTransportError(error instanceof Error ? error.message : "Unable to start audio playback.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handlePause = useCallback(async () => {
    if (!playerRef.current) return;
    setTransportError(null);
    try {
      await playerRef.current.pause();
    } catch (error) {
      setTransportError(error instanceof Error ? error.message : "Unable to pause audio playback.");
    }
  }, []);

  const handleStop = useCallback(async () => {
    if (!playerRef.current) return;
    setTransportError(null);
    try {
      await playerRef.current.stop();
    } catch (error) {
      setTransportError(error instanceof Error ? error.message : "Unable to stop audio playback.");
    }
  }, []);

  const handleToggle = useCallback(async () => {
    if (isPlaying) {
      await handlePause();
    } else {
      await handlePlay();
    }
  }, [isPlaying, handlePause, handlePlay]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const ctx = ctxRef.current;
    if (!file || !ctx) return;

    await handleStop();

    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      transportRef.current?.dispose?.();
      const nextTransport = createAudioBufferTransport(ctx, buffer, { loop: false });
      transportRef.current = nextTransport;
      setTransport(nextTransport);
      setShouldAutoPlay(true);
    } catch (error) {
      setTransportError(error instanceof Error ? error.message : "Unable to decode audio file.");
    }
  }, [handleStop]);

  const handleScrubChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextPositionMs = Number(e.target.value);
    setTimelinePositionMs(nextPositionMs);
    setTimelineError(null);
    try {
      await timelineControlsRef.current?.seekPositionMs(nextPositionMs);
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : "Unable to seek show timeline.");
    }
  }, []);

  const handlePlaybackRateChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextRate = Number(e.target.value);
    setPlaybackRate(nextRate);
    setTimelineError(null);
    try {
      await timelineControlsRef.current?.setPlaybackRate(nextRate);
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : "Unable to change playback rate.");
    }
  }, []);

  const handleFullShowLoopChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextLoop = e.target.checked;
    setFullShowLoop(nextLoop);
    setTimelineError(null);
    try {
      await timelineControlsRef.current?.setTransportLoop(nextLoop);
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : "Unable to change full-show loop.");
    }
  }, []);

  useEffect(() => {
    if (!transport || !shouldAutoPlay) return;
    setShouldAutoPlay(false);
    void handlePlay();
  }, [handlePlay, shouldAutoPlay, transport]);

  const displayError = transportError ?? timelineError;

  return (
    <div
      className="app"
      ref={rootRef}
      data-scene={activeScene.scene}
      style={{ "--scene-accent": activeScene.accent } as React.CSSProperties}
    >
      {transport && (
        <TimelineLayer
          transport={transport}
          playbackRate={playbackRate}
          fullShowLoop={fullShowLoop}
          onCue={handleTimelineCue}
          onPosition={setTimelinePositionMs}
          onError={setTimelineError}
          onControls={handleTimelineControls}
        />
      )}
      <header className="site-nav">
        <span className="nav-brand">
          <VixeqMark size={120} />
        </span>
        <nav className="nav-links">
          <a href="#">Schedule</a>
          <a href="#">Artists</a>
          <a href="#">Venue</a>
        </nav>
      </header>

      <main className="hero">

        <div className="hero-content">
          <p className="event-meta">
            <span>SAT 14 NOV 2026</span>
            <span className="meta-sep">·</span>
            <span>WAREHOUSE 23, TOKYO</span>
          </p>

          <h1 className="event-title">
            RESONANCE<br />
            <span className="title-accent">2026</span>
          </h1>

          <p className="event-sub">
            An eight-hour live electronic performance. Every light,
            projection and pulse on this page is driven by the same
            BPM clock — channels from a <code>SequenceProject</code>,
            cues from a <code>TimelineProject</code>.
          </p>

          <div className="live-cue" aria-live="polite">
            <div className="live-cue__meta">
              <span className="live-cue__scene">{activeScene.label}</span>
              <span>{formatTime(timelinePositionMs)} / {formatTime(brandTimelineDurationMs)}</span>
            </div>
            <p>{caption}</p>
          </div>

          <div className="hero-actions">
            <button
              className="btn-primary"
              onClick={handleToggle}
              disabled={!transport || isBusy}
            >
              {isBusy ? "Working..." : isPlaying ? "Pause" : "Play"}
            </button>
            <button
              className="btn-secondary"
              onClick={handleStop}
              disabled={!transport || isBusy}
            >
              Stop
            </button>
            <button
              className="btn-secondary"
              onClick={() => setEditorOpen((o) => !o)}
            >
              {editorOpen ? "Close editor" : "Edit choreography"}
            </button>
          </div>

          <div className="show-controls">
            <label className="show-control show-control--scrub">
              <span>Scrub</span>
              <input
                type="range"
                min={0}
                max={brandTimelineDurationMs}
                step={25}
                value={Math.min(timelinePositionMs, brandTimelineDurationMs)}
                onChange={handleScrubChange}
                disabled={!timelineControlsReady || isBusy}
              />
            </label>
            <label className="show-control">
              <span>Rate</span>
              <select
                value={playbackRate}
                onChange={handlePlaybackRateChange}
                disabled={!timelineControlsReady || isBusy}
              >
                <option value={0.75}>0.75x</option>
                <option value={1}>1x</option>
                <option value={1.25}>1.25x</option>
              </select>
            </label>
            <label className="show-control show-control--loop">
              <input
                type="checkbox"
                checked={fullShowLoop}
                onChange={handleFullShowLoopChange}
                disabled={!timelineControlsReady || isBusy}
              />
              <span>Full-show loop</span>
            </label>
          </div>

          <label className="audio-file-label">
            <span>Load your own track</span>
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              className="audio-file-input"
            />
          </label>

          {displayError && (
            <p className="audio-error" role="alert">
              {displayError}
            </p>
          )}
        </div>

        <div className="hero-visual">
          <div className="beat-disk">
            <span className="beat-ring beat-ring--outer" />
            <span className="beat-ring beat-ring--mid" />
            <span className="beat-ring beat-ring--inner" />
            <span className="beat-core" />
          </div>

          <div className="eq-bars" aria-hidden="true">
            {EQ_AMPLITUDES.map((amp, i) => (
              <span
                key={i}
                className="eq-bar"
                style={{ "--bar-amp": amp } as React.CSSProperties}
              />
            ))}
          </div>
        </div>

      </main>

      {reducedMotion && (
        <div className="reduced-motion-notice" role="status">
          Motion paused — reduced-motion preference detected.
          <button onClick={handlePlay}>Play anyway</button>
        </div>
      )}

      <div className="editor-panel" hidden={!editorOpen}>
        <div className="editor-panel__header">
          <span>Choreography editor</span>
          <small>Edit steps — the page responds in real time</small>
        </div>
        {transport && (
          <SequencePlayer
            ref={playerRef}
            project={project}
            onProjectChange={({ project: p }) => setProject(p)}
            onEngineChange={setEngine}
            onPlaybackChange={handlePlaybackChange}
            transport={transport}
            showTransportControls={false}
          />
        )}
        <div className="track-legend">
          <span style={{ "--legend-color": "var(--c-beat)" } as React.CSSProperties}>
            Track 1 → Kick (hero pulse)
          </span>
          <span style={{ "--legend-color": "var(--c-cta)" } as React.CSSProperties}>
            Track 2 → CTA glow
          </span>
          <span style={{ "--legend-color": "var(--c-eq)" } as React.CSSProperties}>
            Track 3 → Visualizer
          </span>
          <span style={{ "--legend-color": "var(--c-mood)" } as React.CSSProperties}>
            Track 4 → Mood color
          </span>
        </div>
      </div>

    </div>
  );
};
