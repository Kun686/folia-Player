import { beforeEach, describe, expect, it, vi } from 'vitest';
import { neteaseApi } from '../../../src/services/netease';
import { neteaseProvider } from '../../../src/services/onlineMusic/neteaseProvider';

// neteaseSearchResponse.test.ts — normalization must preserve invalid response shapes for the provider to reject.
const request = vi.hoisted(() => vi.fn());
vi.mock('../../../src/services/mobileRuntime', () => ({ getMobileRuntime: () => ({}), providerFetch: request }));
vi.mock('../../../src/services/onlineMusic/providerStorage', () => ({
  readProviderSessionValue: () => 'fixture-cookie', removeProviderSessionValue: vi.fn(), writeProviderSessionValue: vi.fn(),
}));
beforeEach(() => request.mockReset());
describe('NetEase search transport normalization', () => {
  it.each([undefined, null, {}, 'not-a-list'])('does not turn malformed songs %j into an empty list', async songs => {
    request.mockImplementation(async () => new Response(JSON.stringify({ code: 200, result: { songs, songCount: 2 } })));
    expect((await neteaseApi.cloudSearch('song')).result.songs).toEqual(songs);
    await expect(neteaseProvider.search!.searchSongs('song', 50, 0)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('retains privilege restrictions and the search query/page sent through the mobile transport', async () => {
    request.mockImplementation(async () => new Response(JSON.stringify({ code: 200, result: {
      songs: [{ id: 42, name: 'Restricted', ar: [], al: { id: 1, name: 'Album' }, dt: 1000 }],
      privileges: [{ id: 42, st: -200 }], songCount: 51,
    } })));
    const result = await neteaseProvider.search!.searchSongs('song & album', 50, 50);
    expect(result.items[0]).toMatchObject({ id: 42, privilege: { st: -200 }, sourceRef: { providerId: 'netease', mediaId: '42' } });
    expect(neteaseProvider.playback!.getAvailability!(result.items[0]).state).toBe('unavailable');
    const url = new URL(request.mock.calls[0][0], 'https://fixture.invalid');
    expect(url.searchParams.get('keywords')).toBe('song & album'); expect(url.searchParams.get('offset')).toBe('50');
  });
});
