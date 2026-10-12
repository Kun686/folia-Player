import { afterEach, describe, expect, it, vi } from 'vitest';
import { neteaseApi } from '../../../src/services/netease';

// neteaseLikeFreshness.test.ts — like reads/writes must not reuse an upstream GET cache entry.
const request = vi.hoisted(() => vi.fn(async (_url: string) => new Response('{"code":200,"ids":[]}')));
vi.mock('../../../src/services/mobileRuntime', () => ({ getMobileRuntime: () => ({}), providerFetch: request }));
vi.mock('../../../src/services/onlineMusic/providerStorage', () => ({
  readProviderSessionValue: () => 'fixture-cookie', removeProviderSessionValue: vi.fn(), writeProviderSessionValue: vi.fn(),
}));
afterEach(() => { vi.restoreAllMocks(); request.mockClear(); });
describe('NetEase like freshness', () => {
  it('busts account subscription read caches and preserves explicit write direction', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    await neteaseApi.getAlbumDetailDynamic(8); await neteaseApi.getPlaylistDetailDynamic(9);
    await neteaseApi.getFavoriteAlbums(); await neteaseApi.subscribeAlbum(8, true); await neteaseApi.subscribePlaylist(9, false);
    now.mockReturnValue(2000); await neteaseApi.getAlbumDetailDynamic(8); await neteaseApi.getFavoriteAlbums();
    const urls = request.mock.calls.map(([url]) => new URL(url, 'https://fixture.invalid'));
    expect(urls.map(url => url.searchParams.getAll('timestamp'))).toEqual([['1000'], ['1000'], ['1000'], ['1000'], ['1000'], ['2000'], ['2000']]);
    expect(urls[3].searchParams.get('t')).toBe('1'); expect(urls[4].searchParams.get('t')).toBe('2');
  });
  it('includes a fresh timestamp on both status reads and explicit mutations', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    await neteaseApi.getLikedSongs(9); await neteaseApi.likeSong(42, true);
    now.mockReturnValue(2000); await neteaseApi.getLikedSongs(9); await neteaseApi.likeSong(42, false);
    const urls = request.mock.calls.map(([url]) => new URL(url, 'https://fixture.invalid'));
    expect(urls.map(url => url.searchParams.get('timestamp'))).toEqual(['1000', '1000', '2000', '2000']);
    expect(urls.map(url => url.pathname)).toEqual(['/mobile/netease/likelist', '/mobile/netease/like', '/mobile/netease/likelist', '/mobile/netease/like']);
    expect(urls[1].searchParams.get('like')).toBe('true'); expect(urls[3].searchParams.get('like')).toBe('false');
  });
});
