import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDecayEnvelope,
  createMediaElementTransport,
  sectionAtBeat,
  type PlaybackClock,
  type PlaybackTransport,
} from "@vixeq/core";
import { bindChannelsToElement } from "@vixeq/core/dom";
import { useAnimatedChannels, useArrangement } from "@vixeq/react";
import { TRACK_IDS } from "./patterns";
import { BEAT_SECONDS, SECTION_LABELS, TOTAL_BEATS, arrangement } from "./arrangement";

// Same "impulse and decay" pattern as examples/website-pulse, applied to an
// arrangement instead of a single looping pattern.
const ENVELOPE_CONFIGS = {
  pulse: { decayRate: 4.0, impact: 1.0, lift: 0.03 },
  glow: { decayRate: 2.2, impact: 0.85, lift: 0.04 },
  burst: { decayRate: 8.5, impact: 1.0, lift: 0 },
} as const;

const CSS_MAPPING = {
  [TRACK_IDS.pulse]: "--arr-pulse",
  [TRACK_IDS.glow]: "--arr-glow",
  [TRACK_IDS.burst]: "--arr-burst",
};

export const App = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const [clock, setClock] = useState<PlaybackClock | null>(null);
  const [transport, setTransport] = useState<PlaybackTransport | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [displaySeconds, setDisplaySeconds] = useState(0);

  // The <audio> element is the transport. Playback v2 exposes media control
  // through PlaybackTransport; until ArrangementEngine consumes transports
  // directly, adapt its position into the PlaybackClock the engine polls.
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const mediaTransport = createMediaElementTransport(audioEl, { audioContext: ctx });
    const mediaClock: PlaybackClock = {
      now: () => mediaTransport.getPositionMs(),
      setTimer(callback, delayMs) {
        return setTimeout(callback, Math.max(0, delayMs));
      },
      clearTimer(timerId) {
        clearTimeout(timerId as ReturnType<typeof setTimeout>);
      },
    };

    setTransport(mediaTransport);
    setClock(mediaClock);

    return () => {
      mediaTransport.dispose();
      void ctx.close();
      ctxRef.current = null;
      setTransport(null);
      setClock(null);
    };
  }, []);

  const { engine } = useArrangement({
    arrangement,
    clock: clock ?? undefined,
    loop: true,
  });

  // Envelope mode: engine "step" events (correctly timed off the audio
  // clock) trigger per-track envelopes; the rAF loop samples and decays
  // them independently. This sidesteps a real pitfall — interpolation mode
  // (sampleChannels(rafNow)) assumes the engine's clock and rAF's
  // timestamp share a time domain, which is true for the default
  // browserClock but NOT for an audio-driven clock like this one.
  const envelopes = useMemo(
    () => ({
      [TRACK_IDS.pulse]: createDecayEnvelope(ENVELOPE_CONFIGS.pulse),
      [TRACK_IDS.glow]: createDecayEnvelope(ENVELOPE_CONFIGS.glow),
      [TRACK_IDS.burst]: createDecayEnvelope(ENVELOPE_CONFIGS.burst),
    }),
    [],
  );

  useAnimatedChannels(engine, {
    envelopes,
    onFrame: (values) => {
      const el = rootRef.current;
      if (el) {
        bindChannelsToElement(el, values, CSS_MAPPING);
      }
    },
  });

  // Drives the progress bar / active-section label straight from the
  // <audio> element's own currentTime — correct whether playing or paused,
  // and independent of whether the engine is currently polling.
  useEffect(() => {
    const id = setInterval(() => {
      const audioEl = audioRef.current;
      if (audioEl) {
        setDisplaySeconds(audioEl.currentTime);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  const activeSection = sectionAtBeat(arrangement, displaySeconds / BEAT_SECONDS);
  const activeLabel = activeSection ? SECTION_LABELS[activeSection.section.id] : "—";

  const handleToggle = useCallback(async () => {
    if (!transport || !engine) return;

    if (isPlaying) {
      await transport.pause();
      engine.stop();
      setIsPlaying(false);
    } else {
      await transport.play();
      engine.start();
      setIsPlaying(true);
    }
  }, [isPlaying, engine, transport]);

  const handleJump = useCallback((startBeat: number) => {
    if (!transport) return;
    const nextSeconds = startBeat * BEAT_SECONDS;
    void transport.seekMs(nextSeconds * 1000);
    setDisplaySeconds(nextSeconds);
  }, [transport]);

  const progressPct = (displaySeconds / (TOTAL_BEATS * BEAT_SECONDS)) * 100;

  return (
    <div className="app" ref={rootRef}>
      <header className="app-header">
        <h1>Arrangement demo</h1>
        <p>
          One song, four sections, two patterns. <code>ArrangementEngine</code> resolves which
          pattern is active from the audio's playback position — seek, and the visuals + section
          label jump with it.
        </p>
      </header>

      <div className="stage">
        <div className="stage-visual" aria-hidden="true">
          <span className="stage-pulse" />
          <span className="stage-glow" />
          <span className="stage-burst" />
        </div>

        <div className="stage-info">
          <span className="section-badge" data-section={activeSection?.section.id ?? "gap"}>
            {activeLabel}
          </span>
          <button className="btn-primary" onClick={handleToggle} disabled={!transport || !clock}>
            {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
      </div>

      <div className="timeline">
        <div className="timeline-track">
          <div className="timeline-progress" style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }} />
          {arrangement.sections.map((section) => (
            <button
              key={section.id}
              className="timeline-marker"
              style={{
                left: `${(section.startBeat / TOTAL_BEATS) * 100}%`,
                width: `${((section.endBeat - section.startBeat) / TOTAL_BEATS) * 100}%`,
              }}
              onClick={() => handleJump(section.startBeat)}
              title={`Jump to ${SECTION_LABELS[section.id]} (beat ${section.startBeat})`}
            >
              {SECTION_LABELS[section.id]}
            </button>
          ))}
        </div>
      </div>

      <audio ref={audioRef} src="/demo-loop.wav" loop preload="auto" />
    </div>
  );
};
