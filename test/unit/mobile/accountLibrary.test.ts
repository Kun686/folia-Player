import { describe, expect, it, vi } from 'vitest';
import { createMobileAccountLibrary } from '../../../src/mobile/mobileAccountLibrary';
import type { ProviderCollection } from '../../../src/types/onlineMusic';

// accountLibrary.test.ts — account ownership, original pagination, retained data and disposal.
const user = { id: 9, nickname: 'Listener' };
const album = (id: number): ProviderCollection => ({ id, providerId: 'qq', type: 'album', name: String(id) });
const port = () => ({ getProviderUserAlbums: vi.fn(async (_provider: string, _user: unknown, page: { limit: number; offset: number }) => ({
  items: Array.from({ length: page.offset ? 1 : 50 }, (_, i) => album(page.offset + i)), hasMore: page.offset === 0, nextOffset: page.offset ? 51 : 50,
})), getProviderCloudCollection: vi.fn(async () => null as ProviderCollection | null) });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
describe('mobile original account library', () => {
  it('loads all favorite pages with explicit provider and original page size', async () => {
    const api = port(), resource = createMobileAccountLibrary('qq', user, 'albums', api, () => true);
    await resource.ensure(); await resource.ensure();
    expect(api.getProviderUserAlbums.mock.calls).toEqual([['qq', 9, { limit: 50, offset: 0 }], ['qq', 9, { limit: 50, offset: 50 }]]);
    expect(resource.getSnapshot()).toMatchObject({ status: 'ready', loaded: true });
    expect(resource.getSnapshot().data.map(a => a.id)).toEqual(Array.from({ length: 51 }, (_, i) => i));
  });
  it('keeps the previous successful list on refresh failure and sanitizes diagnostics', async () => {
    const api = port(), log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const resource = createMobileAccountLibrary('qq', user, 'albums', api, () => true);
      await resource.ensure(); const data = resource.getSnapshot().data;
      api.getProviderUserAlbums.mockRejectedValueOnce(new Error('secret-cookie'));
      await resource.reload();
      expect(resource.getSnapshot()).toMatchObject({ status: 'error', data });
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret-cookie');
      expect(log.mock.calls[0][1].message).toBe('account-library-unavailable');
      await resource.reload(); expect(resource.getSnapshot().status).toBe('ready');
    } finally { log.mockRestore(); }
  });
  it.each(['close', 'session'])('discards a late response and stops pagination after %s', async reason => {
    const api = port(), pending = deferred<Awaited<ReturnType<typeof api.getProviderUserAlbums>>>();
    api.getProviderUserAlbums.mockReturnValueOnce(pending.promise); let same = true;
    const resource = createMobileAccountLibrary('qq', user, 'albums', api, () => same);
    const work = resource.ensure();
    if (reason === 'close') resource.setOwner(null); else same = false;
    pending.resolve({ items: [album(1)], hasMore: true, nextOffset: 1 }); await work;
    expect(resource.getSnapshot()).toMatchObject({ owner: null, data: [], loaded: false });
    expect(api.getProviderUserAlbums).toHaveBeenCalledTimes(1);
  });
  it('reads cloud metadata through its owning provider, keeping empty distinct from failed', async () => {
    const api = port(), resource = createMobileAccountLibrary('netease', user, 'cloud', api, () => true);
    await resource.ensure(); expect(resource.getSnapshot()).toMatchObject({ status: 'ready', data: [] });
    expect(api.getProviderCloudCollection).toHaveBeenCalledWith('netease', user);
    const cloud = { ...album(-100), providerId: 'netease', type: 'cloud', trackCount: 51 };
    api.getProviderCloudCollection.mockResolvedValueOnce(cloud);
    await resource.reload(); expect(resource.getSnapshot().data).toEqual([cloud]);
    expect(api.getProviderUserAlbums).not.toHaveBeenCalled();
  });
});
