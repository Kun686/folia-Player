import { clearProviderAccountSnapshot } from '../services/onlineMusic/providerAccountCache';
import { useCallback, useEffect, useRef, useState } from 'react';
import { omni } from '../services/onlineMusic/omni';
import type { UnifiedSong } from '../types';
import type { ProviderCollection, ProviderUser } from '../types/onlineMusic';
import { cancelProvider, clearProvider, flushSessions } from './runtime';

// src/mobile/useCatalog.ts — UI calls only Omni; stale searches and account refreshes are discarded.
export function useCatalog(provider: string, connected: boolean) {
  const [songs, setSongs] = useState<UnifiedSong[]>([]);
  const [collections, setCollections] = useState<ProviderCollection[]>([]);
  const [user, setUser] = useState<ProviderUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const epoch = useRef(0);
  const paging = useRef<{ query?: string; collection?: ProviderCollection; offset: number }>({ offset: 0 });
  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    try {
      const account = await omni.getLoginStatus(provider);
      if (request !== epoch.current) return false;
      setUser(account);
      const result = account ? await omni.getProviderUserPlaylists(provider, account.id, { limit: 100, offset: 0 }) : null;
      if (request !== epoch.current) return false;
      setCollections(result?.items ?? []); await flushSessions();
      return !!account;
    } catch { if (request === epoch.current) setError('account'); return false; }
  }, [provider]);
  useEffect(() => {
    epoch.current++; setUser(null); setSongs([]); setCollections([]); setError(''); setMore(false);
    paging.current = { offset: 0 };
    if (connected) void refresh();
    return () => { epoch.current++; void cancelProvider(provider); };
  }, [provider, connected, refresh]);
  const load = async (input?: { query?: string; collection?: ProviderCollection }) => {
    const request = ++epoch.current;
    if (input) { paging.current = { ...input, offset: 0 }; setSongs([]); }
    const page = { ...paging.current };
    setBusy(true); setError('');
    try {
      const result = page.collection
        ? await omni.getCollectionTracks(page.collection, { limit: 50, offset: page.offset })
        : await omni.searchProviderSongs(provider, page.query ?? '', { limit: 50, offset: page.offset });
      if (request !== epoch.current) return;
      setSongs(previous => page.offset ? [...previous, ...result.items] : result.items);
      setMore(result.hasMore); paging.current.offset = result.nextOffset;
    } catch { if (request === epoch.current) setError('catalog'); }
    finally { if (request === epoch.current) setBusy(false); }
  };
  const logout = async () => {
    epoch.current++; setUser(null); setCollections([]); setSongs([]); setMore(false); setBusy(true);
    await cancelProvider(provider);
    try { await omni.logout(provider); } catch { setError('logout'); }
    finally { await clearProvider(provider); await clearProviderAccountSnapshot(provider); setBusy(false); }
  };
  return { songs, collections, user, busy, error, more, refresh, load, logout };
}
