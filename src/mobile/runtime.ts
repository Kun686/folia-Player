import { native } from './bridge';
import { installMobileRuntime } from '../services/mobileRuntime';
import { openNativeLyricsStorage } from './lyricStorage';
import { loadMobileSyncSettings, mobileSyncConnection } from './syncRuntime';

// src/mobile/runtime.ts — memory mirror is hydrated before provider imports; no credential localStorage.
let sessions: Record<string, Record<string, string>> = {};
let scope: string | undefined;
let configuring = false;
const clearing = new Set<string>();
const scoped = () => {
  if (!scope) throw new Error('invalid-gateway-settings');
  return { scope };
};
let persistence: Promise<void> = Promise.resolve();
const persistenceErrors = new Map<string, unknown>();
const generations = new Map<string, number>();
const pending = new Map<string, string>();
const generation = (provider: string) => generations.get(provider) ?? 0;
const sessionRevisions = new Map<string, number>();
export function captureProviderSession(provider: string): () => boolean {
  const epoch = generation(provider), revision = sessionRevisions.get(provider);
  return () => epoch === generation(provider) && revision === sessionRevisions.get(provider);
}
let coverGeneration = 0;
let lyricGeneration = 0;
const enqueueSave = (provider: string) => {
  const values = { ...sessions[provider] }, context = scoped();
  persistence = persistence.then(() => native.saveSession({ provider, values, ...context })).then(() => { persistenceErrors.delete(provider); }).catch(error => { persistenceErrors.set(provider, error); });
};
export async function flushSessions() {
  await persistence;
  if (persistenceErrors.size) throw persistenceErrors.values().next().value;
}
export async function cancelProvider(provider: string) {
  lyricGeneration++; // Cross-source matching can depend on any platform account.
  generations.set(provider, generation(provider) + 1);
  const ids = [...pending].filter(([, owner]) => owner === provider).map(([id]) => id);
  if (ids.length) await native.cancelRequests({ ids });
}
export async function clearProvider(provider: string) {
  if (configuring || clearing.has(provider)) throw new Error('gateway-settings-changed');
  const context = scoped();
  clearing.add(provider);
  try {
    await cancelProvider(provider);
    await persistence;
    await native.clearSession({ provider, ...context });
    sessions[provider] = {};
    persistenceErrors.delete(provider);
  } catch (error) {
    // Native can commit logout before a cache purge fails. Restore the durable account state,
    // while keeping the cleanup error visible instead of claiming the old account still exists.
    const current = await native.bootstrap().catch(() => null);
    if (current?.scope === context.scope) {
      sessions[provider] = current.sessions[provider] ?? {};
      if (!Object.keys(sessions[provider]).length) persistenceErrors.delete(provider);
    }
    throw error;
  } finally { clearing.delete(provider); }
}
// Freeze outgoing session writes and retire old replies while native commits all credentials atomically.
export async function configureGateway(server: string, token: string) {
  if (configuring || clearing.size) throw new Error('gateway-settings-changed');
  configuring = true;
  try {
    for (const provider of ['netease', 'qq', 'kugou']) await cancelProvider(provider);
    await persistence;
    const next = await native.configure({ server, token, ...scoped() });
    if (!next.scope || !next.sessions || next.server !== server) throw new Error('invalid-gateway-settings');
    scope = next.scope; sessions = next.sessions; persistenceErrors.clear();
    return next.server;
  } finally { configuring = false; }
}
async function request(input: string, init: RequestInit = {}) {
  if (configuring) throw new DOMException('Canceled', 'AbortError');
  const context = scoped();
  const url = new URL(input, 'https://mobile.invalid');
  const provider = url.pathname === '/api/lyric-proxy'
    ? (new URL(url.searchParams.get('url')!).hostname.includes('qq.com') ? 'qq' : 'kugou')
    : url.pathname.split('/')[2];
  if (!['netease', 'qq', 'kugou'].includes(provider)) throw new Error('unsupported-mobile-route');
  if (clearing.has(provider)) throw new DOMException('Canceled', 'AbortError');
  const proxy = url.pathname === '/api/lyric-proxy';
  const sessionCurrent = captureProviderSession(provider), id = crypto.randomUUID();
  const abort = () => { void native.cancelRequests({ ids: [id] }).catch(() => undefined); };
  init.signal?.throwIfAborted();
  pending.set(id, provider);
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await native.request({ id, ...context, payload: { provider: proxy ? 'lyrics' : provider,
      path: proxy ? url.searchParams.get('url') : url.pathname.replace('/mobile/' + provider, '') + url.search,
      method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)),
      ...(init.body ? { body: String(init.body) } : {}) } });
    // A new login can replace memory credentials before its Keychain save finishes.
    if (!sessionCurrent() || init.signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    return new Response(result.body, { status: result.status, headers: result.headers });
  } finally { pending.delete(id); init.signal?.removeEventListener('abort', abort); }
}
export async function initializeRuntime() {
  const state = await native.bootstrap();
  sessions = state.sessions; scope = state.scope;
  // Optional sync failure must not block playback startup or fall back to browser-stored credentials.
  await loadMobileSyncSettings().catch(() => undefined);
  installMobileRuntime({ fetch: request, sync: mobileSyncConnection,
    lyrics: {
      open: async song => {
        const provider = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : song.sourceRef?.kind ?? 'local';
        const epoch = generation(provider), lyrics = lyricGeneration;
        await persistence;
        return openNativeLyricsStorage(song, () => epoch === generation(provider) && lyrics === lyricGeneration);
      },
      usage: async () => (await native.lyricCacheState()).bytes,
      clear: () => { lyricGeneration++; return native.clearLyricCache(); },
    },
    covers: {
      load: async song => {
        const provider = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : song.sourceRef?.kind ?? 'local';
        const epoch = generation(provider), covers = coverGeneration;
        const result = await native.songCover({ song });
        if (epoch !== generation(provider) || (provider !== 'local' && covers !== coverGeneration)) throw new DOMException('Canceled', 'AbortError');
        return result.url ?? null;
      },
      usage: async () => (await native.coverCacheState()).bytes,
      clear: () => { coverGeneration++; return native.clearCoverCache(); },
    },
    read: (provider, key) => sessions[provider]?.[key] ?? null,
    write: (provider, key, value) => {
      if (configuring || clearing.has(provider)) throw new DOMException('Canceled', 'AbortError');
      if ((sessions[provider]?.[key] ?? null) !== value) {
        sessionRevisions.set(provider, (sessionRevisions.get(provider) ?? 0) + 1);
        lyricGeneration++;
      }
      sessions[provider] ??= {};
      if (value === null) delete sessions[provider][key]; else sessions[provider][key] = value;
      enqueueSave(provider);
    },
  });
  return state.server;
}
