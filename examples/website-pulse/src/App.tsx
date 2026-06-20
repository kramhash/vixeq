import { useCallback, useEffect, useRef, useState } from "react";
import { VixeqMark } from "./VixeqMark";
import { SequencePlayer } from "@vixeq/player-react";
import type { SequencePlayerRef } from "@vixeq/player-react";
import type { SequenceProject, StepEvent, TransportEvent } from "@vixeq/core";
import { brandProject } from "./brandProject";
import { useSmoothedChannels } from "./useSmoothedChannels";

// Per-bar amplitude factors for the EQ visualizer (7 bars)
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

  const rootRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<SequencePlayerRef>(null);

  const handleStep = useCallback((e: StepEvent) => {
    setLatestEvent(e);
  }, []);

  const handleTransportChange = useCallback((e: TransportEvent) => {
    if (e.type === "start") setIsPlaying(true);
    if (e.type === "stop") setIsPlaying(false);
  }, []);

  useSmoothedChannels(rootRef, latestEvent, reducedMotion);

  useEffect(() => {
    if (!reducedMotion) playerRef.current?.play();
    return () => playerRef.current?.stop();
  }, [reducedMotion]);

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

        {/* Left: event info */}
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
              onClick={() => playerRef.current?.toggle()}
            >
              {isPlaying ? "Stop" : "Play"}
            </button>
            <button
              className="btn-secondary"
              onClick={() => setEditorOpen((o) => !o)}
            >
              {editorOpen ? "Close editor" : "Edit choreography"}
            </button>
          </div>
        </div>

        {/* Right: beat disk + EQ bars */}
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
          <button onClick={() => playerRef.current?.play()}>Play anyway</button>
        </div>
      )}

      {/* Editor panel — always mounted, visually hidden when closed */}
      <div className="editor-panel" hidden={!editorOpen}>
        <div className="editor-panel__header">
          <span>Choreography editor</span>
          <small>Edit steps — the page responds in real time</small>
        </div>
        <SequencePlayer
          ref={playerRef}
          project={project}
          onProjectChange={({ project: p }) => setProject(p)}
          onStep={handleStep}
          onTransportChange={handleTransportChange}
        />
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
