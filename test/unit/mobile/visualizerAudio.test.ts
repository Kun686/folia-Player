import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyVisualizerIdle, applyVisualizerSpectrum } from '../../../src/utils/visualizerAudio';
import { connectNativeAudioSignals, createNativeAudioSignals } from '../../../src/mobile/useNativeAudio';

// Shared response fidelity and bridge lifecycle; these are not real-device visual/performance acceptance.
const bridge = vi.hoisted(() => ({ audioLevels: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native: bridge, isNative: true }));
let callbacks: Map<number, FrameRequestCallback>, sequence: number;
const frame = async () => {
  const current = [...callbacks.values()]; callbacks.clear();
  current.forEach(callback => callback(0));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
};
beforeEach(() => {
  vi.resetAllMocks(); callbacks = new Map(); sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callbacks.set(++sequence, fn); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('original visualizer audio response', () => {
  it('keeps every desktop frequency band and exponent unchanged', () => {
    const signals = createNativeAudioSignals(), bins = Uint8Array.from({ length: 1024 }, (_, i) => (i * 37) % 256);
    applyVisualizerSpectrum(bins, 21.5, signals.audioPower, signals.audioBands);
    // Original desktop equations before extraction, deliberately independent of the shared helper.
    const energy = (low: number, high: number) => {
      const start = Math.floor(low / 21.5), end = Math.floor(high / 21.5);
      return bins.slice(start, end + 1).reduce((sum, value) => sum + value, 0) / (end - start + 1);
    };
    for (const [key, low, high, exponent] of [['bass', 20, 150, 1.8], ['lowMid', 150, 400, 2],
      ['mid', 400, 1200, 2], ['vocal', 1000, 3500, 1.5], ['treble', 3500, 12000, 2]] as const) {
      expect(signals.audioBands[key].get()).toBe(Math.pow(energy(low, high) / 255, exponent) * 255);
    }
    expect(signals.audioPower.get()).toBe(Math.pow((energy(20, 150) + energy(150, 400)) / 2 / 255, 3) * 255);
  });
  it('clamps band reads at Nyquist without NaN and keeps silence at zero', () => {
    const signals = createNativeAudioSignals();
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      applyVisualizerSpectrum(new Uint8Array(1024), rate / 2048, signals.audioPower, signals.audioBands);
      expect(signals.audioPower.get()).toBe(0);
      expect(signals.audioBands.treble.get()).toBe(0);
    }
  });
  it('uses the original idle breath and clears the previous spectrum', () => {
    const signals = createNativeAudioSignals(); signals.audioBands.spectrum.set(new Uint8Array([255]));
    for (const now of [0, 1000, 2000, 4000]) {
      applyVisualizerIdle(signals.audioPower, signals.audioBands, now);
      expect(signals.audioPower.get()).toBe((Math.sin(now / 2000) + 1) * 20);
      expect(signals.audioBands.vocal.get()).toBe(signals.audioPower.get());
      expect(signals.audioBands.spectrum.get().length).toBe(0);
    }
  });
});
describe('native animation sampling lifetime', () => {
  it('allows only one in-flight request and discards its result after hiding', async () => {
    let resolve!: (value: unknown) => void;
    bridge.audioLevels.mockImplementation(() => new Promise(r => { resolve = r; }));
    const signals = createNativeAudioSignals(), stop = connectNativeAudioSignals(signals, true, true);
    await frame(); await frame(); await frame();
    expect(bridge.audioLevels).toHaveBeenCalledTimes(1);
    stop(); resolve({ available: true, spectrum: Array(1024).fill(255), sampleRate: 44100 });
    await frame(); expect(signals.audioPower.get()).toBe(0); expect(callbacks.size).toBe(0);
  });
  it('suspends native polling when paused or hidden, but preserves visible idle motion', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const signals = createNativeAudioSignals(), pause = connectNativeAudioSignals(signals, true, false);
    await frame(); expect(signals.audioPower.get()).toBe((Math.sin(0.5) + 1) * 20);
    expect(bridge.audioLevels).not.toHaveBeenCalled(); pause();
    const hidden = connectNativeAudioSignals(signals, false, true);
    await frame(); expect(callbacks.size).toBe(0); expect(bridge.audioLevels).not.toHaveBeenCalled(); hidden();
  });
  it('recovers after a bridge failure and treats audible silence separately from idle', async () => {
    bridge.audioLevels.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ available: true, spectrum: Array(1024).fill(0), sampleRate: 48000 });
    const signals = createNativeAudioSignals(), stop = connectNativeAudioSignals(signals, true, true);
    await frame(); await frame();
    expect(bridge.audioLevels).toHaveBeenCalledTimes(2); expect(signals.audioPower.get()).toBe(0);
    expect(signals.audioBands.spectrum.get().length).toBe(1024); stop();
  });
});
