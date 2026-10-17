import type { UnifiedSong } from '../types';
import { OnlineProviderError, type ProviderCollection, type ProviderErrorCode, type ProviderUser } from '../types/onlineMusic';
import type { omni } from '../services/onlineMusic/omni';
import { collectionKey } from '../library/core/model/collectionIdentity';

// catalogSession.ts — independent account/track requests, scoped to one mobile provider view.
export interface CatalogPort {
  api: Pick<typeof omni, 'getLoginStatus' | 'getProviderUserPlaylists' | 'getCollectionTracks' | 'searchProviderSongs' | 'logout'>;
  flush(): Promise<void>;
  cancel(): Promise<void>;
  clearSession(): Promise<void>;
  clearAccount(): Promise<unknown>;
  captureConnection(): () => boolean;
  captureCredentials(): () => boolean;
}
export interface CatalogState {
  user: ProviderUser | null; collections: ProviderCollection[]; songs: UnifiedSong[];
  collection: ProviderCollection | null; searchQuery: string | null;
  accountChecked: boolean; accountBusy: boolean; busy: boolean; loggingOut: boolean; collectionsMore: boolean; more: boolean;
  accountError: boolean; trackError: boolean; logoutError: boolean;
  trackErrorCode: ProviderErrorCode | null;
}
type TrackInput = { query?: string; collection?: ProviderCollection };
const empty = (): CatalogState => ({ user: null, collections: [], songs: [], collection: null, searchQuery: null, accountChecked: false, accountBusy: false, busy: false, loggingOut: false,
  collectionsMore: false, more: false, accountError: false, trackError: false, trackErrorCode: null, logoutError: false });
export const mobileCollectionKey = (value: ProviderCollection) => collectionKey({ ...value, source: 'online' });

