import { createShaderBackground, glsl, type ShaderBackgroundInstance } from "@frapx/shader";
import { simplex3d } from "@frapx/shader-noise";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  createVisualEnvelope,
  decayEnvelope,
  exciteEnvelope,
  type VisualEnvelopeState,
} from "./visualEnvelope";
import type { VisualizerState } from "./visualizerState";

const fragment = glsl`
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_energy;
uniform float u_accent;
uniform float u_complexity;
uniform float u_stepPhase;
uniform float u_isPlaying;
uniform float u_colorPhase;
uniform float u_colorFlash;
uniform vec4 u_tracks;

${simplex3d}

float noise01(vec3 p) {
  return frapx_simplex3d(p) * 0.5 + 0.5;
}

float depthFbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;

  for (int i = 0; i < 5; i++) {
    value += amplitude * noise01(p);
    p = p * 2.03 + vec3(13.7, 7.1, 5.3);
    amplitude *= 0.52;
  }

  return value;
}

vec3 paletteScene(float phase, float band) {
  float scene = fract(phase) * 5.0;
  float index = floor(scene);
  float blend = smoothstep(0.0, 1.0, fract(scene));

  vec3 a0 = mix(vec3(0.00, 0.82, 0.94), vec3(1.00, 0.22, 0.72), band);
  vec3 a1 = mix(vec3(1.00, 0.62, 0.12), vec3(0.08, 0.78, 0.70), band);
  vec3 b0 = mix(vec3(0.58, 0.26, 1.00), vec3(0.72, 1.00, 0.12), band);
  vec3 b1 = mix(vec3(1.00, 0.28, 0.20), vec3(0.18, 0.54, 1.00), band);
  vec3 c0 = mix(vec3(0.12, 0.38, 1.00), vec3(1.00, 0.50, 0.08), band);
  vec3 c1 = mix(vec3(1.00, 0.16, 0.62), vec3(0.16, 0.92, 0.56), band);
  vec3 d0 = mix(vec3(0.00, 0.86, 0.48), vec3(0.14, 0.52, 1.00), band);
  vec3 d1 = mix(vec3(1.00, 0.24, 0.44), vec3(0.96, 0.74, 0.10), band);
  vec3 e0 = mix(vec3(1.00, 0.72, 0.08), vec3(0.62, 0.18, 1.00), band);
  vec3 e1 = mix(vec3(0.00, 0.92, 0.86), vec3(1.00, 0.32, 0.16), band);

  vec3 current = a0;
  vec3 next = b0;
  if (index < 1.0) {
    current = mix(a0, a1, band);
    next = mix(b0, b1, band);
  } else if (index < 2.0) {
    current = mix(b0, b1, band);
    next = mix(c0, c1, band);
  } else if (index < 3.0) {
    current = mix(c0, c1, band);
    next = mix(d0, d1, band);
  } else if (index < 4.0) {
    current = mix(d0, d1, band);
    next = mix(e0, e1, band);
  } else {
    current = mix(e0, e1, band);
    next = mix(a0, a1, band);
  }

  return mix(current, next, blend);
}

float circlePulse(vec2 p, float radius, float width) {
  return exp(-abs(length(p) - radius) / max(width, 0.001));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 centered = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

  float kick = u_energy;
  float flow = u_tracks.y;
  float flowSigned = flow * 2.0 - 1.0;
  float flowAmount = abs(flowSigned);
  float glowTrack = u_tracks.z;
  float colorShift = u_tracks.w;

  float pulse = 0.5 + 0.5 * sin(6.28318 * (u_time * 0.11 + u_stepPhase * 0.18));
  float beat = smoothstep(0.95, 1.0, pulse) * (0.08 + u_accent * 0.26 + glowTrack * 0.16);
  float depthSpeed = 0.08 + flowAmount * 0.62;
  float depthTravel = u_time * depthSpeed * flowSigned;
  float depthPressure = smoothstep(0.08, 0.78, flowAmount);
  float distortion = 0.07 + depthPressure * 0.34;
  float kickPressure = smoothstep(0.92, 0.0, length(centered)) * kick;
  float kickWave = circlePulse(centered, 0.16 + kick * 0.34, 0.035 + kick * 0.055) * kick;
  vec2 pressureCentered = centered * (1.0 - kick * 0.16);
  vec3 depthPosition = vec3(pressureCentered * 3.2, depthTravel);

  vec2 drift = vec2(
    depthFbm(depthPosition + vec3(0.0, 0.0, 0.0)),
    depthFbm(depthPosition + vec3(9.2, 4.7, 2.1))
  ) - 0.5;

  vec2 warped = pressureCentered + drift * distortion;
  float field = depthFbm(vec3(warped * (2.05 + u_complexity * 0.55), depthTravel + kick * 0.18));
  float secondaryField = depthFbm(vec3(warped * (5.6 + u_complexity * 2.4) + vec2(1.7, -0.8), depthTravel * 1.7 + 4.0));
  float rings = circlePulse(warped, 0.22 + glowTrack * 0.3 + depthPressure * 0.08, 0.03 + glowTrack * 0.06 + u_complexity * 0.012);
  float ringLines = sin(length(warped) * (17.0 + glowTrack * 9.0 + u_complexity * 5.0) - u_time * 1.3);
  float particles = smoothstep(0.82 - u_complexity * 0.12, 0.98, secondaryField + glowTrack * 0.12) * glowTrack;
  float liquid = smoothstep(0.25, 0.88, field + ringLines * 0.045 + kickPressure * 0.14);

  vec3 deep = vec3(0.025, 0.045, 0.055);
  vec3 amber = vec3(1.0, 0.62, 0.18);
  float palettePhase = fract(u_colorPhase + field * 0.08 + secondaryField * 0.04);
  vec3 primaryColor = paletteScene(palettePhase, 0.18 + field * 0.42);
  vec3 movingColor = paletteScene(palettePhase + 0.11 + depthPressure * 0.04, 0.62);
  vec3 accentColor = paletteScene(palettePhase + 0.28, 0.78 + glowTrack * 0.16);
  vec3 particleColor = paletteScene(palettePhase + 0.47, 0.36 + secondaryField * 0.28);
  vec3 glowColor = paletteScene(palettePhase + 0.18, 0.52);
  vec3 pressureColor = paletteScene(palettePhase + 0.56, 0.72);
  vec3 flashColor = paletteScene(palettePhase + 0.5, 0.92);

  vec3 base = mix(deep, primaryColor, liquid * (0.68 + colorShift * 0.18));
  base = mix(base, movingColor, (0.2 + depthPressure * 0.24 + colorShift * 0.16) * liquid);
  base = mix(base, amber, kickWave * 0.38);
  base += accentColor * (rings * (0.12 + glowTrack * 0.42) + beat * 0.22);
  base += particleColor * particles * 0.32;
  base = mix(base, flashColor, u_colorFlash * (0.18 + 0.34 * liquid));

  float vignette = smoothstep(0.95, 0.15, length(centered));
  float scan = 0.94 + 0.06 * sin(uv.y * u_resolution.y * 0.75);
  float glow = liquid * (0.14 + kick * 0.48) + kickPressure * 0.52 + kickWave * 0.58 + particles * 0.38 + beat * (0.16 + glowTrack * 0.3);
  float idleDim = mix(0.72, 1.0, u_isPlaying);

  vec3 color = (base + glow * glowColor * 0.34 + kickPressure * pressureColor * 0.28) * vignette * scan * idleDim;
  color += flashColor * u_colorFlash * (0.2 + particles * 0.26 + beat * 0.16);
  gl_FragColor = vec4(color, 1.0);
}
`;

