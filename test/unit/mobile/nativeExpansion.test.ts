import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { expansionPlanJSON, stemCurveJSON, stemPlanJSON, renderExpansionPCM, expansionSampleMapPCM } from '@/services/automix/nativeRuntime';
import { expansionMask, planExpansion, renderExpansion } from '@/services/automix/expansionGesture';
import { outgoingCurves, incomingCurves } from '@/services/automix/stemGesture';

// nativeExpansion.test.ts — original four strengths, unchanged other lanes, and bounded typed-array rendering.
const request = (windowSec = 12, expansion: number | null = null) => ({ version: 1, windowSec, expansion,
  outgoingBarSec: 2, incomingBarSec: 2, outgoingBeatsPerBar: 4, downbeats: [],
  vocals: Array(Math.floor(windowSec / 0.05)).fill(0.5), mix: Array(Math.floor(windowSec / 0.05)).fill(0.5), incoming: {} });
describe('native performance gesture', () => {
  it.each([0.25, 0.5, 0.75, 1])('keeps exact original samples when %s material is bound after planning', intensity => {
    const plan = JSON.parse(expansionPlanJSON(JSON.stringify(request(12, intensity))));
    const text = JSON.stringify({version: 1, plan}), map = expansionSampleMapPCM(text);
    expect(map).toBeInstanceOf(Float64Array);
    const source = Float32Array.from({length: 529200 + 2048}, (_, i) => Math.sin(i * 0.173) * (i % 11 - 5));
    for (const offset of [0, 1, 2048]) {
      const material = source.subarray(offset, offset + 529200);
      const expected = renderExpansionPCM(material, text);
      const actual = Float32Array.from({length: map.length / 2}, (_, i) =>
        (map[i * 2] < 0 ? 0 : material[map[i * 2]]) * map[i * 2 + 1]);
      // Compare every PCM byte without generic deep-equality overhead on CI.
      const actualBytes = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
      const expectedBytes = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength);
      expect(actualBytes.equals(expectedBytes), `intensity=${intensity}, offset=${offset}`).toBe(true);
    }
  });
  it.each([0.25, 0.5, 0.75, 1])('uses the original %s plan and masks only its outgoing stems', intensity => {
    const input = request(12, intensity), { handover } = JSON.parse(stemPlanJSON(JSON.stringify(input)));
    const plan = planExpansion(intensity, handover.swap, 2, 12, 4)!;
    expect(JSON.parse(expansionPlanJSON(JSON.stringify(input)))).toEqual({ ...plan, windowSec: 12 });
    const mask = expansionMask(12, plan);
    for (const direction of ['out', 'in']) for (const stem of ['drums', 'bass', 'vocals', 'other'] as const) {
      const curves = (direction === 'out' ? outgoingCurves : incomingCurves)(12, handover);
      if (direction === 'out' && plan.stems.includes(stem)) for (let i = 0; i < curves[stem].length; i++) curves[stem][i] *= mask[i];
      expect(JSON.parse(stemCurveJSON(JSON.stringify({ ...input, direction, stem })))).toEqual(Array.from(curves[stem]));
    }
  });
  it('keeps the ordinary gesture when off or when the swap leaves no room', () => {
    for (const input of [request(), request(0.8, 1)]) expect(expansionPlanJSON(JSON.stringify(input))).toBe('null');
  });
  it('accepts the original minimum span after floating-point subtraction', () => {
    const plan = { ...planExpansion(0.25, 10, 0.7, 12, 4)!, windowSec: 12 };
    expect(plan.to - plan.from).toBeLessThan(0.35);
    expect(renderExpansionPCM(new Float32Array(529200), JSON.stringify({version: 1, plan}))).toHaveLength(15435);
  });
  it('renders original samples through typed arrays without modifying the source', () => {
    const input = request(12, 1), plan = JSON.parse(expansionPlanJSON(JSON.stringify(input)));
    const source = Float32Array.from({length: 529200}, (_, i) => (i % 257 - 128) / 512), before = source.slice();
    expect(renderExpansionPCM(source, JSON.stringify({version: 1, plan}))).toEqual(renderExpansion([source], plan, 44100)[0]);
    expect(source).toEqual(before);
  });
  it('rejects malformed plans and PCM without widening the JSON bridge', () => {
    const plan = JSON.parse(expansionPlanJSON(JSON.stringify(request(12, 1))));
    for (const patch of [{ expansion: 0 }, { expansion: 1.1 }, { expansion: '1' }, { outgoingBeatsPerBar: 0 }, { outgoingBeatsPerBar: 33 }]) {
      expect(() => expansionPlanJSON(JSON.stringify({...request(12, 1), ...patch}))).toThrow();
    }
    const source = new Float32Array(44100);
    for (const patch of [{ windowSec: 31 }, { from: -1 }, { to: plan.from }, { spinbackSec: 11 },
      { repeats: [] }, { repeats: Array(257).fill(plan.repeats[0]) }, { repeats: [{...plan.repeats[0], rate: 2}] }]) {
      expect(() => renderExpansionPCM(source, JSON.stringify({ version: 1, plan: {...plan, ...patch} }))).toThrow();
      expect(() => expansionSampleMapPCM(JSON.stringify({ version: 1, plan: {...plan, ...patch} }))).toThrow();
    }
    for (const data of [new Float32Array(0), new Float32Array(1323001), new Float32Array([NaN])]) {
      expect(() => renderExpansionPCM(data, JSON.stringify({version: 1, plan}))).toThrow();
    }
    expect(() => renderExpansionPCM(source, ' '.repeat(262145))).toThrow();
    expect(() => expansionSampleMapPCM(' '.repeat(262145))).toThrow();
  });
});
