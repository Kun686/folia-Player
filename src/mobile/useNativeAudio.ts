import { useEffect, useMemo } from 'react';
import { motionValue } from 'framer-motion';
import { native, isNative } from './bridge';

// src/mobile/useNativeAudio.ts — match the desktop analyser scale; no per-frame React updates.
export function useNativeAudio(active: boolean) {
  const signals = useMemo(() => ({ audioPower: motionValue(0), audioBands: {
    bass: motionValue(0), lowMid: motionValue(0), mid: motionValue(0), vocal: motionValue(0), treble: motionValue(0),
    spectrum: motionValue<Uint8Array<ArrayBuffer>>(new Uint8Array(0)),
  } }), []);
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      signals.audioPower.set(0);
      for (const name of ['bass', 'lowMid', 'mid', 'vocal', 'treble'] as const) signals.audioBands[name].set(0);
      signals.audioBands.spectrum.set(new Uint8Array(0));
    };
    const sample = async () => {
      try {
        const data = await native.audioLevels();
        if (disposed) return;
        if (data.available && data.sampleRate > 0 && data.spectrum.length) {
          const bins = Uint8Array.from(data.spectrum);
          signals.audioBands.spectrum.set(bins);
          const energy = (low: number, high: number) => {
            const start = Math.max(0, Math.floor(low * bins.length * 2 / data.sampleRate));
            const end = Math.min(bins.length - 1, Math.floor(high * bins.length * 2 / data.sampleRate));
            let sum = 0;
            for (let i = start; i <= end; i++) sum += bins[i];
            return end >= start ? sum / (end - start + 1) : 0;
          };
          const bands = [energy(20, 150), energy(150, 400), energy(400, 1200), energy(1000, 3500), energy(3500, 12000)];
          const process = (value: number, boost: number) => Math.pow(value / 255, boost) * 255;
          signals.audioPower.set(process((bands[0] + bands[1]) / 2, 3));
          (['bass', 'lowMid', 'mid', 'vocal', 'treble'] as const).forEach((name, i) => signals.audioBands[name].set(process(bands[i], [1.8, 2, 2, 1.5, 2][i])));
        } else reset();
      } catch { if (!disposed) reset(); }
      if (!disposed) timer = setTimeout(() => void sample(), 50);
    };
    if (active && isNative) void sample(); else reset();
    return () => { disposed = true; clearTimeout(timer); reset(); };
  }, [active, signals]);
  return signals;
}
