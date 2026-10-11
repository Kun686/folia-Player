import { describe, expect, it } from 'vitest';
import { replayGainJSON } from '../../../src/services/automix/nativeRuntime';
import { calculateReplayGain } from '../../../src/utils/replayGain';
import type { ReplayGainInfo } from '../../../src/types';

// Native mode tables must follow the original fallback/clipping policy, including numeric strings.
describe('native ReplayGain boundary', () => {
  it('preserves original track/album calculations', () => {
    for (const info of [null, {}, { trackGain: -6 }, { trackGain: 6, trackPeak: 0.8 },
      { trackGain: -8, albumGain: -3, albumPeak: 0.9 }, { trackGain: 6, albumPeak: 1.2 },
      { trackGain: '-5', trackPeak: '0.7' }, { trackGain: 'invalid', albumGain: 0 }]) {
      const result = JSON.parse(replayGainJSON(JSON.stringify({ version: 1, info })));
      for (const mode of ['track', 'album'] as const) {
        expect(result[mode]).toBe(calculateReplayGain(info as ReplayGainInfo, mode).linearGain);
      }
    }
  });
  it('rejects broken protocol input and leaves unrepresentable PCM gain neutral', () => {
    for (const text of ['null', '{', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, info: [] })]) {
      expect(() => replayGainJSON(text)).toThrow();
    }
    expect(JSON.parse(replayGainJSON(JSON.stringify({ version: 1, info: { trackGain: 1e10 } })))).toEqual({ track: 1, album: 1 });
  });
});
