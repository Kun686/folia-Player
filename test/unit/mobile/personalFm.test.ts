import { describe, expect, it, vi } from 'vitest';
import { requestNeteaseFm, readNeteaseFm, validateFmSelection } from '../../../shared/mobile/neteaseFm';
import { neteaseApi } from '../../../src/services/netease';
import { normalizeNeteaseSong } from '../../../src/services/onlineMusic/neteaseProvider';

// personalFm.test.ts — original song parsing and native-facing FM must agree without live accounts.
const song = { id: 42, name: 'Radio', artists: [{ id: 7, name: 'Artist' }], album: { id: 9, name: 'Album', picUrl: 'http://fixture.invalid/a.jpg' }, duration: 123000,
  fee: 1, privilege: { id: 42, st: 0, pl: 320000 } };
describe('shared personal FM', () => {
  it('uses the original default endpoint and preserves normalized source metadata', async () => {
    const request = vi.fn(async () => ({ code: 200, data: [song] }));
    const result = await readNeteaseFm({ mode: 'DEFAULT', scene: null }, request);
    expect(request).toHaveBeenCalledExactlyOnceWith('/personal_fm', {});
    expect(result.songs).toEqual([normalizeNeteaseSong(song)]);
    expect(result.songs[0]).toMatchObject({ sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' }, album: { coverUrl: 'https://fixture.invalid/a.jpg' } });
    expect(neteaseApi.normalizeSongResult(song).privilege).toEqual(result.songs[0].privilege);
  });
  it('sends the original scene and never invents a larger batch size', async () => {
    const request = vi.fn(async () => ({ code: 200, data: [song] }));
    await readNeteaseFm({ mode: 'SCENE_RCMD', scene: 'FOCUS' }, request);
    expect(request).toHaveBeenCalledExactlyOnceWith('/personal/fm/mode', { mode: 'SCENE_RCMD', submode: 'FOCUS' });
  });
  it.each([[], null])('falls back once when a selected mode cannot provide songs: %s', async data => {
    const request = vi.fn().mockResolvedValueOnce({ code: 200, data }).mockResolvedValueOnce({ code: 200, data: [song] });
    expect((await readNeteaseFm({ mode: 'EXPLORE' }, request)).fallback).toBe(true);
    expect(request.mock.calls.map(value => value[0])).toEqual(['/personal/fm/mode', '/personal_fm']);
  });
  it.each([301, 401, 403, 429])('never falls back or loops after authentication/rate error %s', async code => {
    const request = vi.fn(async () => ({ code, data: [song] }));
    await expect(requestNeteaseFm({ mode: 'EXPLORE' }, request)).rejects.toMatchObject({ code: code === 429 ? 'rate-limited' : 'auth-required' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('propagates cancellation without a fallback request', async () => {
    const request = vi.fn(async () => { throw new DOMException('cancelled', 'AbortError'); });
    await expect(requestNeteaseFm({ mode: 'FAMILIAR' }, request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { mode: 'OTHER' }, { mode: 'SCENE_RCMD' }, { mode: 'DEFAULT', scene: 'FOCUS' }])('rejects malformed selection %s', value => {
    expect(() => validateFmSelection(value)).toThrow('invalid-fm-mode');
  });
  it.each([[{}], [{ id: 0 }], [{ id: Number.MAX_SAFE_INTEGER + 1 }], Array(101).fill(song)])('rejects malformed or unbounded batches', async data => {
    await expect(readNeteaseFm({ mode: 'DEFAULT' }, async () => ({ code: 200, data }))).rejects.toThrow('invalid-fm-response');
  });
});
