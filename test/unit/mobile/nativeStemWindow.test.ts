import { describe, expect, it } from 'vitest';
import { stemWindowJSON } from '../../../src/services/automix/nativeStemRuntime';
import { stemWindowCoverage, stemWindowLate } from '../../../src/services/automix/stemWindow';

// nativeStemWindow.test.ts — original coverage/late alignment through the bounded native timing bridge.
const request = { version: 1, outAt: 100.1, outFrom: 100, outFrames: 52920,
  inAt: 0.05, inFrom: 0, inFrames: 39690, seconds: 0.8, lateBy: 1 };
describe('stem window timing', () => {
  it('limits late wiring by the available material at both ends', () => {
    expect(JSON.parse(stemWindowJSON(JSON.stringify(request)))).toEqual({ covered: true, late: 0.05 });
    expect(stemWindowLate(12.4, 12, 52920, 39690, 4410, 2205, 35280, 44100)).toBe(0.05);
  });
  it('includes the incoming media position after its hold, not just the seek target', () => {
    expect(JSON.parse(stemWindowJSON(JSON.stringify({ ...request, inAt: 0.2 })))).toEqual({ covered: false, late: 0 });
  });
  it('preserves the original half-sample coverage boundary', () => {
    expect(stemWindowCoverage(-0.49 / 44100, 0, 35280, 0, 0, 35280, 0.8, 44100).covered).toBe(true);
    expect(stemWindowCoverage(-0.51 / 44100, 0, 35280, 0, 0, 35280, 0.8, 44100).covered).toBe(false);
    expect(stemWindowCoverage(0, 0, 35280, 0, 0, 35280, 35280.49 / 44100, 44100).covered).toBe(true);
    expect(stemWindowCoverage(0, 0, 35280, 0, 0, 35280, 35280.51 / 44100, 44100).covered).toBe(false);
  });
  for (const patch of [{ seconds: 0.79 }, { seconds: 31 }, { outFrames: 1323001 }, { inFrames: 1.5 },
    { inFrames: 0 }, { outAt: -1 }, { lateBy: -1 }, { version: 2 }, { outFrom: null }, { inAt: '0' }]) {
    it(`rejects invalid metadata ${JSON.stringify(patch)}`, () => {
      expect(() => stemWindowJSON(JSON.stringify({ ...request, ...patch }))).toThrow();
    });
  }
});
