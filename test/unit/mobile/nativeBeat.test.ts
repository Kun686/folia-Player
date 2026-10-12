import { describe, expect, it } from 'vitest';
import { analysePCM, prepareBeatPCM, beatGridJSON } from '@/services/automix/nativeProfileRuntime';
import { aggregateChunks, beatsFromLogits, melSpectrogram, splitForModel, type MelChunk } from '@/services/automix/beatThis';
import { analyseTrack } from '@/services/automix/trackProfile';
import { fft } from '@/services/automix/signalAnalysis';

// nativeBeat.test.ts — shared original arithmetic at the JSC boundary, including model-attempt semantics.
const prepare = (mono: Float32Array, transform = fft) => new Promise<{ chunks: MelChunk[]; frames: number }>((resolve, reject) => {
  prepareBeatPCM(mono, (chunks, frames, error) => error ? reject(new Error(error)) : resolve({ chunks, frames }), transform);
});
const analyse = (mono: Float32Array, grid?: string) => new Promise<unknown>((resolve, reject) => {
  analysePCM(mono, null, true, (json, error) => error ? reject(new Error(error)) : resolve(JSON.parse(json)), undefined, grid);
});

describe('native Beat This boundary', () => {
  it('reuses the exact centred mel and chunk padding with an injected equivalent FFT', async () => {
    const mono = Float32Array.from({ length: 22050 * 31 }, (_, i) => Math.sin(i * 0.13) * 0.2);
    let calls = 0;
    const sizes = new Set<number>();
    const result = await prepare(mono, (real, imag) => { sizes.add(real.length); calls++; fft(real, imag); });
    const mel = await melSpectrogram(mono), expected = splitForModel(mel);
    expect([...sizes]).toEqual([1024]); expect(calls).toBe(mel.frames); expect(result.frames).toBe(mel.frames);
    expect(result.chunks.map(c => [c.start, c.frames])).toEqual(expected.map(c => [c.start, c.frames]));
    // Native byte comparison preserves exactness without expanding megabytes into per-element assertion bookkeeping.
    for (let i = 0; i < expected.length; i++) {
      expect(Buffer.compare(Buffer.from(result.chunks[i].data.buffer), Buffer.from(expected[i].data.buffer))).toBe(0);
    }
  });
  it('uses original keep-first aggregation, peak picking and downbeat snapping', () => {
    const chunks = splitForModel({ frames: 3051, data: new Float32Array(3051 * 128) });
    const predictions = chunks.map(({ start, frames }) => ({ start, frames,
      beat: Float32Array.from({ length: frames }, (_, i) => (start + i) % 25 === 0 ? 3 : -2),
      downbeat: Float32Array.from({ length: frames }, (_, i) => (start + i - 1) % 100 === 0 ? 2 : -2) }));
    const original = aggregateChunks(predictions, 3051);
    expect(JSON.parse(beatGridJSON(predictions, 3051))).toEqual(beatsFromLogits(original.beat, original.downbeat));
    expect(() => beatGridJSON([{ ...predictions[0], beat: new Float32Array([NaN]) }], 3051)).toThrow('invalid-beat-prediction');
  });
  it('preserves measured-empty versus absent model and complete replacement of grid fields', async () => {
    const mono = Float32Array.from({ length: 22050 * 5 }, (_, i) => Math.sin(i * 0.2) * 0.3);
    const grid = { beats: Array.from({ length: 10 }, (_, i) => i * 0.5), downbeats: [0, 2, 4] };
    expect(await analyse(mono, JSON.stringify(grid))).toEqual(await analyseTrack(mono, 22050, { partial: true, side: null, grid, gridless: false }));
    expect(await analyse(mono, 'null')).toMatchObject({ gridless: false, partial: true, leadOut: null });
    expect(await analyse(mono)).toMatchObject({ gridless: true });
    await expect(analyse(mono, '{')).rejects.toThrow('invalid-profile-grid');
    await expect(analyse(mono, JSON.stringify({ beats: [1, 0], downbeats: [] }))).rejects.toThrow('invalid-profile-grid');
    await expect(analyse(mono, JSON.stringify({ beats: [0, 1], downbeats: [0.5] }))).rejects.toThrow('invalid-profile-grid');
  });
  it('rejects malformed PCM without entering a model and handles empty input explicitly', async () => {
    await expect(prepare(new Float32Array([NaN]))).rejects.toThrow('invalid-profile-input');
    await expect(prepare(new Float32Array([17]))).rejects.toThrow('invalid-profile-input');
    await expect(prepare(new Float32Array())).resolves.toEqual({ chunks: [], frames: 0 });
  });
});
