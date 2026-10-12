import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { stemCurveJSON, stemPlanJSON } from '@/services/automix/nativeRuntime';
import { CELL_SEC, incomingCurves, outgoingCurves, planStemHandover,
    OTHER_SWEEP_END, OTHER_SWEEP_HZ } from '@/services/automix/stemGesture';

// nativeStems.test.ts — original TS output is the reference; fixtures contain no user music.
const names = ['vocals', 'drums', 'bass', 'other'] as const;
const flat = (seconds: number, level: number) => Array.from(new Float32Array(Math.floor(seconds / CELL_SEC)).fill(level));
const request = (windowSec = 12) => ({ version: 1, windowSec, outgoingBarSec: 2 as number | null,
    incomingBarSec: 2 as number | null, downbeats: [] as number[], vocals: flat(windowSec, 0.5),
    mix: flat(windowSec, 0.5), incoming: {} as { sings?: boolean; keysClash?: boolean } });
const hold = (clash: boolean) => ({ ...request(14.22), outgoingBarSec: 3.6, incomingBarSec: 2.16, downbeats: [5.37],
    vocals: flat(14.22, 1e-6).map((cell, i) => i >= 57 && i < 269 ? 1 : cell), incoming: { keysClash: clash } });
const cases = [
    { name: 'shortest', input: request(0.8) },
    { name: 'recede', input: request() },
    { name: 'silence', input: { ...request(), vocals: flat(12, 0), mix: flat(12, 0) } },
    { name: 'rest', input: { ...request(), vocals: flat(12, 0.5).map((cell, i) => i >= 90 && i < 120 ? 0 : cell) } },
    { name: 'ride', input: hold(false) }, { name: 'clash', input: hold(true) },
    { name: 'no-incoming-voice', input: { ...request(), incoming: { sings: false } } },
    { name: 'gridless', input: { ...request(6.57), outgoingBarSec: null, incomingBarSec: null } },
    { name: 'maximum-window', input: { ...request(30), downbeats: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29] } },
];
const json = JSON.stringify;
const fixtureURL = new URL('../../../ios/App/NativeTests/StemGestureReference.json', import.meta.url);
// Explicit little endian Float32 preserves all samples without a megabyte of decimal JSON per case.
const pack = (curve: Float32Array) => {
    const bytes = Buffer.alloc(curve.length * 4);
    curve.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
    return bytes.toString('base64');
};
const reference = (input: ReturnType<typeof request>) => {
    const handover = planStemHandover(input.windowSec, input.outgoingBarSec, input.incomingBarSec,
        input.downbeats, new Float32Array(input.vocals), new Float32Array(input.mix), input.incoming);
    return { handover, windowSec: input.windowSec,
        otherSweep: { fromHz: OTHER_SWEEP_HZ[0], toHz: OTHER_SWEEP_HZ[1], seconds: input.windowSec * OTHER_SWEEP_END } };
};

describe('native stem gesture boundary', () => {
    it.each(cases)('preserves plan and every curve sample: $name', ({ input }) => {
        const expected = reference(input);
        expect(JSON.parse(stemPlanJSON(json(input)))).toEqual(expected);
        for (const direction of ['out', 'in']) {
            const curves = (direction === 'out' ? outgoingCurves : incomingCurves)(input.windowSec, expected.handover);
            for (const stem of names) {
                const result = stemCurveJSON(json({ ...input, direction, stem }));
                expect(Buffer.byteLength(result)).toBeLessThanOrEqual(262144);
                expect(JSON.parse(result)).toEqual([...curves[stem]]);
            }
        }
    });
    it('exercises all original exit branches, absent voice, and dissonant held-note rejection', () => {
        expect(new Set(cases.map(({ input }) => reference(input).handover.exit.kind)))
            .toEqual(new Set(['rest', 'recede', 'release']));
        expect(reference(hold(false)).handover.exit.kind).toBe('release');
        expect(reference(hold(true)).handover.exit.kind).not.toBe('release');
        expect(reference(cases[6].input).handover.exit.to).toBe(12);
    });
    it('rejects malformed, unbounded, mismatched and Float32-overflowing evidence', () => {
        const good = request();
        for (const patch of [{ version: 2 }, { windowSec: 0.79 }, { windowSec: 30.01 }, { windowSec: '12' },
            { outgoingBarSec: 0 }, { incomingBarSec: -1 }, { vocals: [] }, { vocals: flat(11, 0) },
            { mix: flat(12, -1) }, { mix: flat(12, 1e100) }, { mix: flat(30, 1) },
            { downbeats: [2, 1] }, { downbeats: [1, 1] }, { downbeats: [31] }, { downbeats: ['2'] },
            { incoming: null }, { incoming: { sings: 'false' } }, { incoming: { keysClash: 0 } }]) {
            expect(() => stemPlanJSON(json({ ...good, ...patch }))).toThrow('invalid-transition-input');
        }
        for (const bad of ['null', ' '.repeat(262145), json(good).replace('"windowSec":12', '"windowSec":1e999')]) {
            expect(() => stemPlanJSON(bad)).toThrow();
        }
        for (const patch of [{ direction: 'sideways', stem: 'vocals' }, { direction: 'in', stem: '__proto__' }]) {
            expect(() => stemCurveJSON(json({ ...good, ...patch }))).toThrow('invalid-transition-input');
        }
        expect(JSON.parse(stemPlanJSON(json(good)))).toEqual(reference(good));
    });
    it('keeps native reference samples tied to original functions', () => {
        const rows = cases.map(({ name, input }) => {
            const expected = reference(input);
            const out = outgoingCurves(input.windowSec, expected.handover), incoming = incomingCurves(input.windowSec, expected.handover);
            return { name, input, expected, out: Object.fromEntries(names.map(stem => [stem, pack(out[stem])])),
                in: Object.fromEntries(names.map(stem => [stem, pack(incoming[stem])])) };
        });
        if (process.env.FOLIA_STEM_REFERENCE === '1') writeFileSync(fixtureURL, json(rows) + '\n');
        expect(JSON.parse(readFileSync(fixtureURL, 'utf8'))).toEqual(rows);
    });
});