export function createCatalogSession(provider: string, port: CatalogPort) {
  let state = empty(), active = false, leaving = false;
  let accountEpoch = 0, trackEpoch = 0, collectionOffset = 0;
  let tracks: (TrackInput & { offset: number }) | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CatalogState>) => {
    if (!active) return;
    state = { ...state, ...patch }; listeners.forEach(listener => listener());
  };
  const currentAccount = (request: number) => active && !leaving && request === accountEpoch;
  // Stop on a non-advancing cursor instead of repeating the same page indefinitely.
  const canContinue = (hasMore: boolean, next: number, offset: number) => {
    if (hasMore && (!Number.isSafeInteger(next) || next <= offset)) throw Error('catalog-pagination-stalled');
    return hasMore;
  };
  const readCollections = async (user: ProviderUser, offset: number, request: number) => {
    const page = await port.api.getProviderUserPlaylists(provider, user.id, { limit: 100, offset });
    if (!currentAccount(request)) return;
    const collectionsMore = canContinue(page.hasMore, page.nextOffset, offset);
    const rows = offset ? [...state.collections, ...page.items] : page.items;
    const collections = [...new Map(rows.map(value => [mobileCollectionKey(value), value])).values()];
    collectionOffset = page.nextOffset; publish({ collections, collectionsMore });
  };
  const refresh = async () => {
    if (!active || leaving) return false;
    const request = ++accountEpoch;
    publish({ accountChecked: false, accountBusy: true, accountError: false, logoutError: false });
    try {
      const user = await port.api.getLoginStatus(provider);
      if (!currentAccount(request)) return false;
      if (String(user?.id) !== String(state.user?.id)) {
        collectionOffset = 0; publish({ collections: [], collectionsMore: false });
        if (tracks?.collection) { trackEpoch++; tracks = null; publish({ songs: [], collection: null, more: false, busy: false, trackError: false, trackErrorCode: null }); }
      }
      // A null user is only anonymous after status resolves, independently of playlist work.
      publish({ user, accountChecked: true });
      // Login persistence does not depend on a successful playlist response.
      await port.flush();
      if (!currentAccount(request)) return false;
      if (user) await readCollections(user, 0, request);
      else { collectionOffset = 0; publish({ collections: [], collectionsMore: false }); }
      return currentAccount(request) && !!user;
    } catch { if (currentAccount(request)) publish({ accountError: true }); return false; }
    finally { if (currentAccount(request)) publish({ accountBusy: false }); }
  };
  const loadCollections = async () => {
    if (!active || leaving || state.accountBusy || !state.user || !state.collectionsMore) return;
    const request = ++accountEpoch;
    publish({ accountBusy: true, accountError: false });
    try { await readCollections(state.user, collectionOffset, request); }
    catch { if (currentAccount(request)) publish({ accountError: true }); }
    finally { if (currentAccount(request)) publish({ accountBusy: false }); }
  };
  const load = async (input?: TrackInput) => {
    if (!active || leaving || (!input && (state.busy || (!state.more && !state.trackError) || !tracks))) return;
    const request = ++trackEpoch;
    if (input) { tracks = { ...input, offset: 0 }; publish({ songs: [], collection: input.collection ?? null,
      searchQuery: input.collection ? null : input.query ?? '', more: false }); }
    const page = { ...tracks! };
    publish({ busy: true, trackError: false, trackErrorCode: null });
    try {
      const result = page.collection
        ? await port.api.getCollectionTracks(page.collection, { limit: 50, offset: page.offset })
        : await port.api.searchProviderSongs(provider, page.query ?? '', { limit: 50, offset: page.offset });
      if (!active || request !== trackEpoch) return;
      const more = canContinue(result.hasMore, result.nextOffset, page.offset);
      tracks = { ...page, offset: result.nextOffset };
      publish({ songs: page.offset ? [...state.songs, ...result.items] : result.items, more });
    } catch (error) { if (active && request === trackEpoch) publish({ trackError: true,
      trackErrorCode: error instanceof OnlineProviderError ? error.code : null }); }
    finally { if (active && request === trackEpoch) publish({ busy: false }); }
  };
  const logout = async () => {
    if (!active || leaving) return;
    const connectionCurrent = port.captureConnection(), credentialsCurrent = port.captureCredentials();
    leaving = true; const request = ++accountEpoch; trackEpoch++; tracks = null; collectionOffset = 0;
    publish({ ...empty(), busy: true, loggingOut: true });
    let failed = false, obsolete = false;
    if (connectionCurrent()) {
      try { await port.cancel(); } catch { failed = true; }
      // The remote adapter captures its own session only when invoked. Do not invoke it with
      // credentials that replaced the account while native cancellation was still pending.
      obsolete = !credentialsCurrent();
      if (!failed && !obsolete && connectionCurrent()) {
        try { await port.api.logout(provider); }
        catch (error) {
          failed = true;
          obsolete = error instanceof Error && error.name === 'AbortError';
        }
      }
    }
    // Each local cleanup must run even when the upstream logout or the other cleanup fails.
    // An obsolete request belongs to a replaced session; never clear the replacement's state.
    if (!obsolete && connectionCurrent()) {
      const cleanup = await Promise.allSettled([port.clearSession(), port.clearAccount()]);
      failed ||= cleanup.some(result => result.status === 'rejected');
    } else { failed = true; }
    if (active && request === accountEpoch) { leaving = false; publish({ accountChecked: true, busy: false, loggingOut: false, logoutError: failed }); }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() { active = true; leaving = false; accountEpoch++; trackEpoch++; tracks = null; collectionOffset = 0; publish(empty()); },
    dispose() { active = false; accountEpoch++; trackEpoch++; },
    refresh, load, loadCollections, logout,
    browseCollections() {
      if (!active || leaving) return;
      // Retire only this view's pending page; playback resources share the provider session.
      trackEpoch++; tracks = null;
      publish({ songs: [], collection: null, searchQuery: null, more: false, busy: false,
        trackError: false, trackErrorCode: null });
    },
    refreshCollection(collection: ProviderCollection) {
      if (active && tracks?.collection && mobileCollectionKey(tracks.collection) === mobileCollectionKey(collection)) {
        return load({ collection: tracks.collection });
      }
    },
  };
}
