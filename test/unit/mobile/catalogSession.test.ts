import { describe, expect, it, vi } from 'vitest';
import { createCatalogSession, type CatalogPort } from '../../../src/mobile/catalogSession';
import type { ProviderCollection, ProviderPage, ProviderUser } from '../../../src/types/onlineMusic';
import type { UnifiedSong } from '../../../src/types';

// catalogSession.test.ts — page boundaries, independently ordered work and account lifetime failures.
const collection = (id: number, providerId = 'qq'): ProviderCollection => ({ id, providerId, type: 'playlist', name: `list-${id}` });
const song = (id: number) => ({ id, name: `song-${id}`, sourceRef: { kind: 'online', providerId: 'qq', mediaId: String(id) } }) as UnifiedSong;
const page = <T>(items: T[], nextOffset = items.length, hasMore = false): ProviderPage<T> => ({ items, nextOffset, hasMore });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const port = {
    api: { getLoginStatus: vi.fn().mockResolvedValue({ id: 9, nickname: 'account' }),
      getProviderUserPlaylists: vi.fn().mockResolvedValue(page([collection(1)])),
      getCollectionTracks: vi.fn().mockResolvedValue(page([song(1)])),
      searchProviderSongs: vi.fn().mockResolvedValue(page([song(2)])), logout: vi.fn().mockResolvedValue(undefined) },
    flush: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined), clearAccount: vi.fn().mockResolvedValue(undefined),
  } satisfies CatalogPort;
  const session = createCatalogSession('qq', port); session.start();
  return { session, port };
}
describe('mobile catalog session', () => {
  it('refreshes the edited collection but never replaces a later search or another provider', async () => {
    const { session, port } = setup();
    await session.load({ collection: collection(8) });
    expect(session.getSnapshot().collection).toMatchObject({ id: 8, providerId: 'qq' });
    await session.refreshCollection(collection(8));
    expect(port.api.getCollectionTracks).toHaveBeenCalledTimes(2);
    await session.refreshCollection(collection(8, 'netease'));
    expect(port.api.getCollectionTracks).toHaveBeenCalledTimes(2);
    await session.load({ query: 'new' }); await session.refreshCollection(collection(8));
    expect(port.api.getCollectionTracks).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot()).toMatchObject({ collection: null, songs: [song(2)] });
  });
  it('reads beyond 100 playlists, keeps source identity and merges overlapping pages', async () => {
    const { session, port } = setup();
    port.api.getProviderUserPlaylists.mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, id) => collection(id)), 100, true))
      .mockResolvedValueOnce(page([{ ...collection(99), name: 'updated' }, collection(100), collection(100, 'netease')], 103));
    await session.refresh(); expect(session.getSnapshot().collectionsMore).toBe(true);
    await session.loadCollections();
    expect(session.getSnapshot().collections).toHaveLength(102);
    expect(session.getSnapshot().collections[99].name).toBe('updated');
    expect(session.getSnapshot().collectionsMore).toBe(false);
    expect(port.api.getProviderUserPlaylists).toHaveBeenLastCalledWith('qq', 9, { limit: 100, offset: 100 });
    await session.loadCollections(); expect(port.api.getProviderUserPlaylists).toHaveBeenCalledTimes(2);
  });
  it('account loading and search finish in either order without invalidating each other', async () => {
    const { session, port } = setup(); const account = deferred<ProviderUser>();
    port.api.getLoginStatus.mockReturnValueOnce(account.promise);
    const refreshing = session.refresh(); await session.load({ query: 'one' });
    expect(session.getSnapshot()).toMatchObject({ busy: false, accountBusy: true, songs: [song(2)] });
    account.resolve({ id: 9, nickname: 'account' }); await refreshing;
    const pending = deferred<ProviderPage<UnifiedSong>>(); port.api.searchProviderSongs.mockReturnValueOnce(pending.promise);
    const searching = session.load({ query: 'two' }); await session.refresh();
    expect(session.getSnapshot()).toMatchObject({ user: { id: 9 }, busy: true, accountBusy: false });
    pending.resolve(page([song(3)])); await searching;
    expect(session.getSnapshot()).toMatchObject({ songs: [song(3)], busy: false, collections: [collection(1)] });
  });
  it('coalesces duplicate load-more clicks and rejects a late page after a new search', async () => {
    const { session, port } = setup(); const pending = deferred<ProviderPage<UnifiedSong>>();
    port.api.searchProviderSongs.mockResolvedValueOnce(page([song(1)], 50, true)).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page([song(9)]));
    await session.load({ query: 'old' }); const loading = session.load(); await session.load();
    expect(port.api.searchProviderSongs).toHaveBeenCalledTimes(2);
    await session.load({ query: 'new' }); pending.resolve(page([song(2)], 100, true)); await loading;
    expect(session.getSnapshot()).toMatchObject({ songs: [song(9)], more: false, busy: false });
  });
  it('a failed new search cannot keep old paging and retries its own first page', async () => {
    const { session, port } = setup();
    port.api.searchProviderSongs.mockResolvedValueOnce(page([song(1)], 50, true)).mockRejectedValueOnce(Error('offline'))
      .mockResolvedValueOnce(page([song(2)]));
    await session.load({ query: 'old' }); await session.load({ query: 'new' });
    expect(session.getSnapshot()).toMatchObject({ songs: [], more: false, trackError: true, busy: false });
    await session.load(); expect(port.api.searchProviderSongs).toHaveBeenLastCalledWith('qq', 'new', { limit: 50, offset: 0 });
    expect(session.getSnapshot().trackError).toBe(false);
  });
  it('retains pages on failure, retries the same cursor and detects non-advancing pages', async () => {
    const { session, port } = setup();
    port.api.getProviderUserPlaylists.mockResolvedValueOnce(page([collection(1)], 100, true))
      .mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(page([collection(2)], 100, true))
      .mockResolvedValueOnce(page([collection(2)], 101));
    await session.refresh(); await session.loadCollections();
    expect(session.getSnapshot()).toMatchObject({ collections: [collection(1)], collectionsMore: true, accountError: true });
    await session.loadCollections(); expect(session.getSnapshot().accountError).toBe(true);
    await session.loadCollections();
    expect(port.api.getProviderUserPlaylists.mock.calls.map(call => call[2].offset)).toEqual([0, 100, 100, 100]);
    expect(session.getSnapshot()).toMatchObject({ collections: [collection(1), collection(2)], accountError: false });
  });
  it('a failed playlist does not prevent flushing confirmed login credentials', async () => {
    const { session, port } = setup(); port.api.getProviderUserPlaylists.mockRejectedValueOnce(Error());
    await expect(session.refresh()).resolves.toBe(false);
    expect(port.flush).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ user: { id: 9 }, accountError: true, accountBusy: false });
  });
  it('logout invalidates late results and attempts both cleanups even after cancellation fails', async () => {
    const { session, port } = setup(); const account = deferred<ProviderUser>(); const pending = deferred<ProviderPage<UnifiedSong>>();
    port.api.getLoginStatus.mockReturnValueOnce(account.promise); port.api.searchProviderSongs.mockReturnValueOnce(pending.promise);
    const refreshing = session.refresh(), searching = session.load({ query: 'pending' });
    port.cancel.mockRejectedValueOnce(Error()); port.clearSession.mockRejectedValueOnce(Error());
    await session.logout(); account.resolve({ id: 9, nickname: 'old' }); pending.resolve(page([song(1)]));
    await Promise.all([refreshing, searching]);
    expect(port.clearSession).toHaveBeenCalledOnce(); expect(port.clearAccount).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ user: null, collections: [], songs: [], busy: false, loggingOut: false, logoutError: true });
    await session.logout(); expect(session.getSnapshot().logoutError).toBe(false);
  });
  it('a disposed provider cannot publish, and effect restart rejects its old results', async () => {
    const { session, port } = setup(); const account = deferred<ProviderUser>(); const listener = vi.fn();
    session.subscribe(listener); port.api.getLoginStatus.mockReturnValueOnce(account.promise);
    const first = session.refresh(); session.dispose(); const calls = listener.mock.calls.length;
    await session.load({ query: 'disposed' }); expect(port.api.searchProviderSongs).not.toHaveBeenCalled();
    account.resolve({ id: 8, nickname: 'old' }); await first; expect(listener).toHaveBeenCalledTimes(calls);
    session.start(); await session.refresh(); expect(session.getSnapshot().user?.id).toBe(9);
  });
  it('an account change invalidates a pending private collection without leaving its spinner running', async () => {
    const { session, port } = setup(); await session.refresh();
    const pending = deferred<ProviderPage<UnifiedSong>>(); port.api.getCollectionTracks.mockReturnValueOnce(pending.promise);
    const loading = session.load({ collection: collection(1) }); port.api.getLoginStatus.mockResolvedValueOnce({ id: 10, nickname: 'new' });
    await session.refresh(); pending.resolve(page([song(99)])); await loading;
    expect(session.getSnapshot()).toMatchObject({ user: { id: 10 }, songs: [], busy: false, more: false });
  });
});
