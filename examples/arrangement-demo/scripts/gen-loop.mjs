/**
 * Generates a 32-beat (16s @ 120 BPM) loop as a WAV file whose energy
 * matches the visual arrangement in src/arrangement.ts: sparse kick+hihat
 * during the two Intro sections (beats 0-8, 16-24), denser hihat + a
 * simple bass "wub" during the two Chorus sections (beats 8-16, 24-32).
 *
 * Output: examples/arrangement-demo/public/demo-loop.wav
 * Run: node scripts/gen-loop.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../public/demo-loop.wav");

const SAMPLE_RATE = 44100;
const BPM = 120;
const SEC_PER_BEAT = 60 / BPM; // 0.5s
const TOTAL_BEATS = 32; // matches arrangement.ts TOTAL_BEATS
const TOTAL_SAMPLES = Math.round(SEC_PER_BEAT * TOTAL_BEATS * SAMPLE_RATE);

const samples = new Float32Array(TOTAL_SAMPLES);

const isChorusBeat = (beat) => (beat >= 8 && beat < 16) || (beat >= 24 && beat < 32);

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

const addHihat = (offset, amount = 0.25) => {
  const decay = 0.03 * SAMPLE_RATE;
  for (let i = 0; i < decay && offset + i < TOTAL_SAMPLES; i++) {
    const env = Math.exp(-i / (decay * 0.4));
    const noise = (Math.random() * 2 - 1) * env * amount;
    samples[offset + i] += noise;
  }
};

const addBass = (offset) => {
  const decay = 0.25 * SAMPLE_RATE;
  const freq = 55;
  for (let i = 0; i < decay && offset + i < TOTAL_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-i / (decay * 0.5));
    // Square-ish wave for a bit of grit
    const wave = Math.sign(Math.sin(2 * Math.PI * freq * t));
    samples[offset + i] += wave * env * 0.35;
  }
};

for (let beat = 0; beat < TOTAL_BEATS; beat++) {
  const beatOffset = Math.round(beat * SEC_PER_BEAT * SAMPLE_RATE);
  const chorus = isChorusBeat(beat);

  addKick(beatOffset);

  if (chorus) {
    // 8th-note hihats, louder
    addHihat(beatOffset, 0.3);
    addHihat(beatOffset + Math.round((SEC_PER_BEAT / 2) * SAMPLE_RATE), 0.3);
    if (beat % 2 === 0) {
      addBass(beatOffset);
    }
  } else {
    // Quarter-note hihat only, quieter
    addHihat(beatOffset, 0.15);
  }
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
