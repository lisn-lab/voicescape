// Post-processing for a freshly recorded voice clip: trim the silence at the
// head/tail and normalize loudness to roughly the seed-clip level, so a quiet
// or distant mic comes out comparable to the built-in clips. This replaces the
// old fixed capture-time gain, which could not adapt to mic or distance.

import { encodeMP3 } from './encoder.js';

// Target loudness (RMS) ~ the mastered seed clips (measured ~0.08–0.14).
export const VOICE_TARGET_RMS = 0.12;
const PEAK_CEILING = 0.95;         // a normalized peak never exceeds this (≈ seed peak)
const MIN_GAIN = 0.25, MAX_GAIN = 16;  // bounds so normalization can't run away
// Silence trimming runs off a short-window RMS envelope with an onset threshold
// set RELATIVE to the loudest window — so the low-level room noise/breath before
// someone speaks (which a fixed per-sample floor treats as "not silence") is
// still trimmed and the clip starts right at the voice. That keeps the pad
// responsive: pressing it plays the voice immediately, not seconds of dead air.
const WINDOW_SEC = 0.02;           // 20 ms analysis window
const HOP_SEC = 0.01;              // 10 ms hop
const ONSET_FACTOR = 0.1;          // voiced = window RMS >= 10% of the reference level
const ONSET_FLOOR = 0.008;         // ...but never treat below this absolute RMS as voiced
const ONSET_PERCENTILE = 0.9;      // reference level = 90th-pct window RMS (robust to spikes)
const LEAD_PAD_SEC = 0.05;         // keep 50 ms before the onset so the attack isn't clipped
const TAIL_PAD_SEC = 0.08;         // keep 80 ms after the last voiced window
const MIN_VOICED_SEC = 0.05;       // if the voiced region is shorter than this, don't trim

// Find the [start, end] sample range of the voiced region via a short-window RMS
// envelope, with the onset threshold relative to the loudest window. Returns null
// when nothing rises above the floor (essentially silence). PURE / node-testable.
function findVoiceBounds(samples, sampleRate) {
  const n = samples.length;
  const win = Math.max(1, Math.floor(WINDOW_SEC * sampleRate));
  const hop = Math.max(1, Math.floor(HOP_SEC * sampleRate));
  const env = [];
  for (let i = 0; i + win <= n; i += hop) {
    let s = 0;
    for (let j = 0; j < win; j++) { const v = samples[i + j]; s += v * v; }
    env.push({ i, r: Math.sqrt(s / win) });
  }
  if (env.length === 0) return null;
  // Reference level = 90th-percentile window RMS, NOT the max — a single loud
  // transient (button click, cough, mic bump) can't inflate the threshold and
  // trim the quieter real voice away.
  const sorted = env.map(w => w.r).sort((a, b) => a - b);
  const ref = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ONSET_PERCENTILE))];
  if (ref <= 0) return null;
  const thresh = Math.max(ONSET_FLOOR, ref * ONSET_FACTOR);
  let first = -1, last = -1;
  for (let k = 0; k < env.length; k++) {
    if (env[k].r >= thresh) { if (first < 0) first = k; last = k; }
  }
  if (first < 0) return null;
  const start = Math.max(0, env[first].i - Math.floor(LEAD_PAD_SEC * sampleRate));
  const end = Math.min(n - 1, env[last].i + win - 1 + Math.floor(TAIL_PAD_SEC * sampleRate));
  return { start, end };
}

// PURE: trim leading/trailing silence (windowed onset detection), then normalize
// toward the target RMS with a peak ceiling. `samples` is a mono Float32Array.
// Returns the processed samples plus gain and trim indices (for tests / logging).
// No AudioContext needed, so this is unit-testable in node.
export function processSamples(samples, sampleRate) {
  const n = samples.length;
  if (n === 0) return { samples, gain: 1, startIndex: 0, endIndex: 0, rms: 0 };

  const bounds = findVoiceBounds(samples, sampleRate);
  // Essentially silence — leave it untouched rather than return an empty clip.
  if (!bounds) return { samples, gain: 1, startIndex: 0, endIndex: n, rms: 0 };

  // If the detected voice region is implausibly short, normalize the whole clip
  // rather than emit a sliver (and never hand a near-empty buffer to the encoder).
  const useFull = (bounds.end - bounds.start + 1) < Math.floor(MIN_VOICED_SEC * sampleRate);
  const startIdx = useFull ? 0 : bounds.start;
  const endIdx = useFull ? n - 1 : bounds.end;
  const trimmed = samples.slice(startIdx, endIdx + 1);

  // RMS + peak of the trimmed region.
  let sumSq = 0, peak = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const v = trimmed[i];
    sumSq += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sumSq / trimmed.length);

  // Normalize toward the target RMS, clamp to sane bounds, then pull back if the
  // peak would clip — so quiet clips get lifted and loud ones stay clean.
  let gain = rms > 0 ? VOICE_TARGET_RMS / rms : 1;
  gain = Math.max(MIN_GAIN, Math.min(MAX_GAIN, gain));
  if (peak * gain > PEAK_CEILING) gain = PEAK_CEILING / peak;

  const out = new Float32Array(trimmed.length);
  for (let i = 0; i < trimmed.length; i++) out[i] = trimmed[i] * gain;
  return { samples: out, gain, startIndex: startIdx, endIndex: endIdx, rms };
}

// BROWSER: decode a recorded blob, downmix to mono, process, re-encode to MP3.
// `audioContext` is a real AudioContext (e.g. Tone.getContext().rawContext).
export async function processVoiceRecording(blob, audioContext) {
  const arrayBuf = await blob.arrayBuffer();
  const decoded = await audioContext.decodeAudioData(arrayBuf);

  // Downmix to mono (voice is mono; halves the stored size).
  const len = decoded.length, ch = decoded.numberOfChannels;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const d = decoded.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / ch;
  }

  const { samples } = processSamples(mono, decoded.sampleRate);

  const outBuf = audioContext.createBuffer(1, samples.length, decoded.sampleRate);
  outBuf.copyToChannel(samples, 0);
  return encodeMP3(outBuf);
}