const initialUniforms = {
  energy: 0,
  accent: 0,
  complexity: 0,
  stepPhase: 0,
  isPlaying: 0,
  colorPhase: 0,
  colorFlash: 0,
  tracks: [0, 0.5, 0, 0] as [number, number, number, number],
};

function fixto(value: number) {
  return `00${value}`.slice(-2);
}

export type VisualizerHandle = {
  capturePng: () => string | null;
};

export const Visualizer = forwardRef<VisualizerHandle, { state: VisualizerState }>(function Visualizer(
  { state },
  ref,
) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shaderRef = useRef<ShaderBackgroundInstance<typeof initialUniforms> | null>(null);
  const stateRef = useRef(state);
  const envelopeRef = useRef<VisualEnvelopeState>(createVisualEnvelope());
  const frameRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const lastReadoutTimeRef = useRef(0);
  const [status, setStatus] = useState<"shader" | "fallback">("shader");
  const [errorLabel, setErrorLabel] = useState("");
  const [displayEnvelope, setDisplayEnvelope] = useState<VisualEnvelopeState>(() => createVisualEnvelope());

  useImperativeHandle(
    ref,
    () => ({
      capturePng: () => {
        if (status === "shader") {
          const shader = shaderRef.current;
          if (!shader?.canvas) {
            return null;
          }

          shader.render();
          return shader.canvas.toDataURL("image/png");
        }

        return fallbackCanvasRef.current?.toDataURL("image/png") ?? null;
      },
    }),
    [status],
  );

  const readout = useMemo(
    () => ({
      kick: Math.round(displayEnvelope.energy * 100),
      depth: Math.round((displayEnvelope.tracks[1] * 2 - 1) * 100),
      glow: Math.round(displayEnvelope.tracks[2] * 100),
      color: Math.round(displayEnvelope.colorFlash * 100),
      complexity: Math.round(displayEnvelope.complexity * 100),
    }),
    [displayEnvelope],
  );

  useEffect(() => {
    stateRef.current = state;
    envelopeRef.current = exciteEnvelope(envelopeRef.current, state);
  }, [state]);

  useEffect(() => {
    const renderEnvelope = (timestamp: number) => {
      const previousTimestamp = lastFrameTimeRef.current || timestamp;
      const deltaSeconds = Math.min(0.1, Math.max(0, (timestamp - previousTimestamp) / 1000));
      lastFrameTimeRef.current = timestamp;
      envelopeRef.current = decayEnvelope(envelopeRef.current, deltaSeconds);

      const visual = stateRef.current;
      const envelope = envelopeRef.current;
      if (timestamp - lastReadoutTimeRef.current > 100) {
        setDisplayEnvelope(envelope);
        lastReadoutTimeRef.current = timestamp;
      }

      shaderRef.current?.setUniforms({
        energy: envelope.energy,
        accent: envelope.accent,
        complexity: envelope.complexity,
        stepPhase: visual.stepPhase,
        isPlaying: visual.isPlaying ? 1 : 0,
        colorPhase: envelope.colorPhase,
        colorFlash: envelope.colorFlash,
        tracks: envelope.tracks,
      });

      frameRef.current = requestAnimationFrame(renderEnvelope);
    };

    envelopeRef.current = exciteEnvelope(envelopeRef.current, stateRef.current);
    frameRef.current = requestAnimationFrame(renderEnvelope);

    return () => {
      cancelAnimationFrame(frameRef.current);
      lastFrameTimeRef.current = 0;
    };
  }, []);

  useEffect(() => {
    if (!targetRef.current) {
      return;
    }

    const shader = createShaderBackground({
      target: targetRef.current,
      fragment,
      uniforms: initialUniforms,
      layer: "background",
      maxDpr: 2,
      canvasClass: "visualizer-canvas",
      canvasStyle: {
        width: "100%",
        height: "100%",
      },
      onReady(instance) {
        shaderRef.current = instance;
        setStatus("shader");
        setErrorLabel("");
      },
      onError(error) {
        setStatus("fallback");
        setErrorLabel(error.name || "WebGL fallback");
      },
    });

    shaderRef.current = shader;
    shader.ready.catch((error: unknown) => {
      setStatus("fallback");
      setErrorLabel(error instanceof Error ? error.name : "WebGL fallback");
    });

    return () => {
      shader.destroy();
      shaderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== "fallback") {
      return;
    }

    let animationFrame = 0;
    const canvas = fallbackCanvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const visual = stateRef.current;
      const envelope = envelopeRef.current;
      const time = performance.now() / 1000;
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#0a1416";
      context.fillRect(0, 0, width, height);

      const kickPressure = envelope.energy;
      const colorShift = envelope.tracks[3];
      const baseHue = (envelope.colorPhase * 360 + time * 2) % 360;
      const flashHue = (baseHue + 180) % 360;
      const pressureGradient = context.createRadialGradient(
        width * 0.5,
        height * 0.5,
        0,
        width * 0.5,
        height * 0.5,
        (height * 0.46 + kickPressure * height * 0.36) * dpr,
      );
      pressureGradient.addColorStop(0, `hsla(${baseHue + 32}, 92%, 62%, ${kickPressure * 0.3})`);
      pressureGradient.addColorStop(0.45, `hsla(${baseHue + 128}, 90%, 58%, ${kickPressure * 0.12})`);
      pressureGradient.addColorStop(1, "rgba(8, 18, 20, 0)");
      context.fillStyle = pressureGradient;
      context.fillRect(0, 0, width, height);

      if (envelope.colorFlash > 0.01) {
        context.fillStyle = `hsla(${flashHue}, 96%, 62%, ${envelope.colorFlash * 0.16})`;
        context.fillRect(0, 0, width, height);
      }

      for (let index = 0; index < 18; index += 1) {
        const kick = envelope.energy;
        const depthSigned = envelope.tracks[1] * 2 - 1;
        const depthAmount = Math.abs(depthSigned);
        const glow = envelope.tracks[2];
        const phase = time * (0.12 + depthAmount * 0.42) * (depthSigned === 0 ? 0 : Math.sign(depthSigned)) + index * 0.42 + visual.stepPhase * 0.28;
        const orbit = 0.24 - depthAmount * 0.08;
        const x = width * (0.5 + Math.sin(index * 1.9) * orbit);
        const y = height * (0.5 + Math.cos(index * 2.3) * orbit);
        const depthScale = 1 + Math.sin(phase) * depthAmount * 0.34;
        const radius = (32 + index * 9 + kick * 128 + glow * 36) * depthScale * dpr;
        const hue = (baseHue + index * 23 + Math.sin(index + time * 0.2) * 28) % 360;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `hsla(${hue}, 82%, 58%, ${0.08 + glow * 0.14})`);
        gradient.addColorStop(0.45, `hsla(${hue + 42}, 78%, 54%, ${0.05 + colorShift * 0.1})`);
        gradient.addColorStop(0.72, `hsla(${hue + 118}, 86%, 56%, ${0.03 + depthAmount * 0.07})`);
        gradient.addColorStop(1, "rgba(8, 18, 20, 0)");
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }

      animationFrame = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [status]);

  return (
    <section className="visualizer-panel" aria-label="Sequencer visualizer">
      <div className="visualizer-stage" ref={targetRef}>
        {status === "fallback" ? <canvas className="visualizer-fallback" ref={fallbackCanvasRef} /> : null}
        <div className="visualizer-overlay">
          <div>
            <h2>Fluid Pulse</h2>
            <p>{state.isPlaying ? "Live step signal" : "Editing preview"}</p>
          </div>
          <div className="visualizer-metrics value-label">
            <span>Step {fixto(state.stepIndex + 1)}</span>
            <span>Kick {fixto(readout.kick)}</span>
            <span>Depth {readout.depth > 0 ? "+" : readout.depth < 0 ? "" : "~"}{readout.depth}</span>
            <span>Glow {fixto(readout.glow)}</span>
            <span>Color {fixto(readout.color)}</span>
            <span>Complexity {fixto(readout.complexity)}</span>
          </div>
        </div>
        {status === "fallback" ? <span className="visualizer-status">{errorLabel || "2D fallback"}</span> : null}
      </div>
    </section>
  );
});
