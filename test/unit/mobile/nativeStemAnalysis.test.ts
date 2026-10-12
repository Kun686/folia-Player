import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stemEnvelopeJSON, stemObservationJSON, stemVocalEndJSON } from '@/services/automix/nativeStemAnalysis';
import { stemPlanJSON, stemCurveJSON } from '@/services/automix/nativeStemRuntime';
import { envelopeOf, lastVocalMoment, singsInWindow, planStemHandover, incomingCurves, outgoingCurves } from '@/services/automix/stemGesture';
import { expansionMask, planExpansion } from '@/services/automix/expansionGesture';
import { barGrid } from '@/services/automix/musicalTime';
import { peakOf, toPcm } from '@/services/automix/stems';

// nativeStemAnalysis.test.ts — original float observations, reconstructed Int16 windows and final plan references.
const rate = 44100, frames = rate * 30, names = ['vocals', 'drums', 'bass', 'other'] as const;
const hash = (array: Float32Array) => createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const envelope = (left: Float32Array, right = left) => JSON.parse(stemEnvelopeJSON(left, right)) as number[];
const request = { version: 1, windowSec: 6.57, outAt: 101, inAt: 0, outgoingBarSec: 2, incomingBarSec: 2,
  outgoingBpm: 120, outgoingDownbeat: 0.75, outgoingBeatsPerBar: 4, incomingSectionStart: 10, expansion: 0.75, keysClash: false };

function channels(head: boolean, mode: string) {
  const mix: Float32Array[] = [], vocals: Float32Array[] = [], drums: Float32Array[] = [], bass: Float32Array[] = [], other: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const m = new Float32Array(frames), v = new Float32Array(frames), d = new Float32Array(frames), b = new Float32Array(frames), o = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const wave = ((i % 97) - 48) / 128 * (c === 0 ? 1 : 0.5), intro = i < 10 * rate;
      m[i] = mode === 'silent' ? 0 : wave * (head && intro ? 1 / 64 : 1);
      v[i] = mode === 'silent' ? 0 : head ? wave * (intro && mode !== 'voice' ? 1 / 1024 : 1 / 2)
        : wave * (i >= rate && i < 798210 ? 1 / 2 : 1 / 4096);
      if (mode === 'antiphase') v[i] = ((i % 97) - 48) / 256 * (c === 0 ? 1 : -1);
      d[i] = m[i] / 4; b[i] = m[i] / 8; o[i] = m[i] - d[i] - b[i] - v[i];
    }
    mix.push(m); vocals.push(v); drums.push(d); bass.push(b); other.push(o);
  }
  const stored = Object.fromEntries(Object.entries({ vocals, drums, bass, other }).map(([name, rows]) => {
    const gain = peakOf(rows[0], rows[1]), packed = toPcm(rows[0], rows[1], gain);
    return [name, [0, 1].map(c => Float32Array.from(packed.subarray(c * frames, (c + 1) * frames), x => x / 32767 * gain))];
  })) as Record<typeof names[number], Float32Array[]>;
  return { mix, vocals, stored };
}

function originalRows() {
  const cases = [
    { name: 'quiet-intro', mode: 'normal', options: request },
    { name: 'unknown-structure', mode: 'normal', options: { ...request, incomingSectionStart: null } },
    { name: 'boundary-inside', mode: 'normal', options: { ...request, incomingSectionStart: 4 } },
    { name: 'voice-present', mode: 'voice', options: request },
    { name: 'odd-grid-fractional', mode: 'normal', options: { ...request, windowSec: 12.11, outAt: 101.137, inAt: 1.13,
      outgoingBpm: 131, outgoingDownbeat: 1.125, outgoingBeatsPerBar: 3, keysClash: true, expansion: 1 } },
    { name: 'after-intro', mode: 'normal', options: { ...request, inAt: 12, incomingSectionStart: 10 } },
    { name: 'silent-gridless', mode: 'silent', options: { ...request, outgoingBpm: null, outgoingDownbeat: null, expansion: null } },
    { name: 'antiphase', mode: 'antiphase', options: { ...request, windowSec: 0.8, expansion: 0.25 } },
  ];
  return cases.map(({ name, mode, options }) => {
    const out = channels(false, mode), incoming = channels(true, mode);
    const offset = Math.round((options.outAt - 100) * rate), inOffset = Math.round(options.inAt * rate), length = Math.round(options.windowSec * rate);
    const mixAt = (data: typeof out, at: number, count: number) => [0, 1].map(c => {
      const result = new Float32Array(count);
      for (const stem of names) for (let i = 0; i < count; i++) result[i] += data.stored[stem][c][at + i];
      return result;
    });
    const slice = (rows: Float32Array[], at: number) => rows.map(c => c.subarray(at, at + length));
    const vocals = envelopeOf(slice(out.stored.vocals, offset), rate), mix = envelopeOf(mixAt(out, offset, length), rate);
    const inVocals = envelopeOf(slice(incoming.stored.vocals, inOffset), rate), reference = envelopeOf(mixAt(incoming, 0, frames), rate);
    const foundVoice = singsInWindow(inVocals, reference), introAt = options.incomingSectionStart === null ? null : options.incomingSectionStart - options.inAt;
    const sings = !(!foundVoice && introAt !== null && introAt > options.windowSec);
    const bars: number[] = [], grid = barGrid(options.outgoingBpm, options.outgoingDownbeat, options.outgoingBeatsPerBar);
    if (grid) for (let k = Math.ceil((options.outAt - grid.offset) / grid.period); ; k++) {
      const at = grid.offset + k * grid.period - options.outAt;
      if (at > options.windowSec) break;
      if (at >= 0) bars.push(at);
    }
    const input = { ...options, vocals: [...vocals], mix: [...mix], incomingVocals: [...inVocals], incomingReference: [...reference] };
    const expected = { version: 1, windowSec: options.windowSec, outgoingBarSec: options.outgoingBarSec, incomingBarSec: options.incomingBarSec,
      outgoingBeatsPerBar: options.outgoingBeatsPerBar, vocals: [...vocals], mix: [...mix], downbeats: bars, expansion: options.expansion, incoming: { keysClash: options.keysClash, sings } };
    const handover = planStemHandover(options.windowSec, options.outgoingBarSec, options.incomingBarSec, bars, vocals, mix, expected.incoming);
    const outCurves = outgoingCurves(options.windowSec, handover), inCurves = incomingCurves(options.windowSec, handover);
    const expansion = options.expansion === null ? null : planExpansion(options.expansion, handover.swap, options.outgoingBarSec, options.windowSec, options.outgoingBeatsPerBar);
    if (expansion) for (const stem of expansion.stems) {
      const mask = expansionMask(options.windowSec, expansion);
      for (let i = 0; i < mask.length; i++) outCurves[stem][i] *= mask[i];
    }
    return { name, mode, options, input, expected, handover,
      vocalEnd: lastVocalMoment(envelopeOf(out.vocals, rate), envelopeOf(out.mix, rate)),
      outHashes: Object.fromEntries(names.map(n => [n, hash(outCurves[n])])), inHashes: Object.fromEntries(names.map(n => [n, hash(inCurves[n])])),
      mixHashes: mixAt(out, offset, length).map(hash),
      localReferenceWouldFindVoice: singsInWindow(inVocals, envelopeOf(mixAt(incoming, inOffset, length), rate)) };
  });
}

