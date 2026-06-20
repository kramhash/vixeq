import { useCallback, useEffect, useRef, useState } from "react";
import { VixeqLogo } from "./VixeqLogo";
import { SequencePlayer } from "@vixeq/player-react";
import type { SequencePlayerRef } from "@vixeq/player-react";
import type { SequenceProject, StepEvent, TransportEvent } from "@vixeq/core";
import { brandProject } from "./brandProject";
import { useSmoothedChannels, type SmoothedSvgValues } from "./useSmoothedChannels";

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

type SvgProps = {
  values: SmoothedSvgValues;
};

const BrandMark = ({ values }: SvgProps) => {
  const { ring, inner, stroke, arm } = values;
  const outerR = 90 + ring * 14;
  const innerR = 48 + inner * 12;
  const sw = 2 + stroke * 6;
  const armAngle = arm * 60;

  return (
    <svg viewBox="0 0 240 240" width="240" height="240" aria-hidden="true">
      {/* outer ring */}
      <circle
        cx="120" cy="120" r={outerR}
        fill="none"
        stroke="var(--c-ring)"
        strokeWidth={sw}
        opacity={0.4 + ring * 0.6}
      />
      {/* mid ring */}
      <circle
        cx="120" cy="120" r={68}
        fill="none"
        stroke="var(--c-mid)"
        strokeWidth={1 + stroke * 3}
        strokeDasharray={`${8 + stroke * 16} ${12 - stroke * 4}`}
        opacity={0.5 + inner * 0.5}
      />
      {/* inner fill */}
      <circle
        cx="120" cy="120" r={innerR}
        fill="var(--c-inner)"
        opacity={0.1 + inner * 0.25}
      />
      {/* accent arm */}
      <line
        x1="120" y1="120"
        x2={120 + Math.cos((armAngle - 90) * (Math.PI / 180)) * 76}
        y2={120 + Math.sin((armAngle - 90) * (Math.PI / 180)) * 76}
        stroke="var(--c-arm)"
        strokeWidth={2 + arm * 4}
        strokeLinecap="round"
        opacity={0.6 + arm * 0.4}
      />
      {/* center dot */}
      <circle cx="120" cy="120" r={5 + ring * 4} fill="var(--c-center)" />
      {/* tick marks */}
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
        const r1 = outerR + 6;
        const r2 = r1 + (i % 4 === 0 ? 10 : 5);
        return (
          <line
            key={i}
            x1={120 + Math.cos(a) * r1} y1={120 + Math.sin(a) * r1}
            x2={120 + Math.cos(a) * r2} y2={120 + Math.sin(a) * r2}
            stroke="var(--c-tick)"
            strokeWidth={i % 4 === 0 ? 2 : 1}
            opacity={0.3 + stroke * 0.5}
          />
        );
      })}
    </svg>
  );
};

const STATIC_VALUES: SmoothedSvgValues = { ring: 0, inner: 0, stroke: 0, arm: 0 };

export const App = () => {
  const [project, setProject] = useState<SequenceProject>(brandProject);
  const [editorOpen, setEditorOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const [svgValues, setSvgValues] = useState<SmoothedSvgValues>(STATIC_VALUES);
  const [latestEvent, setLatestEvent] = useState<StepEvent | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const playerRef = useRef<SequencePlayerRef>(null);

  const handleStep = useCallback((e: StepEvent) => {
    setLatestEvent(e);
  }, []);

  const handleTransportChange = useCallback((e: TransportEvent) => {
    if (e.type === "start") setIsPlaying(true);
    if (e.type === "stop") setIsPlaying(false);
  }, []);

  const onFrame = useCallback((v: SmoothedSvgValues) => {
    setSvgValues({ ...v });
  }, []);

  useSmoothedChannels(latestEvent, reducedMotion, onFrame);

  useEffect(() => {
    if (!reducedMotion) playerRef.current?.play();
    return () => playerRef.current?.stop();
  }, [reducedMotion]);

  const displayValues = reducedMotion ? STATIC_VALUES : svgValues;

  return (
    <div className="app">
      <header className="site-nav">
        <div className="nav-logo">
          <VixeqLogo height={26} />
          <span className="logo-sub">SVG example</span>
        </div>
        <nav className="nav-links">
          <a href="#">Docs</a>
          <a href="#">Examples</a>
          <a href="#">GitHub</a>
        </nav>
      </header>

      <main className="hero">
        <div className="hero-content">
          <p className="hero-eyebrow">Step sequencer engine for the web</p>
          <h1 className="hero-headline">
            Data-driven<br />brand graphics.
          </h1>
          <p className="hero-body">
            Every line, radius and opacity of this SVG is driven by
            the same vixeq clock. The choreography is a <code>SequenceProject</code>&nbsp;—
            open the editor to change it live. The arm uses continuous interpolation
            (<code>value → nextValue</code> with easing) while the rings use impulse-decay envelopes.
          </p>
          <div className="hero-actions">
            <button className="btn-primary" onClick={() => playerRef.current?.toggle()}>
              {isPlaying ? "Stop" : "Play"}
            </button>
            <button className="btn-secondary" onClick={() => setEditorOpen((o) => !o)}>
              {editorOpen ? "Close editor" : "Edit choreography"}
            </button>
          </div>
        </div>

        <div className="svg-stage">
          <BrandMark values={displayValues} />
          <div className="svg-readout">
            {(["ring", "inner", "stroke", "arm"] as const).map((key) => (
              <div key={key} className="readout-row">
                <span className="readout-label">{key}</span>
                <span className="readout-bar">
                  <span
                    className="readout-fill"
                    style={{ width: `${(displayValues[key] * 100).toFixed(1)}%` }}
                  />
                </span>
                <span className="readout-value">{displayValues[key].toFixed(3)}</span>
              </div>
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

      <div className="editor-panel" hidden={!editorOpen}>
        <div className="editor-panel__header">
          <span>Choreography editor</span>
          <small>Edit steps — the SVG responds in real time</small>
        </div>
        <SequencePlayer
          ref={playerRef}
          project={project}
          onProjectChange={({ project: p }) => setProject(p)}
          onStep={handleStep}
          onTransportChange={handleTransportChange}
        />
        <div className="track-legend">
          <span style={{ "--legend-color": "var(--c-ring)" } as React.CSSProperties}>Track 1 → Outer ring</span>
          <span style={{ "--legend-color": "var(--c-mid)" } as React.CSSProperties}>Track 2 → Inner fill</span>
          <span style={{ "--legend-color": "var(--c-arm)" } as React.CSSProperties}>Track 3 → Stroke width</span>
          <span style={{ "--legend-color": "var(--c-center)" } as React.CSSProperties}>Track 4 → Arm angle</span>
        </div>
      </div>
    </div>
  );
};
