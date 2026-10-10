import { expect, it } from 'vitest';
import { nextBalanceTrim } from '../../../src/services/automix/balanceCorrection';
import { balanceJSON } from '../../../src/services/automix/nativeRuntime';

// nativeBalance.test.ts — fixed original thresholds, monotonic attenuation and native boundary.
it.each([
    [null, -12, 0, null], [-12, null, 0, null], [-12, -5, 0, null],
    [-10, -10.5, 0, null], [-10, -10.75, 0, 0.75],
    [-5, -12, 0, 6], [-5, -12, 6, null], [-8, -12, 3, 4],
    [-8, -12, 3.5, null], [-8, -12, 5, null], [-12, -12, 4, null],
] as const)('retains original balance rule (%s, %s, %s)', (outgoing, incoming, applied, expected) => {
    expect(nextBalanceTrim(outgoing, incoming, applied)).toBe(expected);
    const result = JSON.parse(balanceJSON(JSON.stringify({ version: 1, outgoingDb: outgoing,
        incomingDb: incoming, appliedDb: applied, overlap: 2 })));
    expect(result.intervalMs).toBe(100); expect(result.minOverlap).toBe(0.8);
    if (expected === null) expect(result.adjustment).toBeNull();
    else {
        expect(result.adjustment.trimDb).toBe(expected);
        expect(result.adjustment.seconds).toBe(0.4);
        expect(result.adjustment.gain).toBeCloseTo(10 ** (-expected / 20), 12);
    }
});
it('does not balance a cut and rejects malformed native input', () => {
    const frame = { version: 1, outgoingDb: -4, incomingDb: -12, appliedDb: 0, overlap: 0.799 };
    expect(JSON.parse(balanceJSON(JSON.stringify(frame))).adjustment).toBeNull();
    for (const update of [{ appliedDb: -1 }, { overlap: -1 }, { outgoingDb: 'loud' }, { version: 2 }]) {
        expect(() => balanceJSON(JSON.stringify({ ...frame, ...update }))).toThrow();
    }
});
