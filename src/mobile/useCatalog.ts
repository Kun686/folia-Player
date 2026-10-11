import { clearProviderAccountSnapshot } from '../services/onlineMusic/providerAccountCache';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { omni } from '../services/onlineMusic/omni';
import { createCatalogSession } from './catalogSession';
import { cancelProvider, clearProvider, flushSessions } from './runtime';

// src/mobile/useCatalog.ts — provider-scoped lifetime; all catalog requests still use Omni.
export function useCatalog(provider: string, connected: boolean) {
  const session = useMemo(() => createCatalogSession(provider, {
    api: omni, flush: flushSessions, cancel: () => cancelProvider(provider),
    clearSession: () => clearProvider(provider), clearAccount: () => clearProviderAccountSnapshot(provider),
  }), [provider, connected]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    session.start();
    if (connected) void session.refresh();
    return () => { session.dispose(); void cancelProvider(provider).catch(() => {}); };
  }, [session, provider, connected]);
  return { ...state, refresh: session.refresh, load: session.load, loadCollections: session.loadCollections,
    logout: session.logout, error: state.accountError || state.trackError || state.logoutError };
}
