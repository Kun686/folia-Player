import { clearProviderAccountSnapshot } from '../services/onlineMusic/providerAccountCache';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { omni } from '../services/onlineMusic/omni';
import { createCatalogSession } from './catalogSession';
import { cancelProvider, captureGatewayConnection, captureProviderCredentials, clearProvider, flushSessions } from './runtime';

// src/mobile/useCatalog.ts — provider-scoped lifetime; all catalog requests still use Omni.
export const mobileCatalogPort = (provider: string) => ({
  api: omni, flush: () => flushSessions([provider]), cancel: () => cancelProvider(provider),
  clearSession: () => clearProvider(provider), clearAccount: () => clearProviderAccountSnapshot(provider),
  captureConnection: captureGatewayConnection,
  captureCredentials: () => captureProviderCredentials(provider),
});
export function useCatalog(provider: string, connected: boolean) {
  const session = useMemo(() => createCatalogSession(provider, mobileCatalogPort(provider)), [provider, connected]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    session.start();
    if (connected) void session.refresh();
    // Retire only this view's results. Capability discovery and tab navigation must not
    // revoke the same account's in-flight player lyrics/covers. Logout still cancels globally.
    return () => { session.dispose(); };
  }, [session, provider, connected]);
  return { ...state, provider, refresh: session.refresh, load: session.load, loadCollections: session.loadCollections,
    browseCollections: session.browseCollections,
    refreshCollection: session.refreshCollection, logout: session.logout, error: state.accountError || state.trackError || state.logoutError };
}
