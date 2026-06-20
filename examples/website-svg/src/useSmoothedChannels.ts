import { useEffect, useRef } from "react";
import {
  clamp01,
  decaySmoothedValue,
  easeInOutCubic,
  exciteSmoothedValue,
  lerp,
  type StepEvent,
} from "@vixeq/core";

type Channels = {
  ring: number;
  inner: number;
  stroke: number;
  arm: number;
};

const CONFIGS = {
  ring:   { decayRate: 2.0, impact: 0.6,  lift: 0.04 },
  inner:  { decayRate: 3.2, impact: 0.75, lift: 0.05 },
  stroke: { decayRate: 7.0, impact: 0.85, lift: 0.03 },
} as const;

const makeChannels = (): Channels => ({ ring: 0, inner: 0, stroke: 0, arm: 0 });

export type SmoothedSvgValues = Channels;

export const useSmoothedChannels = (
  latestEvent: StepEvent | null,
  reducedMotion: boolean,
  onFrame: (values: SmoothedSvgValues) => void,
) => {
  const envelopeRef = useRef<Channels>(makeChannels());
  const latestEventRef = useRef<StepEvent | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (latestEvent === null) return;
    latestEventRef.current = latestEvent;

    const [v0, v1, v2] = latestEvent.tracks.map((t) => (t.enabled ? t.value : 0));
    const env = envelopeRef.current;
    envelopeRef.current = {
      ...env,
      ring:   exciteSmoothedValue(env.ring,   v0, CONFIGS.ring),
      inner:  exciteSmoothedValue(env.inner,  v1, CONFIGS.inner),
      stroke: exciteSmoothedValue(env.stroke, v2, CONFIGS.stroke),
    };
  }, [latestEvent]);

  useEffect(() => {
    if (reducedMotion) return;

    let rafId = 0;
    let lastTime = 0;

    const tick = (now: number) => {
      const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
      lastTime = now;

      const env = envelopeRef.current;
      const event = latestEventRef.current;

      // ring, inner, stroke: excite-and-decay envelopes (impulse response)
      envelopeRef.current = {
        ...env,
        ring:   clamp01(decaySmoothedValue(env.ring,   dt, CONFIGS.ring)),
        inner:  clamp01(decaySmoothedValue(env.inner,  dt, CONFIGS.inner)),
        stroke: clamp01(decaySmoothedValue(env.stroke, dt, CONFIGS.stroke)),
        // arm: continuous interpolation from value → nextValue using easeInOutCubic
        arm: (() => {
          if (!event) return env.arm;
          const track = event.tracks[3];
          if (!track || !track.enabled) return 0;
          const phase = clamp01((now - event.timestamp) / event.durationMs);
          return lerp(track.value, track.nextValue, easeInOutCubic(phase));
        })(),
      };

      onFrameRef.current({ ...envelopeRef.current });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [reducedMotion]);
};
