import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { create as createNativeDeck } from '../../../src/services/automix/nativeDeckRuntime';
import { createDeckAnalyser } from '../../../src/services/automix/deckAnalyser';

// deckMeasurements.test.ts — frozen pre-extraction deck states, including pause gaps and track reset.
const path = new URL('./deckMeasurementsReference.json', import.meta.url);
function replay(mode: 'steady' | 'gap' | 'reset', native = false) {
  let frame = 0;
  const samples = new Float32Array(1024), spectrum = new Float32Array(512);
  const node = () => ({ frequency: { value: 0 }, gain: { value: 0 }, Q: { value: 0 },
    connect: (next: unknown) => next });
  const context = { sampleRate: 44100, createGain: node, createBiquadFilter: node,
    createAnalyser: () => ({ ...node(), fftSize: 1024, frequencyBinCount: 512,
      getFloatTimeDomainData: (out: Float32Array) => out.set(samples),
      getFloatFrequencyData: (out: Float32Array) => out.set(spectrum) }) };
  const web = createDeckAnalyser(context as unknown as AudioContext, node() as unknown as AudioNode, node() as unknown as AudioNode);
  const state = createNativeDeck(44100);
  let tickTime = 0;
  const analyser = native ? {
    tick(time: number) { state.samples.set(samples); state.spectrum.set(spectrum); state.tick(time); tickTime = time; },
    reset: state.reset,
    loudnessDb: () => JSON.parse(state.snapshot(tickTime)).loudnessDb,
    tempo: () => JSON.parse(state.snapshot(tickTime)).tempo,
    nextBeatIn: (time: number) => JSON.parse(state.snapshot(time)).nextBeatIn,
    levelHistory: () => JSON.parse(state.snapshot(tickTime, true)).history,
  } : web;
  const result = [];
  for (frame = 0; frame < 400; frame++) {
    if (mode === 'reset' && frame === 200) analyser.reset();
    const amplitude = frame < 190 ? 0.12 : frame < 250 ? 0.003 : 0.2;
    for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin(i * 0.037 + frame * 0.19);
    for (let i = 0; i < spectrum.length; i++) spectrum[i] = i > 170 ? -Infinity : -80 + (frame % 20 < 2 ? 30 : 0) + Math.sin(i * 0.07) * 8;
    const time = 100 + frame * 0.025 + (mode === 'gap' && frame > 180 ? 0.8 : 0);
    analyser.tick(time);
    if ([0, 14, 15, 16, 119, 179, 181, 199, 200, 215, 216, 249, 299, 399].includes(frame)) {
      const history = analyser.levelHistory();
      result.push({ frame, db: analyser.loudnessDb(), tempo: analyser.tempo(), next: analyser.nextBeatIn(time + 0.013),
        history: history ? { db: [...history.db], hopSec: history.hopSec } : null });
    }
  }
  return result;
}
it.each([false, true])('preserves original deck measurement state and reset semantics (native=%s)', native => {
  const actual = Object.fromEntries((['steady', 'gap', 'reset'] as const).map(mode => [mode, replay(mode, native)]));
  const expected = JSON.parse(readFileSync(path, 'utf8'));
  // Stored floating references can differ at machine epsilon across JS runtimes, not in decisions or shape.
  const canonical = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, v) =>
    typeof v === 'number' ? Number(v.toFixed(12)) : v));
  expect(canonical(actual)).toEqual(canonical(expected));
});
it('rejects malformed native frames without poisoning the next valid frame', () => {
  expect(() => createNativeDeck(NaN)).toThrow();
  const state = createNativeDeck(44100);
  state.samples[2] = Infinity;
  expect(() => state.tick(1)).toThrow();
  state.samples.fill(0); state.spectrum.fill(-Infinity);
  state.tick(1);
  expect(() => state.tick(0)).toThrow();
  expect(() => state.snapshot(NaN)).toThrow();
  state.tick(2);
  state.reset(); state.tick(0);
  expect(JSON.parse(state.snapshot(0))).toMatchObject({ time: 0, loudnessDb: null, history: null });
});
