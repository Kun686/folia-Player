import type { SongResult } from '../types';
import type { omni } from '../services/onlineMusic/omni';
import type { CollectionResource, CollectionResourceSnapshot } from '../library/core/contracts/resource';
import type { CollectionMutationController, CollectionMutationSnapshot, LibraryMutationResult } from '../library/core/contracts/mutations';
import { createOnlineCollectionResource } from '../library/core/services/onlineCollectionResource';
import { createCollectionMutationController } from '../library/core/services/collectionMutations';
import { readOnlineTracksCache, writeOnlineTracksCache } from '../library/core/services/onlineCollectionCache';
import { removeFromCache } from '../services/db';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { formatEntryKey } from '../library/core/model/collectionEntries';

// mobileDailyRecommendations.ts — original daily collection/date/removal rules, scoped to native credentials.
interface DailyState {
  phase: 'loading' | 'ready' | 'error'; busy: boolean; error: boolean; historyError: boolean;
  resource: CollectionResourceSnapshot | null; mutation: CollectionMutationSnapshot | null;
}
const empty = (): DailyState => ({ phase: 'loading', busy: false, error: false, historyError: false, resource: null, mutation: null });
export function createMobileDailyRecommendations(api: typeof omni, capture: (provider: string) => () => boolean, flush: (providers: readonly string[]) => Promise<void>) {
  const pending = new Map<string, Promise<unknown>>();
  return {
    createSession(provider: string) {
      let state = empty(), active = false, epoch = 0, locked = false;
      let resource: CollectionResource | null = null, controller: CollectionMutationController | null = null;
      let subscriptions: Array<() => void> = [];
      const listeners = new Set<() => void>();
      const publish = (patch: Partial<DailyState>) => { if (active) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); } };
      const release = () => { subscriptions.forEach(unsubscribe => unsubscribe()); subscriptions = [];
        controller?.dispose(); resource?.dispose(); controller = null; resource = null; };
      const start = async () => {
        if (locked) return;
        active = true; const ticket = ++epoch; release(); publish(empty());
        const same = capture(provider), alive = () => active && ticket === epoch;
        const check = () => { if (!alive() || !same()) throw new Error('daily-session-changed'); };
        const checked = async <T>(work: () => Promise<T>): Promise<T> => {
          try { check(); const result = await work(); check(); return result; }
          catch { throw new Error('daily-request-unconfirmed'); }
        };
        // Refreshing recommendations and disliking both change platform state. Never replay a sent request on reopening.
        const mutate = async <T>(work: () => Promise<T>): Promise<T> => {
          check(); if (pending.has(provider)) throw new Error('daily-busy');
          const operation = checked(async () => { await flush([provider]); check(); return work(); });
          pending.set(provider, operation);
          try { return await operation; }
          finally { if (pending.get(provider) === operation) pending.delete(provider); }
        };
        try {
          await pending.get(provider)?.catch(() => undefined); check();
          const user = await checked(() => api.getLoginStatus(provider));
          if (!user) throw new Error('daily-login-required');
          await checked(() => flush([provider]));
          const descriptor = { source: 'online' as const, providerId: provider, type: 'daily_recommendations', id: 'daily_recommendations', name: 'Daily recommendations' };
          const current = createOnlineCollectionResource(`daily:${provider}:${user.id}`, {
            getCollectionTracks: (collection, page) => checked(() => api.getCollectionTracks(collection, page)),
            getCollectionDetail: collection => checked(() => api.getCollectionDetail(collection)),
            getPersonalFm: () => checked(() => Promise.reject(new Error('unsupported'))),
            getDailySongs: () => checked(() => api.getProviderDailySongs(provider)),
            readCache: readOnlineTracksCache,
            writeCache: (...args) => alive() && same() ? writeOnlineTracksCache(...args) : Promise.resolve(),
          });
          resource = current;
          controller = createCollectionMutationController({ descriptor, resource: current, currentUserId: user.id, port: {}, removeCacheEntry: removeFromCache,
            omni: { ...api, canSubscribeCollection: () => false,
              getDailySongs: refresh => refresh ? mutate(() => api.getProviderDailySongs(provider, true)) : checked(() => api.getProviderDailySongs(provider)),
              getRecommendationHistorySongs: date => checked(() => api.getProviderRecommendationHistorySongs(provider, date)),
              getRecommendationHistoryDates: async () => {
                try { return await checked(() => api.getProviderRecommendationHistoryDates(provider)); }
                catch { if (alive()) publish({ historyError: true }); throw new Error('daily-history-unavailable'); }
              },
              dislikeSong: song => mutate(() => {
                if (song.sourceRef?.kind !== 'online' || song.sourceRef.providerId !== provider) throw new Error('wrong-provider');
                return api.dislikeSong(song);
              }),
            },
          });
          const mutation = controller;
          const update = () => {
            if (!alive()) return;
            publish(same() ? { resource: current.getSnapshot(), mutation: mutation.getSnapshot() } : { phase: 'error', resource: null });
          };
          subscriptions = [current.subscribe(update), mutation.subscribe(update)];
          publish({ phase: 'ready' }); current.ensure(descriptor, { currentUserId: user.id }); update();
        } catch { if (alive()) publish({ phase: 'error' }); }
      };
      const act = async (work: (value: CollectionMutationController) => Promise<LibraryMutationResult>) => {
        if (!active || !controller || locked || state.phase !== 'ready' || state.error || state.resource?.status !== 'ready') return;
        locked = true; const ticket = epoch; publish({ busy: true, error: false });
        try { const result = await work(controller); if (ticket === epoch) publish({ error: !result.ok && result.reason !== 'limit-reached' }); }
        catch { if (ticket === epoch) publish({ error: true }); }
        finally { locked = false; if (ticket === epoch) publish({ busy: false }); }
      };
      return {
        getSnapshot: () => state,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        start,
        dispose() { active = false; epoch++; release(); },
        selectDate: (date: string, refresh = false) => act(value => value.setDailyDate(date, { afresh: refresh })),
        remove: (song: SongResult) => act(value => resource?.getSnapshot().tracks.some(track => getPlaybackSongKey(track) === getPlaybackSongKey(song))
          ? value.removeEntry({ track: song, entryKey: formatEntryKey(getPlaybackSongKey(song), 0) })
          : Promise.resolve({ ok: false, reason: 'stale' })),
      };
    },
  };
}
