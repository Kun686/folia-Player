import { native, type FoliaNativePlugin } from './bridge';
import type { NativeNavidromeSettings } from './nativeNavidrome';
import type { SubsonicResponse } from '../types/navidrome';
import { createNavidromeReadApi, type NavidromeReadOperation, type NavidromeReadParameters } from '../services/navidromeReadApi';
import type { PlaybackSourceRef } from '../types/onlineMusic';

// navidromeConnection.ts — one connection owns native read scheduling; no password, signed media URL or localStorage.
type Bridge = Pick<FoliaNativePlugin, 'navidromeRequest' | 'cancelNavidromeRequest'>;
type Pending = { id: string; start: () => void; reject: (reason: Error) => void };
const MAX_PENDING = 64;
const knownErrors = new Set(['secure-storage', 'invalid-navidrome-request', 'invalid-navidrome-settings',
  'navidrome-auth-required', 'navidrome-settings-changed', 'navidrome-cancelled', 'navidrome-disabled',
  'navidrome-not-configured', 'navidrome-forbidden', 'navidrome-not-found', 'navidrome-token-auth-unsupported',
  'navidrome-invalid-response', 'navidrome-response-too-large', 'navidrome-redirect-refused', 'navidrome-timeout',
  'navidrome-network', 'navidrome-https-endpoint-required', 'navidrome-random-failed', 'navidrome-request-limit', 'navidrome-playlist-changed']);
export function safeNavidromeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : (error as { message?: unknown } | null)?.message;
  return new Error(typeof message === 'string' && (knownErrors.has(message) || /^navidrome-(http-\d{3}|api-\d{1,3})$/.test(message))
    ? message : 'navidrome-network');
}

export function createMobileNavidromeConnection(value: NativeNavidromeSettings, bridge: Bridge = native) {
  // Copy only public fields, even if an older/incorrect caller supplies additional credential properties.
  const settings = Object.freeze({ enabled: value.enabled, baseURL: value.baseURL, username: value.username,
    hasPassword: value.hasPassword, scope: value.scope, revision: value.revision });
  let closed: Error | null = null;
  const queued: Pending[] = [], active = new Set<Pending>();
  const cancel = (id: string) => { void bridge.cancelNavidromeRequest({ id }).catch(() => undefined); };
  const close = (reason = new Error('navidrome-cancelled')) => {
    if (closed) return;
    closed = reason;
    for (const item of queued.splice(0)) item.reject(reason);
    for (const item of active) { cancel(item.id); item.reject(reason); }
  };
  const assertCurrent = (config = settings) => {
    if (closed) throw closed;
    if (config.scope !== settings.scope || config.revision !== settings.revision) throw new Error('navidrome-settings-changed');
  };
  const drain = () => {
    while (!closed && active.size < 2 && queued.length) {
      const item = queued.shift()!; active.add(item); item.start();
    }
  };
  const request = <T>(config: NativeNavidromeSettings, operation: NavidromeReadOperation,
    parameters: NavidromeReadParameters = {}): Promise<SubsonicResponse<T>> => {
    try { assertCurrent(config); } catch (error) { return Promise.reject(error); }
    if (queued.length + active.size >= MAX_PENDING) return Promise.reject(new Error('navidrome-request-limit'));
    const id = crypto.randomUUID();
    return new Promise<SubsonicResponse<T>>((resolve, reject) => {
      const item: Pending = { id, reject, start: () => {
        void (async () => {
          try {
            assertCurrent(config);
            const response = await bridge.navidromeRequest({ id, revision: settings.revision, scope: settings.scope, operation,
              parameters: Object.fromEntries(Object.entries(parameters).map(([key, entry]) => [key, String(entry)])) });
            assertCurrent(config);
            if (response.revision !== settings.revision || response.scope !== settings.scope) {
              throw new Error('navidrome-settings-changed');
            }
            if (response.response?.['subsonic-response']?.status !== 'ok') throw new Error('navidrome-invalid-response');
            resolve(response.response as SubsonicResponse<T>);
          } catch (error) {
            const safe = safeNavidromeError(error);
            if (['navidrome-settings-changed', 'navidrome-auth-required'].includes(safe.message)) close(safe);
            reject(safe);
          } finally { active.delete(item); drain(); }
        })();
      } };
      queued.push(item); drain();
    });
  };
  const api = createNavidromeReadApi(request, (operation, error) => {
    const safe = safeNavidromeError(error);
    // Older servers can omit these optional endpoints. Authentication and network failures remain errors.
    if (['getOpenSubsonicExtensions', 'getLyricsBySongId'].includes(operation)
      && ['navidrome-http-404', 'navidrome-not-found', 'navidrome-api-0'].includes(safe.message)) return;
    throw safe;
  });
  return {
    settings, api, assertCurrent, dispose: () => close(),
    sourceRef(mediaId: string): Extract<PlaybackSourceRef, { kind: 'navidrome' }> {
      assertCurrent();
      if (!settings.scope || !mediaId) throw new Error('navidrome-not-configured');
      return { kind: 'navidrome', scope: settings.scope, mediaId };
    },
  };
}
export type MobileNavidromeConnection = ReturnType<typeof createMobileNavidromeConnection>;
