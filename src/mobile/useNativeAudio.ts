import { useEffect, useMemo } from 'react';
import { motionValue } from 'framer-motion';
import { native, isNative } from './bridge';
import { applyVisualizerIdle, applyVisualizerSpectrum } from '../utils/visualizerAudio';

// src/mobile/useNativeAudio.ts — original audio response and idle breath, with no per-frame React updates.
export const createNativeAudioSignals = () => ({ audioPower: motionValue(0), audioBands: {
  bass: motionValue(0), lowMid: motionValue(0), mid: motionValue(0), vocal: motionValue(0), treble: motionValue(0),
  spectrum: motionValue<Uint8Array<ArrayBuffer>>(new Uint8Array(0)),
} });
type NativeAudioSignals = ReturnType<typeof createNativeAudioSignals>;

export function connectNativeAudioSignals(signals: NativeAudioSignals, rendering: boolean, playing: boolean) {
  let disposed = false, frame = 0, inFlight = false;
  const reset = () => {
    signals.audioPower.set(0);
    for (const name of ['bass', 'lowMid', 'mid', 'vocal', 'treble'] as const) signals.audioBands[name].set(0);
    signals.audioBands.spectrum.set(new Uint8Array(0));
  };
  const tick = () => {
    if (disposed) return;
    if (!playing) applyVisualizerIdle(signals.audioPower, signals.audioBands, Date.now());
    else if (!inFlight) {
      inFlight = true;
      void native.audioLevels().then(data => {
        if (disposed) return;
        if (data.available && Number.isFinite(data.sampleRate) && data.sampleRate > 0 && data.spectrum.length) {
          const bins = Uint8Array.from(data.spectrum);
          applyVisualizerSpectrum(bins, data.sampleRate / (bins.length * 2), signals.audioPower, signals.audioBands);
        } else reset();
      }).catch(() => { if (!disposed) reset(); }).finally(() => { inFlight = false; });
    }
    frame = requestAnimationFrame(tick);
  };
  if (rendering && isNative) frame = requestAnimationFrame(tick); else reset();
  return () => { disposed = true; cancelAnimationFrame(frame); reset(); };
}

export function useNativeAudio(rendering: boolean, playing: boolean) {
  const signals = useMemo(createNativeAudioSignals, []);
  useEffect(() => connectNativeAudioSignals(signals, rendering, playing), [signals, rendering, playing]);
  return signals;
}