describe('native measured stem observations', () => {
  it('matches original stereo RMS including cancellation, tiny windows and Float32 rounding', () => {
    const left = Float32Array.from({ length: 44117 }, (_, i) => (i % 97 - 48) / 128);
    for (const right of [left, left.map(x => -x), left.map(x => x / 4)]) expect(envelope(left, right)).toEqual([...envelopeOf([left, right], rate)]);
    expect(envelope(new Float32Array(2204))).toEqual([]);
    for (const bad of [new Float32Array(), new Float32Array(1323001), new Float32Array([NaN])]) expect(() => envelope(bad)).toThrow();
    expect(() => envelope(left, new Float32Array(44100))).toThrow();
  });
  it('preserves tail sustain and decay measured before Int16 quantization', () => {
    for (const values of [[], [0], [0.5], Array(600).fill(0.5), [...Array(20).fill(0), ...Array(6).fill(0.1), ...Array(20).fill(0)]]) {
      const input = { version: 1, vocals: values, mix: values.map(() => 0.5) };
      expect(JSON.parse(stemVocalEndJSON(JSON.stringify(input)))).toBe(lastVocalMoment(new Float32Array(input.vocals), new Float32Array(input.mix)));
    }
    expect(() => stemVocalEndJSON(JSON.stringify({ version: 1, vocals: [0], mix: [] }))).toThrow();
  });
  it('feeds actual restored PCM evidence into original plans and every curve', () => {
    const rows = originalRows();
    for (const row of rows) {
      const result = stemObservationJSON(JSON.stringify(row.input));
      expect(JSON.parse(result)).toEqual(row.expected);
      expect(JSON.parse(stemPlanJSON(result)).handover).toEqual(row.handover);
      for (const [direction, hashes] of [['out', row.outHashes], ['in', row.inHashes]] as const) for (const stem of names) {
        expect(hash(new Float32Array(JSON.parse(stemCurveJSON(JSON.stringify({ ...row.expected, direction, stem })))))).toBe(hashes[stem]);
      }
    }
    expect(rows[0].expected.incoming.sings).toBe(false);
    expect(rows[0].localReferenceWouldFindVoice).toBe(true);
    expect(rows.slice(1, 4).every(x => x.expected.incoming.sings)).toBe(true);
    const path = new URL('../../../ios/App/NativeTests/StemAnalysisReference.json', import.meta.url);
    if (process.env.FOLIA_STEM_ANALYSIS_REFERENCE === '1') writeFileSync(path, JSON.stringify(rows) + '\n');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(rows);
  }, 30000); // Eight complete 30s stereo packing references are deliberate; this is not a timing benchmark.
  it('rejects malformed observations and unbounded or non-progressing grids', () => {
    const good = { ...request, vocals: Array(131).fill(0.1), mix: Array(131).fill(0.5), incomingVocals: Array(131).fill(0), incomingReference: Array(600).fill(0.5) };
    for (const patch of [{ windowSec: 31 }, { outAt: -1 }, { outAt: 1e12 }, { outgoingBpm: 1e-310 }, { outgoingBpm: 1001 },
      { outgoingDownbeat: 1e10 }, { outgoingBeatsPerBar: 0 }, { incomingSectionStart: -1 }, { keysClash: 'false' }, { expansion: 0 },
      { incomingReference: [] }, { incomingReference: Array(601).fill(1) }, { incomingVocals: [0] }, { mix: Array(131).fill(-1) }]) {
      expect(() => stemObservationJSON(JSON.stringify({ ...good, ...patch }))).toThrow();
    }
    expect(() => stemObservationJSON(' '.repeat(262145))).toThrow();
    expect(JSON.parse(stemObservationJSON(JSON.stringify(good))).incoming.sings).toBe(false);
  });
});
