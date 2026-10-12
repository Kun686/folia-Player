import type { SongResult } from '../types';
import type { ProviderCollection, ProviderUser } from '../types/onlineMusic';
import type { omni } from '../services/onlineMusic/omni';
import type { CollectionResource } from '../library/core/contracts/resource';
import { resolveCollectionMutationBranches } from '../library/core/model/collectionMutationCapabilities';
import { createCollectionMutationController } from '../library/core/services/collectionMutations';
import { resolveOnlineTracksCacheKey } from '../library/core/services/onlineCollectionCache';
import { getProviderCacheKey } from '../services/onlineMusic/providerStorage';

// mobilePlaylistEditor.ts — original collection rules with native-session ownership and writes surviving dialog dismissal.
export interface PlaylistAccount { user: ProviderUser; current(): boolean }
export function createMobilePlaylistEditor(api: typeof omni, capture: (provider: string) => () => boolean,
  flush: () => Promise<void>, removeCache: (key: string) => Promise<void>, changed: (collection: ProviderCollection) => void) {
  const pending = new Map<string, Promise<void>>();
  const canEdit = (collection: ProviderCollection, user: ProviderUser) => resolveCollectionMutationBranches({
    descriptor: { ...collection, source: 'online' }, resourceKind: 'online', currentUserId: user.id,
    canEditCollectionTracks: api.canEditCollectionTracks(collection), canSubscribeCollection: false,
    isCloudDrive: false, dailyDate: '', port: {},
  }).canEditPlaylist;
  const wait = async (provider: string) => { await pending.get(provider)?.catch(() => undefined); };
  const readAccount = async (provider: string): Promise<PlaylistAccount> => {
    const current = capture(provider);
    await wait(provider);
    if (!current()) throw new Error('account-changed');
    const user = await api.getLoginStatus(provider);
    await flush();
    if (!current() || !user) throw new Error('account-required');
    return { user, current };
  };
  // A sent write is never retried automatically. The next reader waits for it to settle.
  const run = async (collection: ProviderCollection, account: PlaylistAccount, work: () => Promise<void>) => {
    if (pending.has(collection.providerId)) throw new Error('playlist-busy');
    const operation = Promise.resolve().then(async () => {
      if (!account.current() || !canEdit(collection, account.user)) throw new Error('account-changed');
      await flush();
      const user = await api.getLoginStatus(collection.providerId);
      if (!account.current() || !user || String(user.id) !== String(account.user.id)) throw new Error('account-changed');
      await work();
      if (!account.current()) throw new Error('account-changed');
    });
    pending.set(collection.providerId, operation);
    try { await operation; }
    catch { throw new Error('playlist-edit-unconfirmed'); }
    finally { if (pending.get(collection.providerId) === operation) pending.delete(collection.providerId); }
  };
  const validateSong = (song: SongResult, collection: ProviderCollection) => {
    if (song.sourceRef?.kind !== 'online' || song.sourceRef.providerId !== collection.providerId) throw new Error('wrong-provider');
  };
  return {
    canEdit, wait, readAccount,
    async add(song: SongResult, collection: ProviderCollection, account: PlaylistAccount) {
      validateSong(song, collection);
      if (!api.canAddSongToPlaylist(song)) throw new Error('unsupported');
      await run(collection, account, () => api.updateCollectionTracks(collection, 'add', [song]));
      await Promise.all([removeCache(resolveOnlineTracksCacheKey(collection)),
        removeCache(getProviderCacheKey(collection.providerId, `playlist_detail_${collection.id}`))])
        .catch(() => console.warn('[MobilePlaylist] Cache invalidation failed'));
      if (account.current()) changed(collection);
    },
    removals(collection: ProviderCollection, resource: CollectionResource, account: PlaylistAccount) {
      return createCollectionMutationController({ descriptor: { ...collection, source: 'online' }, resource,
        currentUserId: account.user.id, removeCacheEntry: removeCache,
        port: { onCollectionMutated: () => { if (account.current()) changed(collection); } },
        omni: { ...api, canSubscribeCollection: () => false,
          canEditCollectionTracks: value => account.current() && api.canEditCollectionTracks(value),
          updateCollectionTracks: (value, operation, songs) => {
            songs.forEach(song => validateSong(song, value));
            return run(value, account, () => api.updateCollectionTracks(value, operation, songs));
          },
          likeSong: (song, liked) => run(collection, account, () => api.likeSong(song, liked, { isCurrent: account.current })),
        },
      });
    },
  };
}
export type MobilePlaylistEditor = ReturnType<typeof createMobilePlaylistEditor>;
