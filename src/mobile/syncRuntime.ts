import { native } from './bridge';
import type { NativeSyncOperation, NativeSyncSettings, NativeSyncSettingsEdit } from './nativeSync';
import type { SyncConnection } from '../services/sync/syncConnection';
import { SYNC_PROVIDER } from '../services/sync/syncTypes';

// syncRuntime.ts — public Keychain snapshot and cancellable session transport; no persistent JS token or arbitrary endpoint forwarding.
let snapshot: NativeSyncSettings | null = null;
let epoch = 0;
const pending = new Set<string>();
const routes: Record<string, NativeSyncOperation> = {
  'GET /health': 'health', 'GET /state': 'state', 'GET /settings': 'settingsRead', 'PUT /settings': 'settingsWrite',
  'GET /themes/manifest': 'themeManifest', 'POST /themes/get': 'themeGet', 'POST /themes/put': 'themePut',
  'POST /themes/bucket': 'themeBuckets', 'POST /themes/list': 'themeList',
};
export function cancelMobileSync() {
  epoch++;
  for (const id of pending) void native.cancelSyncRequest({ id }).catch(() => undefined);
}
function publish(value: NativeSyncSettings) {
  if (snapshot && value.revision < snapshot.revision) return snapshot;
  if (value.revision !== snapshot?.revision || value.scope !== snapshot?.scope) cancelMobileSync();
  snapshot = value;
  window.dispatchEvent(new Event('folia-sync-config-changed'));
  return value;
}
export async function loadMobileSyncSettings() { return publish(await native.getSyncSettings()); }
export async function saveMobileSyncSettings(revision: number, settings: NativeSyncSettingsEdit) {
  // Native configure atomically saves and cancels old transfers before publishing this new session.
  return publish(await native.setSyncSettings({ revision, settings }));
}
export function mobileSyncConnection(): SyncConnection {
  const settings = snapshot, intent = epoch;
  const assertCurrent = () => {
    if (intent !== epoch || settings?.revision !== snapshot?.revision || settings?.scope !== snapshot?.scope) throw new Error('sync-cancelled');
  };
  return {
    provider: SYNC_PROVIDER, enabled: settings?.enabled ?? false, workerBaseUrl: settings?.baseURL ?? '', authToken: '',
    nativeSession: { hasToken: settings?.hasToken ?? false, scope: settings?.scope ?? 'unconfigured', assertCurrent,
      async request(path, init) {
        assertCurrent();
        if (!settings) throw new Error('sync-not-configured');
        const operation = routes[`${init.method ?? 'GET'} ${path}`];
        if (!operation || (init.body != null && typeof init.body !== 'string')) throw new Error('invalid-sync-request');
        init.signal?.throwIfAborted();
        const id = crypto.randomUUID();
        const abort = () => { void native.cancelSyncRequest({ id }).catch(() => undefined); };
        pending.add(id); init.signal?.addEventListener('abort', abort, { once: true });
        try {
          const result = await native.syncRequest({ id, revision: settings.revision, operation,
            ...(typeof init.body === 'string' ? { body: init.body } : {}) });
          assertCurrent(); init.signal?.throwIfAborted();
          return new Response([204, 205, 304].includes(result.status) ? null : result.body, {
            status: result.status, headers: { 'Content-Type': result.contentType },
          });
        } finally { pending.delete(id); init.signal?.removeEventListener('abort', abort); }
      },
    },
  };
}
