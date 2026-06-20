import { useEffect, useRef } from "react";
import { clamp01, decaySmoothedValue, exciteSmoothedValue, type StepEvent } from "@vixeq/core";

type Channels = {
  beat: number;
  cta: number;
  eq: number;
  mood: number;
};

const CONFIGS = {
  // Sharp punch-and-drop: high impact, fast decay
  beat: { decayRate: 4.5, impact: 1.0, lift: 0 },
  // CTA: punchy but softer
  cta:  { decayRate: 3.0, impact: 0.85, lift: 0 },
  // EQ bars: very fast snappy decay
  eq:   { decayRate: 7.0, impact: 0.9, lift: 0 },
  // Mood: slow smooth swell
  mood: { decayRate: 1.0, impact: 0.5, lift: 0.02 },
} as const;

const makeChannels = (): Channels => ({ beat: 0, cta: 0, eq: 0, mood: 0 });

export const useSmoothedChannels = (
  rootRef: React.RefObject<HTMLElement | null>,
  latestEvent: StepEvent | null,
  reducedMotion: boolean,
) => {
  const envelopeRef = useRef<Channels>(makeChannels());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Excite envelopes on each step event
  useEffect(() => {
    if (latestEvent === null) return;
    const [v0, v1, v2, v3] = latestEvent.tracks.map((t) => (t.enabled ? t.value : 0));
    const env = envelopeRef.current;
    envelopeRef.current = {
      beat: exciteSmoothedValue(env.beat, v0, CONFIGS.beat),
      cta:  exciteSmoothedValue(env.cta,  v1, CONFIGS.cta),
      eq:   exciteSmoothedValue(env.eq,   v2, CONFIGS.eq),
      mood: exciteSmoothedValue(env.mood, v3, CONFIGS.mood),
    };
  }, [latestEvent]);

  // rAF loop: decay + write CSS vars to DOM
  useEffect(() => {
    if (reducedMotion) return;

    const tick = (now: number) => {
      const dt = lastTimeRef.current === 0 ? 0 : (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      const env = envelopeRef.current;
      envelopeRef.current = {
        beat: clamp01(decaySmoothedValue(env.beat, dt, CONFIGS.beat)),
        cta:  clamp01(decaySmoothedValue(env.cta,  dt, CONFIGS.cta)),
        eq:   clamp01(decaySmoothedValue(env.eq,   dt, CONFIGS.eq)),
        mood: clamp01(decaySmoothedValue(env.mood, dt, CONFIGS.mood)),
      };

      const el = rootRef.current;
      if (el) {
        const { beat, cta, eq, mood } = envelopeRef.current;
        el.style.setProperty("--pulse-beat", beat.toFixed(4));
        el.style.setProperty("--pulse-cta",  cta.toFixed(4));
        el.style.setProperty("--pulse-eq",   eq.toFixed(4));
        el.style.setProperty("--pulse-mood", mood.toFixed(4));
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = 0;
    };
  }, [rootRef, reducedMotion]);
};
