import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// neteaseCloud.test.ts — real transport normalization retains private cloud identity and malformed-list failures.
beforeEach(() => {
  vi.resetModules(); vi.restoreAllMocks();
  vi.stubEnv('VITE_NETEASE_API_BASE', 'http://127.0.0.1:3000');
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'netease_cookie' ? 'fixture-cookie' : null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('window', {}); vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const reply = (body: unknown) => vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body)));
describe('NetEase cloud transport', () => {
  it('normalizes raw cloud songs without replacing the identity used for playback', async () => {
    reply({ code: 200, count: 51, hasMore: true, data: [{ songId: 800, songName: 'Cloud',
      simpleSong: { id: 800, name: 'Cloud', ar: [{ id: 1, name: 'Artist' }], al: { id: 2, name: 'Album' }, dt: 1000 } }] });
    const { neteaseApi } = await import('@/services/netease');
    const result = await neteaseApi.getUserCloud(50, 0);
    expect(result).toMatchObject({ count: 51, hasMore: true, songs: [{ id: 800, name: 'Cloud',
      sourceRef: { kind: 'online', providerId: 'netease', mediaId: '800', variant: 'cloud' } }] });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/user/cloud?limit=50&offset=0');
  });
  it.each([undefined, null, {}])('does not turn malformed cloud data %j into a successful empty list', async data => {
    reply({ code: 200, count: 0, data });
    const { neteaseApi } = await import('@/services/netease');
    expect((await neteaseApi.getUserCloud(50, 0)).songs).toBeUndefined();
  });
  it('preserves a confirmed empty cloud drive', async () => {
    reply({ code: 200, count: 0, data: [], hasMore: false });
    const { neteaseApi } = await import('@/services/netease');
    expect(await neteaseApi.getUserCloud()).toMatchObject({ songs: [], count: 0, hasMore: false });
  });
});
