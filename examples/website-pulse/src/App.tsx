import { useCallback, useEffect, useRef, useState } from "react";
import { VixeqMark } from "./VixeqMark";
import { SequencePlayer } from "@vixeq/player-react";
import type { SequencePlayerRef } from "@vixeq/player-react";
import {
  createAudioBufferTransport,
  type SequenceProject,
  type SequencerTransport,
  type StepEvent,
  type TransportEvent,
} from "@vixeq/core";
import { brandProject } from "./brandProject";
import { useSmoothedChannels } from "./useSmoothedChannels";

const EQ_AMPLITUDES = [0.65, 0.95, 0.8, 1.0, 0.75, 0.9, 0.6];

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
  const [latestEvent, setLatestEvent] = useState<StepEvent | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [transport, setTransport] = useState<SequencerTransport | null>(null);
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<SequencePlayerRef>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const transportRef = useRef<SequencerTransport | null>(null);

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
        const nextTransport = createAudioBufferTransport(ctx, buffer, { loop: true });
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

  const handleStep = useCallback((e: StepEvent) => {
    setLatestEvent(e);
  }, []);

  const handleTransportChange = useCallback((e: TransportEvent) => {
    if (e.type === "start") setIsPlaying(true);
    if (e.type === "stop") setIsPlaying(false);
  }, []);

  useSmoothedChannels(rootRef, latestEvent, reducedMotion);

  const handlePlay = useCallback(async () => {
    if (!playerRef.current) return;
    setIsStarting(true);
    setTransportError(null);
    try {
      await playerRef.current.play();
    } catch (error) {
      setTransportError(error instanceof Error ? error.message : "Unable to start audio playback.");
    } finally {
      setIsStarting(false);
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
      await handleStop();
    } else {
      await handlePlay();
    }
  }, [isPlaying, handlePlay, handleStop]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const ctx = ctxRef.current;
    if (!file || !ctx) return;

    await handleStop();

    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      transportRef.current?.dispose?.();
      const nextTransport = createAudioBufferTransport(ctx, buffer, { loop: true });
      transportRef.current = nextTransport;
      setTransport(nextTransport);
      setShouldAutoPlay(true);
    } catch (error) {
      setTransportError(error instanceof Error ? error.message : "Unable to decode audio file.");
    }
  }, [handleStop]);

  useEffect(() => {
    if (!transport || !shouldAutoPlay) return;
    setShouldAutoPlay(false);
    void handlePlay();
  }, [handlePlay, shouldAutoPlay, transport]);

  return (
    <div className="app" ref={rootRef}>
      <header className="site-nav">
        <span className="nav-brand">
          <VixeqMark size={16} />
          VIXEQ
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
            BPM clock — choreographed as a <code>SequenceProject</code>.
          </p>

          <div className="hero-actions">
            <button
              className="btn-primary"
              onClick={handleToggle}
              disabled={!transport || isStarting}
            >
              {isStarting ? "Starting..." : isPlaying ? "Stop" : "Play"}
            </button>
            <button
              className="btn-secondary"
              onClick={() => setEditorOpen((o) => !o)}
            >
              {editorOpen ? "Close editor" : "Edit choreography"}
            </button>
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

          {transportError && (
            <p className="audio-error" role="alert">
              {transportError}
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
            onStep={handleStep}
            onTransportChange={handleTransportChange}
            transport={transport}
            timeDriven={true}
            originMs={0}
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
