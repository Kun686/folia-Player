import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalPlaylist, SongResult } from '../types';
import { native, isNative } from './bridge';
import { MobilePlaylistDatabase, createMobilePlaylistStorage } from './localPlaylistStorage';

// useLocalPlaylists.ts — shared transactional storage; only the latest read can replace the displayed lists.
const storage = createMobilePlaylistStorage(new MobilePlaylistDatabase(), async () => (await native.localCatalog({ requireComplete: true })).songs);
export type PlaylistRequest = { type: 'create' | 'add'; songs: SongResult[] } | { type: 'rename'; playlist: LocalPlaylist };
export type PlaylistFileRequest = { type: 'import' } | { type: 'export'; playlist: LocalPlaylist };
export function useLocalPlaylists(songs: SongResult[]) {
  const [lists, setLists] = useState<LocalPlaylist[]>([]), [ready, setReady] = useState(false);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<PlaylistRequest | null>(null);
  const [fileRequest, setFileRequest] = useState<PlaylistFileRequest | null>(null);
  const mounted = useRef(false), sequence = useRef(0), locked = useRef(false);
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current;
    try {
      const value = await storage.list();
      if (mounted.current && ticket === sequence.current) { setLists(value); setReady(true); setError(false); }
    } catch { if (mounted.current && ticket === sequence.current) setError(true); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const restore = () => { if (!document.hidden && isNative) void refresh(); };
    restore(); document.addEventListener('visibilitychange', restore);
    return () => { mounted.current = false; sequence.current++; document.removeEventListener('visibilitychange', restore); };
  }, [songs, refresh]);
  const run = async (work: () => Promise<unknown>) => {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError(false);
    try { await work(); await refresh(); return true; }
    catch { if (mounted.current) setError(true); return false; }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const isFavorite = (song: SongResult) => song.sourceRef?.kind === 'local'
    && Boolean(lists.find(list => list.isFavorite)?.songIds.includes(song.sourceRef.mediaId));
  return { lists, ready, busy, error, refresh, run, storage, request, setRequest, fileRequest, setFileRequest, isFavorite,
    add: (items: SongResult[]) => setRequest({ type: 'add', songs: items.filter(song => song.sourceRef?.kind === 'local') }),
    create: (items: SongResult[] = []) => setRequest({ type: 'create', songs: items.filter(song => song.sourceRef?.kind === 'local') }),
    favorite: (song: SongResult) => run(() => storage.favorite(song, !isFavorite(song))),
  };
}
export type LocalPlaylists = ReturnType<typeof useLocalPlaylists>;
