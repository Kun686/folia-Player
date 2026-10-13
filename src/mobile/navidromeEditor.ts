import { native, type FoliaNativePlugin } from './bridge';
import type { NativeNavidromeSettings } from './nativeNavidrome';
import type { SongResult } from '../types';
import type { SubsonicPlaylist, SubsonicResponse } from '../types/navidrome';
import { createNavidromeWriteApi, type NavidromeWriteOperation, type NavidromeWriteParameters } from '../services/navidromeWriteApi';
import { createMobileNavidromeConnection, safeNavidromeError, type MobileNavidromeConnection } from './navidromeConnection';

// navidromeEditor.ts — one account owns serialized writes across navigation; no automatic mutation retry.
type State = { busy: boolean; error: string; revision: number };
type Result<T> = { ok: true; value: T } | { ok: false };
export function createMobileNavidromeEditor(settings: NativeNavidromeSettings, current: () => boolean,
  bridge: Pick<FoliaNativePlugin, 'navidromeMutation'> = native, connect = createMobileNavidromeConnection) {
  let state: State = { busy: false, error: '', revision: 0 }, pending: Promise<unknown> | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const check = () => { if (!current()) throw Error('navidrome-settings-changed'); };
  const songID = (song: SongResult) => {
    check(); const ref = song.sourceRef;
    if (ref?.kind !== 'navidrome' || ref.scope !== settings.scope || !ref.mediaId) throw Error('navidrome-settings-changed');
    return String(ref.mediaId);
  };
  const name = (value: string) => { const text = value.trim(); if (!text || text.length > 512) throw Error('invalid-navidrome-request'); return text; };
  const owned = async (client: MobileNavidromeConnection, id: string) => {
    const playlist = await client.api.getPlaylist(settings, id); check();
    if (!playlist || playlist.id !== id || playlist.owner !== settings.username) throw Error('navidrome-forbidden');
    return playlist;
  };
  const wait = async () => { await pending?.catch(() => undefined); check(); };
  async function read<T>(work: (client: MobileNavidromeConnection) => Promise<T>) {
    await wait(); const client = connect(settings);
    try { const value = await work(client); check(); return value; } finally { client.dispose(); }
  }
  async function run<T>(work: (client: MobileNavidromeConnection, api: ReturnType<typeof createNavidromeWriteApi<NativeNavidromeSettings>>) => Promise<T>): Promise<Result<T>> {
    if (pending || state.error) return { ok: false };
    publish({ busy: true });
    let sent = false;
    const operation = Promise.resolve().then(async () => {
      check(); const client = connect(settings);
      const api = createNavidromeWriteApi<NativeNavidromeSettings>(async <T>(_config: NativeNavidromeSettings, operation: NavidromeWriteOperation, parameters: NavidromeWriteParameters) => {
        check(); sent = true;
        const reply = await bridge.navidromeMutation({ id: crypto.randomUUID(), revision: settings.revision, scope: settings.scope, operation,
          parameters: Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : String(value)])) });
        check();
        if (reply.scope !== settings.scope || reply.revision !== settings.revision) throw Error('navidrome-settings-changed');
        if (reply.response?.['subsonic-response']?.status !== 'ok') throw Error('navidrome-invalid-response');
        return reply.response as SubsonicResponse<T>;
      }, (_operation, cause) => { throw safeNavidromeError(cause); });
      try { const value = await work(client, api); check(); return value; } finally { client.dispose(); }
    });
    pending = operation;
    try { const value = await operation; publish({ revision: state.revision + 1 }); return { ok: true, value }; }
    catch (cause) { publish({ error: sent ? 'navidrome-write-unconfirmed' : safeNavidromeError(cause).message }); return { ok: false }; }
    finally { if (pending === operation) pending = null; publish({ busy: false }); }
  }
  return {
    wait: async () => { await pending?.catch(() => undefined); check(); },
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    // Called only after an explicit successful refresh; a failed/uncertain write is never repeated automatically.
    acknowledgeRefresh() { check(); if (!pending) publish({ error: '' }); },
    playlists: () => read(async client => (await client.api.getPlaylists(settings)).filter(list => list.owner === settings.username)),
    liked: (song: SongResult) => read(async client => {
      const id = songID(song), detail = await client.api.getSong(settings, id);
      if (!detail || detail.id !== id) throw Error('navidrome-invalid-response'); return !!detail.starred;
    }),
    toggleLike: (song: SongResult) => run(async (client, api) => {
      const id = songID(song), detail = await client.api.getSong(settings, id); check();
      if (!detail || detail.id !== id) throw Error('navidrome-invalid-response');
      const liked = !detail.starred;
      if (!await (liked ? api.star(settings, id) : api.unstar(settings, id))) throw Error('navidrome-invalid-response');
      return liked;
    }),
    create: (title: string, songs: SongResult[] = []) => run(async (_client, api) => {
      const created = await api.createPlaylist(settings, name(title), songs.map(songID));
      if (!created?.id) throw Error('navidrome-invalid-response'); return created;
    }),
    add: (id: string, songs: SongResult[]) => run(async (client, api) => {
      const ids = songs.map(songID); if (!ids.length) throw Error('invalid-navidrome-request');
      await owned(client, id);
      if (!await api.updatePlaylist(settings, id, { songIdsToAdd: ids })) throw Error('navidrome-invalid-response');
    }),
    rename: (id: string, title: string) => run(async (client, api) => {
      const next = name(title); await owned(client, id);
      if (!await api.updatePlaylist(settings, id, { name: next })) throw Error('navidrome-invalid-response');
    }),
    delete: (id: string) => run(async (client, api) => {
      await owned(client, id); if (!await api.deletePlaylist(settings, id)) throw Error('navidrome-invalid-response');
    }),
    remove: (expected: SubsonicPlaylist, index: number) => run(async (client, api) => {
      const fresh = await owned(client, expected.id), entries = expected.entry ?? [], actual = fresh.entry ?? [];
      // Subsonic removal is positional, including duplicate songs. Reject any observed shift before sending an index.
      if (!Number.isInteger(index) || !entries[index] || entries.length !== actual.length || entries.some((song, i) => song.id !== actual[i].id)
        || (expected.changed && expected.changed !== fresh.changed)) throw Error('navidrome-playlist-changed');
      if (!await api.updatePlaylist(settings, expected.id, { songIndexesToRemove: [index] })) throw Error('navidrome-invalid-response');
    }),
  };
}
export type MobileNavidromeEditor = ReturnType<typeof createMobileNavidromeEditor>;
// Keep in-flight writes and uncertainty across source switches and dialog dismissal, until the account checkpoint changes.
let owner: { settings: NativeNavidromeSettings; editor: MobileNavidromeEditor } | undefined;
export function getNavidromeEditor(settings: NativeNavidromeSettings, current: () => boolean) {
  if (owner?.settings !== settings) owner = { settings, editor: createMobileNavidromeEditor(settings, current) };
  return owner.editor;
}
