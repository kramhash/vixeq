import { useEffect, useRef, type MutableRefObject } from "react";
import {
  type ChannelSource,
  type EasingFunction,
  type Envelope,
  type StepEvent,
} from "@vixeq/core";

export type AnimatedChannelsOptions = {
  /**
   * Map of trackId → Envelope. When provided, the hook runs in envelope mode:
   * each envelope is triggered on step events and sampled every animation frame.
   * Tip: create these with useMemo so their identity stays stable.
   */
  envelopes?: Record<string, Envelope>;

  /**
   * Easing function for interpolation mode (no envelopes).
   * Passed to engine.sampleChannels(). Default: linear.
   */
  easing?: EasingFunction;

  /**
   * When true, the requestAnimationFrame loop does not run and the ref
   * retains its last value. Use with prefers-reduced-motion.
   */
  reducedMotion?: boolean;

  /**
   * Called every animation frame with the current channel values.
   * Ideal for direct DOM writes (e.g. with bindChannelsToElement) — avoids
   * triggering React re-renders.
   */
  onFrame?: (values: Record<string, number>) => void;

  /**
   * External step-event source for envelope mode when the engine is not
   * directly accessible (e.g. when using SequencePlayer's onStep callback).
   * Ignored when an engine is provided.
   */
  latestEvent?: StepEvent | null;
};

/**
 * Runs a requestAnimationFrame loop that samples channel values every frame.
 *
 * Two modes:
 * - **Envelope mode** (`envelopes` option): step events excite each envelope;
 *   `envelope.sample(now)` is called every frame. Supports the "impulse and
 *   decay" pattern used in beat-driven visual choreography.
 * - **Interpolation mode** (default): calls `engine.sampleChannels(now, easing)`
 *   every frame for smooth lerp-based animation between step values.
 *
 * Returns a mutable ref whose `.current` holds the latest `{ trackId: number }`
 * map. Values are NOT stored in React state — use `onFrame` to push them to
 * the DOM (via `bindChannelsToElement`) without triggering re-renders.
 */
export function useAnimatedChannels(
  engine: ChannelSource | null,
  options: AnimatedChannelsOptions = {},
): MutableRefObject<Record<string, number>> {
  const { envelopes, easing, reducedMotion = false, onFrame, latestEvent } = options;

  const valuesRef = useRef<Record<string, number>>({});

  // Stable refs for all mutable options — avoids restarting effects on each render
  const engineRef = useRef(engine);
  const envelopesRef = useRef(envelopes);
  const easingRef = useRef(easing);
  const onFrameRef = useRef(onFrame);
  const rafRef = useRef<number>(0);

  useEffect(() => { engineRef.current = engine; }, [engine]);
  useEffect(() => { envelopesRef.current = envelopes; }, [envelopes]);
  useEffect(() => { easingRef.current = easing; }, [easing]);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

  // Subscribe to engine step events for envelope triggering.
  // Re-subscribes when engine identity changes (e.g. engine recreated).
  useEffect(() => {
    if (!engine || !envelopes) return;

    const off = engine.on("step", (event) => {
      const envs = envelopesRef.current;
      if (!envs) return;
      // Use performance.now() so the trigger timestamp is in the same domain
      // as the rAF `now` passed to sample() — required for time-based envelopes.
      const now = performance.now();
      for (const track of event.tracks) {
        const env = envs[track.id];
        if (env && track.enabled) {
          env.trigger(now, track.value);
        }
      }
    });

    return off;
  }, [engine, envelopes]);

  // Trigger envelopes from an external step event source.
  // Only active when engine is null (avoids double-triggering).
  useEffect(() => {
    if (engine !== null || !latestEvent || !envelopesRef.current) return;

    const envs = envelopesRef.current;
    // Use performance.now() so the trigger timestamp is in the same domain
    // as the rAF `now` passed to sample() — required for time-based envelopes.
    const now = performance.now();
    for (const track of latestEvent.tracks) {
      const env = envs[track.id];
      if (env && track.enabled) {
        env.trigger(now, track.value);
      }
    }
  }, [latestEvent, engine]);

  // requestAnimationFrame loop: sample values every frame.
  // Restarts when reducedMotion changes (false→true stops; true→false starts).
  useEffect(() => {
    if (reducedMotion) return;

    const tick = (now: number) => {
      const envs = envelopesRef.current;
      const eng = engineRef.current;

      let values: Record<string, number>;

      if (envs) {
        // Envelope mode: sample each envelope at the current timestamp
        values = {};
        for (const trackId of Object.keys(envs)) {
          values[trackId] = envs[trackId]!.sample(now);
        }
      } else if (eng) {
        // Interpolation mode: easing-interpolated step-to-step sampling
        values = eng.sampleChannels(now, easingRef.current);
      } else {
        // No source yet — keep the loop alive
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      valuesRef.current = values;
      onFrameRef.current?.(values);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [reducedMotion]);

  return valuesRef;
}
