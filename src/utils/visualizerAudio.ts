import type { MotionValue } from 'framer-motion';
import type { AudioBands } from '../types';

// src/utils/visualizerAudio.ts — the original renderer's audio response, shared by Web Audio and native PCM.
export const VISUALIZER_FFT_SIZE = 2048;
export const VISUALIZER_SMOOTHING = 0.6;
const ranges = [
  ['bass', 20, 150, 1.8], ['lowMid', 150, 400, 2], ['mid', 400, 1200, 2],
  ['vocal', 1000, 3500, 1.5], ['treble', 3500, 12000, 2],
] as const;
const response = (value: number, exponent: number) => Math.pow(value / 255, exponent) * 255;

export function applyVisualizerSpectrum(
  bins: Uint8Array<ArrayBuffer>, hzPerBin: number, power: MotionValue<number>, bands: AudioBands,
) {
  if (!Number.isFinite(hzPerBin) || hzPerBin <= 0) return;
  bands.spectrum?.set(bins);
  let lowEnergy = 0;
  for (const [name, low, high, exponent] of ranges) {
    const start = Math.floor(low / hzPerBin), end = Math.min(bins.length - 1, Math.floor(high / hzPerBin));
    let sum = 0;
    for (let i = start; i <= end; i++) sum += bins[i];
    const energy = end >= start ? sum / (end - start + 1) : 0;
    bands[name].set(response(energy, exponent));
    if (name === 'bass' || name === 'lowMid') lowEnergy += energy;
  }
  power.set(response(lowEnergy / 2, 3));
}

export function applyVisualizerIdle(power: MotionValue<number>, bands: AudioBands, nowMs: number) {
  const breath = (Math.sin(nowMs / 2000) + 1) * 20;
  power.set(breath);
  for (const [name] of ranges) bands[name].set(breath);
  // Avoid reallocating an empty spectrum on each idle frame.
  if (bands.spectrum?.get().length) bands.spectrum.set(new Uint8Array(0));
}
