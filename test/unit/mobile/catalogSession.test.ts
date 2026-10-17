import { describe, expect, it, vi } from 'vitest';
import { createCatalogSession, type CatalogPort } from '../../../src/mobile/catalogSession';
import type { ProviderCollection, ProviderPage, ProviderUser } from '../../../src/types/onlineMusic';
import { OnlineProviderError } from '../../../src/types/onlineMusic';
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
function setup(provider = 'qq') {
  const connection = { current: true };
  const port = {
    api: { getLoginStatus: vi.fn().mockResolvedValue({ id: 9, nickname: 'account' }),
      getProviderUserPlaylists: vi.fn().mockResolvedValue(page([collection(1)])),
      getCollectionTracks: vi.fn().mockResolvedValue(page([song(1)])),
      searchProviderSongs: vi.fn().mockResolvedValue(page([song(2)])), logout: vi.fn().mockResolvedValue(undefined) },
    flush: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined), clearAccount: vi.fn().mockResolvedValue(undefined),
    captureConnection: vi.fn(() => () => connection.current),
    captureCredentials: vi.fn(() => () => true),
  } satisfies CatalogPort;
  const session = createCatalogSession(provider, port); session.start();
  return { session, port, connection };
}
describe('mobile catalog session', () => {
  it('returns to playlists without clearing the account or accepting a late track page', async () => {
    const { session, port } = setup(); await session.refresh();
    const old = deferred<ProviderPage<UnifiedSong>>(); port.api.getCollectionTracks.mockReturnValueOnce(old.promise);
    const loading = session.load({ collection: collection(1) });
    session.browseCollections();
    expect(session.getSnapshot()).toMatchObject({ collection: null, searchQuery: null, songs: [], busy: false,
      more: false, user: { id: 9 }, collections: [collection(1)] });
    old.resolve(page([song(99)], 1, true)); await loading;
    expect(session.getSnapshot()).toMatchObject({ songs: [], collection: null, more: false, busy: false });
    await session.load(); expect(port.api.getCollectionTracks).toHaveBeenCalledTimes(1);
    expect(port.cancel).not.toHaveBeenCalled(); expect(port.clearSession).not.toHaveBeenCalled();
    await session.load({ collection: collection(1) }); expect(session.getSnapshot().songs).toEqual([song(1)]);
  });
  it('does not revive search errors after returning to playlists', async () => {
    const { session, port } = setup(); let reject!: (error: Error) => void;
    port.api.searchProviderSongs.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const loading = session.load({ query: 'Power' }); session.browseCollections();
    reject(new OnlineProviderError('unavailable', 'safe', 'qq')); await loading;
    expect(session.getSnapshot()).toMatchObject({ searchQuery: null, songs: [], busy: false, trackError: false, trackErrorCode: null });
  });
  describe('account resolution', () => {
    it('starts unresolved before the first request and resolves independently of playlist loading', async () => {
      const { session, port } = setup();
      expect(session.getSnapshot()).toMatchObject({ accountChecked: false, user: null });
      const account = deferred<ProviderUser>(), playlists = deferred<ProviderPage<ProviderCollection>>();
      port.api.getLoginStatus.mockReturnValueOnce(account.promise);
      port.api.getProviderUserPlaylists.mockReturnValueOnce(playlists.promise);
      const pending = session.refresh();
      expect(session.getSnapshot()).toMatchObject({ accountChecked: false, accountBusy: true });
      account.resolve({ id: 9, nickname: 'account' });
      await vi.waitFor(() => expect(port.api.getProviderUserPlaylists).toHaveBeenCalledOnce());
      expect(session.getSnapshot()).toMatchObject({ accountChecked: true, user: { id: 9 }, accountBusy: true });
      playlists.resolve(page([])); await pending;
    });
    it('distinguishes a confirmed anonymous account from an unchecked account', async () => {
      const { session, port } = setup(); port.api.getLoginStatus.mockResolvedValueOnce(null);
      await session.refresh();
      expect(session.getSnapshot()).toMatchObject({ accountChecked: true, user: null, accountError: false });
      expect(port.api.getProviderUserPlaylists).not.toHaveBeenCalled();
    });
    it('keeps a failed account read unresolved and permits a successful retry', async () => {
      const { session, port } = setup(); port.api.getLoginStatus.mockRejectedValueOnce(Error('offline'));
      await session.refresh();
      expect(session.getSnapshot()).toMatchObject({ accountChecked: false, user: null, accountBusy: false, accountError: true });
      await session.refresh();
      expect(session.getSnapshot()).toMatchObject({ accountChecked: true, user: { id: 9 }, accountError: false });
    });
    it('does not confuse a playlist failure with an unconfirmed account', async () => {
      const { session, port } = setup(); port.api.getProviderUserPlaylists.mockRejectedValueOnce(Error('offline'));
      await session.refresh();
      expect(session.getSnapshot()).toMatchObject({ accountChecked: true, user: { id: 9 }, accountError: true });
    });
    it('keeps the previous user during a refresh but rechecks anonymous state', async () => {
      const { session, port } = setup(); await session.refresh();
      port.api.getLoginStatus.mockRejectedValueOnce(Error('offline'));
      await session.refresh();
      expect(session.getSnapshot()).toMatchObject({ accountChecked: false, user: { id: 9 }, accountError: true });
      port.api.getLoginStatus.mockResolvedValueOnce(null); await session.refresh();
      const account = deferred<ProviderUser>(); port.api.getLoginStatus.mockReturnValueOnce(account.promise);
      const pending = session.refresh();
      expect(session.getSnapshot()).toMatchObject({ accountChecked: false, user: null, accountError: false });
      account.resolve({ id: 10, nickname: 'new' }); await pending;
    });
    it('logout resolves to signed out and a late account response cannot change it', async () => {
      const { session, port } = setup(); const account = deferred<ProviderUser>();
      port.api.getLoginStatus.mockReturnValueOnce(account.promise);
      const pending = session.refresh(); await session.logout();
      account.resolve({ id: 9, nickname: 'old' }); await pending;
      expect(session.getSnapshot()).toMatchObject({ accountChecked: true, user: null, loggingOut: false });
      session.dispose(); session.start();
      expect(session.getSnapshot()).toMatchObject({ accountChecked: false, user: null });
    });
  });
  it.each(['unavailable', 'auth-required', 'invalid-response'] as const)('retains structured %s failure without clearing the account, then clears it on recovery', async code => {
    const { session, port } = setup();
    await session.refresh();
    port.api.searchProviderSongs.mockRejectedValueOnce(new OnlineProviderError(code, 'safe', 'qq'))
      .mockResolvedValueOnce(page([]));
    await session.load({ query: 'Power' });
    expect(session.getSnapshot()).toMatchObject({ trackError: true, trackErrorCode: code, user: { id: 9 } });
    expect(port.clearSession).not.toHaveBeenCalled();
    expect(port.api.logout).not.toHaveBeenCalled();
    await session.load();
    expect(session.getSnapshot()).toMatchObject({ trackError: false, trackErrorCode: null, songs: [] });
  });
  it('does not let a late classified failure replace a newer successful search', async () => {
    const { session, port } = setup();
    let reject!: (error: Error) => void;
    port.api.searchProviderSongs.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }))
      .mockResolvedValueOnce(page([]));
    const old = session.load({ query: 'Power' });
    await session.load({ query: '小半' });
    reject(new OnlineProviderError('unavailable', 'safe', 'qq')); await old;
    expect(session.getSnapshot()).toMatchObject({ searchQuery: '小半', trackError: false, trackErrorCode: null });
    await session.logout();
    expect(session.getSnapshot()).toMatchObject({ trackError: false, trackErrorCode: null, user: null });
  });
  it('retains the submitted search identity through paging and clears it for collections and logout', async () => {
    const { session, port } = setup();
    expect(session.getSnapshot().searchQuery).toBeNull();
    port.api.searchProviderSongs.mockResolvedValueOnce(page([song(1)], 1, true));
    await session.load({ query: 'submitted' }); await session.load();
    expect(session.getSnapshot().searchQuery).toBe('submitted');
    await session.load({ collection: collection(1) }); expect(session.getSnapshot().searchQuery).toBeNull();
    await session.load({ query: 'another' }); await session.logout(); expect(session.getSnapshot().searchQuery).toBeNull();
  });
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
  it.each(['qq', 'netease'])('does not send an old %s logout or clear a replacement connection after cancellation waits', async provider => {
    const { session, port, connection } = setup(provider);
    const cancellation = deferred<void>(); port.cancel.mockReturnValueOnce(cancellation.promise);
    const pending = session.logout();
    connection.current = false; cancellation.resolve(); await pending;
    expect(port.api.logout).not.toHaveBeenCalled();
    expect(port.clearSession).not.toHaveBeenCalled(); expect(port.clearAccount).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ loggingOut: false, logoutError: true });
  });
  it.each(['qq', 'netease'])('preserves the new connection after a pending %s logout response', async provider => {
    const { session, port, connection } = setup(provider);
    const reply = deferred<void>(); port.api.logout.mockReturnValueOnce(reply.promise);
    const pending = session.logout();
    await vi.waitFor(() => expect(port.api.logout).toHaveBeenCalledExactlyOnceWith(provider));
    connection.current = false; reply.resolve(); await pending;
    expect(port.clearSession).not.toHaveBeenCalled(); expect(port.clearAccount).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ loggingOut: false, logoutError: true });
  });
  it.each(['qq', 'netease'])('does not clear %s when its remote logout was invalidated by a newer session', async provider => {
    const { session, port } = setup(provider);
    port.api.logout.mockRejectedValueOnce(new DOMException('Canceled', 'AbortError'));
    await session.logout();
    expect(port.clearSession).not.toHaveBeenCalled(); expect(port.clearAccount).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ loggingOut: false, logoutError: true });
    await session.logout();
    expect(port.clearSession).toHaveBeenCalledOnce(); expect(port.clearAccount).toHaveBeenCalledOnce();
    expect(session.getSnapshot().logoutError).toBe(false);
  });
  it.each(['qq', 'netease'])('still clears %s locally after an ordinary remote logout failure', async provider => {
    const { session, port } = setup(provider);
    port.api.logout.mockRejectedValueOnce(Error('offline'));
    await session.logout();
    expect(port.clearSession).toHaveBeenCalledOnce(); expect(port.clearAccount).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ loggingOut: false, logoutError: true });
  });
  it('does not start logout against a connection already being replaced', async () => {
    const { session, port, connection } = setup(); connection.current = false;
    await session.logout();
    expect(port.cancel).not.toHaveBeenCalled(); expect(port.api.logout).not.toHaveBeenCalled();
    expect(port.clearSession).not.toHaveBeenCalled(); expect(port.clearAccount).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ loggingOut: false, logoutError: true });
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
