import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  PlaybackError,
  type ChannelSource,
  type EasingFunction,
  type Envelope,
} from "@vixeq/core";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export type MotionPreference = "system" | "reduce" | "no-preference";

export type AnimatedChannelsOptions = {
  /**
   * Map of trackId `->` Envelope. Envelope trigger/sample positions use the
   * engine's logical transport position, not rAF or wall-clock timestamps.
   */
  envelopes?: Record<string, Envelope>;

  /**
   * Easing function for interpolation mode (no envelopes).
   * Passed to engine.sampleChannels(). Default: linear.
   */
  easing?: EasingFunction;

  /**
   * Motion preference. Default "system" follows prefers-reduced-motion.
   */
  motionPreference?: MotionPreference;

  /**
   * Called with current channel values when the hook samples.
   * Ideal for direct DOM writes without triggering React re-renders.
   */
  onFrame?: (values: Record<string, number>) => void;
};

const resetAll = (envelopes: Record<string, Envelope> | undefined): void => {
  if (!envelopes) return;
  for (const envelope of Object.values(envelopes)) {
    envelope.reset();
  }
};

const isDisposedSourceError = (error: unknown): boolean =>
  error instanceof PlaybackError && error.code === "TRANSPORT_DISPOSED";

/**
 * Runs a requestAnimationFrame loop that samples channel values without React
 * state updates. Interpolation mode samples the ChannelSource directly.
 * Envelope mode triggers from StepEvent.scheduledPositionMs and samples at
 * engine.getPosition().positionMs so pause, seek, and external media stay in
 * the same logical transport domain.
 */
export function useAnimatedChannels(
  engine: ChannelSource | null,
  options: AnimatedChannelsOptions = {},
): MutableRefObject<Record<string, number>> {
  const { envelopes, easing, motionPreference = "system", onFrame } = options;
  const systemReducedMotion = usePrefersReducedMotion();
  const reducedMotion = motionPreference === "reduce" || (motionPreference === "system" && systemReducedMotion);

  const valuesRef = useRef<Record<string, number>>({});
  const engineRef = useRef(engine);
  const envelopesRef = useRef(envelopes);
  const easingRef = useRef(easing);
  const onFrameRef = useRef(onFrame);
  const rafRef = useRef<number>(0);

  useEffect(() => { engineRef.current = engine; }, [engine]);
  useEffect(() => { envelopesRef.current = envelopes; }, [envelopes]);
  useEffect(() => { easingRef.current = easing; }, [easing]);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

  const sampleCurrent = useCallback((): boolean => {
    const eng = engineRef.current;
    if (!eng) return false;

    const envs = envelopesRef.current;
    let values: Record<string, number>;

    try {
      if (envs) {
        const positionMs = eng.getPosition().positionMs;
        values = {};
        for (const trackId of Object.keys(envs)) {
          values[trackId] = envs[trackId]!.sample(positionMs);
        }
      } else {
        values = eng.sampleChannels(easingRef.current);
      }
    } catch (error) {
      if (isDisposedSourceError(error)) {
        if (engineRef.current === eng) {
          engineRef.current = null;
        }
        return false;
      }
      throw error;
    }

    valuesRef.current = values;
    onFrameRef.current?.(values);
    return true;
  }, []);

  useEffect(() => {
    if (!engine || !envelopes || reducedMotion) return;

    try {
      const offStep = engine.on("step", (event) => {
        const envs = envelopesRef.current;
        if (!envs) return;

        for (const track of event.tracks) {
          const envelope = envs[track.id];
          if (envelope && track.enabled) {
            envelope.trigger(event.scheduledPositionMs, track.value);
          }
        }
      });

      return () => {
        offStep();
      };
    } catch (error) {
      if (isDisposedSourceError(error)) return;
      throw error;
    }
  }, [engine, envelopes, reducedMotion]);

  useEffect(() => {
    if (!engine) return;

    let offPlayback: (() => void) | undefined;
    try {
      offPlayback = engine.on("playback", (event) => {
        if (event.type === "seek" || event.type === "stop") {
          resetAll(envelopesRef.current);
          if (reducedMotion) {
            sampleCurrent();
          }
        }
      });

      const offProject = engine.on("project", (event) => {
        const envs = envelopesRef.current;
        if (envs) {
          for (const channelId of event.changedChannelIds) {
            envs[channelId]?.reset();
          }
        }
        if (reducedMotion) {
          sampleCurrent();
        }
      });

      return () => {
        offPlayback?.();
        offProject();
      };
    } catch (error) {
      offPlayback?.();
      if (isDisposedSourceError(error)) return;
      throw error;
    }
  }, [engine, reducedMotion, sampleCurrent]);

  useEffect(() => {
    if (!reducedMotion) return;
    sampleCurrent();
  }, [reducedMotion, engine, envelopes, easing, sampleCurrent]);

  useEffect(() => {
    if (reducedMotion) return;

    const tick = () => {
      if (sampleCurrent()) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [reducedMotion, engine, envelopes, easing, sampleCurrent]);

  return valuesRef;
}
