import type { SongResult } from '../types';
import type { SubsonicSong, SubsonicPlaylist, Search3Response } from '../types/navidrome';
import type { NativeNavidromeSettings } from './nativeNavidrome';
import type { NavidromeGridViewCollectionDescriptor } from '../library/core/contracts/collection';
import type { LibraryNavidromeHomeData } from '../library/core/contracts/homeModel';
import { loadNavidromeHomeData } from '../library/core/services/navidromeHomeLibrary';
import { readNavidromeCollection } from '../library/core/services/navidromeCollectionRead';
import { DEFAULT_NAVIDROME_HOME_SECTION, type NavidromeHomeSection } from '../library/core/model/navidromeHomeModel';
import { createNavidromeSong } from '../services/navidromeSong';
import { buildNavidromeQueue } from '../services/playbackAdapters';
import { createMobileNavidromeConnection, safeNavidromeError } from './navidromeConnection';

// navidromeLibrary.ts — original overview/collection reads with one cancellable navigation lifetime.
type View = { kind: 'home' } | { kind: 'collection'; collection: NavidromeGridViewCollectionDescriptor } | { kind: 'search'; query: string };
type State = { view: View; section: NavidromeHomeSection; busy: boolean; error: string; home: LibraryNavidromeHomeData | null;
  songs: SongResult[]; search: Search3Response['searchResult3'] | null; playlist: SubsonicPlaylist | null };
export function nativeNavidromeSongs(settings: NativeNavidromeSettings, songs: SubsonicSong[]): SongResult[] {
  return buildNavidromeQueue(songs.map(song => {
    const converted = createNavidromeSong(song, '');
    converted.sourceRef = { kind: 'navidrome', scope: settings.scope, mediaId: song.id };
    converted.id = `navidrome:${settings.scope}:${song.id}`;
    return converted;
  }));
}
export function createMobileNavidromeLibrary(settings: NativeNavidromeSettings, current: () => boolean,
  connect = createMobileNavidromeConnection, waitForWrites: () => Promise<void> = () => Promise.resolve()) {
  let state: State = { view: { kind: 'home' }, section: DEFAULT_NAVIDROME_HOME_SECTION, busy: false, error: '', home: null, songs: [], search: null, playlist: null };
  let generation = 0, disposed = false, connection: ReturnType<typeof connect> | null = null;
  const listeners = new Set<() => void>();
  const commit = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const assertCurrent = () => { if (disposed || !current()) throw new Error('navidrome-settings-changed'); };
  const cancel = () => { generation++; connection?.dispose(); connection = null; };
  const load = async (view: View) => {
    if (disposed || !current()) return;
    cancel(); const ticket = generation;
    const client = connection = connect(settings);
    const valid = () => !disposed && current() && generation === ticket;
    commit({ view, busy: true, error: '', songs: [], search: null, playlist: null });
    try {
      await waitForWrites(); if (!valid()) return;
      if (view.kind === 'home') {
        const home = await loadNavidromeHomeData(client.api, client.settings, valid);
        if (valid()) commit({ home });
      } else if (view.kind === 'collection') {
        const playlist = view.collection.type === 'playlist' ? await client.api.getPlaylist(client.settings, view.collection.id) : null;
        const songs = view.collection.type === 'playlist' ? playlist?.entry ?? [] : await readNavidromeCollection(client.settings, view.collection, client.api, 2);
        if (valid()) commit({ songs: nativeNavidromeSongs(settings, songs), playlist,
          view: playlist ? { kind: 'collection', collection: { ...view.collection, name: playlist.name } } : view });
      } else {
        const search = await client.api.search(client.settings, view.query);
        if (valid()) commit({ search, songs: nativeNavidromeSongs(settings, search.song ?? []) });
      }
    } catch (error) { if (valid()) commit({ error: safeNavidromeError(error).message }); }
    finally { client.dispose(); if (connection === client) connection = null; if (valid()) commit({ busy: false }); }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    assertCurrent,
    start: () => { disposed = false; return load(state.view); },
    load: () => load(state.view),
    open: (collection: NavidromeGridViewCollectionDescriptor) => load({ kind: 'collection', collection }),
    search: (query: string) => query.trim() ? load({ kind: 'search', query: query.trim() }) : Promise.resolve(),
    home(section = state.section) { if (disposed || !current()) return Promise.resolve();
      cancel(); commit({ view: { kind: 'home' }, section, busy: false, error: '', songs: [], search: null, playlist: null });
      return state.home ? Promise.resolve() : load({ kind: 'home' }); },
    dispose() { disposed = true; cancel(); listeners.clear(); },
    invalidateHome() { if (!disposed && current()) commit({ home: null }); },
  };
}
export type MobileNavidromeLibrary = ReturnType<typeof createMobileNavidromeLibrary>;
