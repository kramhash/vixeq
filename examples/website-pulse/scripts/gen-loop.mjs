/**
 * Generates a 2-bar kick+hihat loop at 120 BPM as a WAV file.
 * Output: examples/website-pulse/public/demo-loop.wav
 *
 * Run: node scripts/gen-loop.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../public/demo-loop.wav");

const SAMPLE_RATE = 44100;
const BPM = 120;
const STEPS_PER_BAR = 16;
const BARS = 2;
const STEP_DURATION_S = 60 / BPM / 4; // 16th note
const TOTAL_STEPS = STEPS_PER_BAR * BARS;
const TOTAL_SAMPLES = Math.round(STEP_DURATION_S * TOTAL_STEPS * SAMPLE_RATE);

const samples = new Float32Array(TOTAL_SAMPLES);

// Kick pattern: steps 0, 4, 8, 12 (quarter notes)
const kickSteps = new Set([0, 4, 8, 12, 16, 20, 24, 28]);
// Hihat pattern: every step
const hihatSteps = new Set(Array.from({ length: TOTAL_STEPS }, (_, i) => i));

const addKick = (offset) => {
  const decay = 0.18 * SAMPLE_RATE;
  const freq0 = 150;
  const freq1 = 50;
  for (let i = 0; i < decay && offset + i < TOTAL_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-i / (decay * 0.3));
    const freq = freq0 + (freq1 - freq0) * (i / decay);
    samples[offset + i] += Math.sin(2 * Math.PI * freq * t) * env * 0.8;
  }
};

const addHihat = (offset, closed = true) => {
  const decay = closed ? 0.03 * SAMPLE_RATE : 0.08 * SAMPLE_RATE;
  for (let i = 0; i < decay && offset + i < TOTAL_SAMPLES; i++) {
    const env = Math.exp(-i / (decay * 0.4));
    // White noise burst
    const noise = (Math.random() * 2 - 1) * env * (closed ? 0.25 : 0.35);
    samples[offset + i] += noise;
  }
};

for (let step = 0; step < TOTAL_STEPS; step++) {
  const offset = Math.round(step * STEP_DURATION_S * SAMPLE_RATE);
  if (kickSteps.has(step)) addKick(offset);
  if (hihatSteps.has(step)) addHihat(offset, step % 2 === 0);
}

// Normalize to prevent clipping
let peak = 0;
for (const s of samples) peak = Math.max(peak, Math.abs(s));
if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] /= peak * 1.1;

// Write WAV
const writeWav = (samples, sampleRate, path) => {
  const numSamples = samples.length;
  const dataBytes = numSamples * 2; // 16-bit PCM
  const buf = Buffer.alloc(44 + dataBytes);
  let pos = 0;

  const write = (str) => { buf.write(str, pos, "ascii"); pos += str.length; };
  const writeU32 = (v) => { buf.writeUInt32LE(v, pos); pos += 4; };
  const writeU16 = (v) => { buf.writeUInt16LE(v, pos); pos += 2; };
  const writeI16 = (v) => { buf.writeInt16LE(v, pos); pos += 2; };

  write("RIFF");
  writeU32(36 + dataBytes);
  write("WAVE");
  write("fmt ");
  writeU32(16);        // chunk size
  writeU16(1);         // PCM
  writeU16(1);         // mono
  writeU32(sampleRate);
  writeU32(sampleRate * 2); // byte rate
  writeU16(2);         // block align
  writeU16(16);        // bits per sample
  write("data");
  writeU32(dataBytes);
  for (const s of samples) {
    writeI16(Math.round(Math.max(-1, Math.min(1, s)) * 32767));
  }

  writeFileSync(path, buf);
  console.log(`Written: ${path} (${(buf.length / 1024).toFixed(1)} KB, ${(numSamples / sampleRate).toFixed(2)}s)`);
};

mkdirSync(resolve(__dirname, "../public"), { recursive: true });
writeWav(samples, SAMPLE_RATE, outPath);
