import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { analysePCM, sampleRate, profileVersion } from '@/services/automix/nativeProfileRuntime';
import { analyseTrack, TRACK_PROFILE_VERSION } from '@/services/automix/trackProfile';

// nativeProfiles.test.ts — deterministic PCM lets XCTest replay original analysis outputs without an audio fixture download.
const specifications = [
  { name: 'silence', seconds: 4, stereo: false, partial: false },
  { name: 'short', seconds: 0.5, stereo: false, partial: false },
  { name: 'tone', seconds: 8, stereo: false, partial: false },
  { name: 'edges', seconds: 12, stereo: false, partial: false },
  { name: 'voice', seconds: 12, stereo: true, partial: false },
  { name: 'structure', seconds: 24, stereo: true, partial: false },
  { name: 'groove', seconds: 20, stereo: false, partial: false },
  { name: 'edges', seconds: 12, stereo: false, partial: true },
];
function pcm(spec: typeof specifications[number]) {
  const mid = new Float32Array(spec.seconds * sampleRate), side = spec.stereo ? new Float32Array(mid.length) : null;
  for (let index = 0; index < mid.length; index++) {
    const second = Math.floor(index / sampleRate);
    const period = spec.name === 'structure' && second >= 8 ? 72 : 100;
    let amplitude = spec.name === 'silence' ? 0 : 0.25;
    if (spec.name === 'edges') amplitude = second < 1 || second >= 10 ? 0 : second >= 8 ? 0.03125 : 0.25;
    if (spec.name === 'groove') amplitude = index % 11025 < 2205 ? 0.5 : 0.03125;
    mid[index] = ((index % period) < period / 2 ? amplitude : -amplitude);
    if (side) side[index] = ((index % 137) < 68 ? 1 : -1) * (second < 4 ? 0.25 : 0.015625);
  }
  return { mid, side };
}
const measure = (mid: Float32Array, side: Float32Array | null, partial: boolean) => new Promise<unknown>((resolve, reject) => {
  analysePCM(mid, side, partial, (json, error) => error ? reject(new Error(error)) : resolve(JSON.parse(json)));
});
const fixtureURL = new URL('../../../ios/App/NativeTests/TrackProfileReference.json', import.meta.url);
describe('native original track profiles', () => {
  it('preserves every original field and the distinction between partial and unmeasured-model input', async () => {
    expect(profileVersion).toBe(TRACK_PROFILE_VERSION);
    const rows = [];
    for (const spec of specifications) {
      const { mid, side } = pcm(spec);
      const expected = await analyseTrack(mid, sampleRate, { side, partial: spec.partial, gridless: true });
      expect(await measure(mid, side, spec.partial), spec.name).toEqual(expected);
      rows.push({ ...spec, expected });
    }
    const fixture = { version: 1, sampleRate, profileVersion, rows };
    if (process.env.FOLIA_PROFILE_REFERENCE === '1') writeFileSync(fixtureURL, JSON.stringify(fixture) + '\n');
    // Linux/macOS results differ by a few final bits. Keep every field and integer exact, with 12 decimal places for floats.
    const fixtureMatchers = JSON.parse(JSON.stringify(fixture), (_key, value) =>
      typeof value === 'number' && !Number.isInteger(value) ? expect.closeTo(value, 12) : value);
    expect(JSON.parse(readFileSync(fixtureURL, 'utf8'))).toEqual(fixtureMatchers);
    expect(rows.some(row => row.expected?.bpm !== null && row.expected?.bpm !== undefined)).toBe(true);
    expect(rows.find(row => row.name === 'edges' && row.partial)?.expected?.leadOut).toBeNull();
  });
  it('rejects malformed PCM and still accepts the next input', async () => {
    await expect(measure(new Float32Array([NaN]), null, false)).rejects.toThrow('invalid-profile-input');
    await expect(measure(new Float32Array([Infinity]), null, false)).rejects.toThrow('invalid-profile-input');
    await expect(measure(new Float32Array([17]), null, false)).rejects.toThrow('invalid-profile-input');
    await expect(measure(new Float32Array(8), new Float32Array(7), false)).rejects.toThrow('invalid-profile-input');
    await expect(measure(new Float32Array(0), null, false)).resolves.toBeNull();
  });
});
