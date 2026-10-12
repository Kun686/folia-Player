import { native } from './bridge';
import { installMobileRuntime } from '../services/mobileRuntime';
import { openNativeLyricsStorage } from './lyricStorage';
import { loadMobileSyncSettings, mobileSyncConnection } from './syncRuntime';

// src/mobile/runtime.ts — memory mirror is hydrated before provider imports; no credential localStorage.
let sessions: Record<string, Record<string, string>> = {};
let persistence: Promise<void> = Promise.resolve();
const persistenceErrors = new Map<string, unknown>();
const generations = new Map<string, number>();
const pending = new Map<string, string>();
const generation = (provider: string) => generations.get(provider) ?? 0;
let coverGeneration = 0;
let lyricGeneration = 0;
const enqueueSave = (provider: string) => {
  const values = { ...sessions[provider] };
  persistence = persistence.then(() => native.saveSession({ provider, values })).then(() => { persistenceErrors.delete(provider); }).catch(error => { persistenceErrors.set(provider, error); });
};
export async function flushSessions() {
  await persistence;
  if (persistenceErrors.size) throw persistenceErrors.values().next().value;
}
export async function cancelProvider(provider: string) {
  generations.set(provider, generation(provider) + 1);
  const ids = [...pending].filter(([, owner]) => owner === provider).map(([id]) => id);
  if (ids.length) await native.cancelRequests({ ids });
}
export async function clearProvider(provider: string) {
  await cancelProvider(provider);
  sessions[provider] = {};
  await persistence;
  await native.clearSession({ provider });
  persistenceErrors.delete(provider);
}
async function request(input: string, init: RequestInit = {}) {
  const url = new URL(input, 'https://mobile.invalid');
  const provider = url.pathname === '/api/lyric-proxy'
    ? (new URL(url.searchParams.get('url')!).hostname.includes('qq.com') ? 'qq' : 'kugou')
    : url.pathname.split('/')[2];
  if (!['netease', 'qq', 'kugou'].includes(provider)) throw new Error('unsupported-mobile-route');
  const proxy = url.pathname === '/api/lyric-proxy';
  const epoch = generation(provider), id = crypto.randomUUID();
  const abort = () => { void native.cancelRequests({ ids: [id] }).catch(() => undefined); };
  init.signal?.throwIfAborted();
  pending.set(id, provider);
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await native.request({ id, payload: { provider: proxy ? 'lyrics' : provider,
      path: proxy ? url.searchParams.get('url') : url.pathname.replace('/mobile/' + provider, '') + url.search,
      method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)),
      ...(init.body ? { body: String(init.body) } : {}) } });
    if (epoch !== generation(provider) || init.signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    return new Response(result.body, { status: result.status, headers: result.headers });
  } finally { pending.delete(id); init.signal?.removeEventListener('abort', abort); }
}
export async function initializeRuntime() {
  const state = await native.bootstrap();
  sessions = state.sessions;
  // Optional sync failure must not block playback startup or fall back to browser-stored credentials.
  await loadMobileSyncSettings().catch(() => undefined);
  installMobileRuntime({ fetch: request, sync: mobileSyncConnection,
    lyrics: {
      open: async song => {
        const provider = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : 'local';
        const epoch = generation(provider), lyrics = lyricGeneration;
        await persistence;
        return openNativeLyricsStorage(song, () => epoch === generation(provider) && lyrics === lyricGeneration);
      },
      usage: async () => (await native.lyricCacheState()).bytes,
      clear: () => { lyricGeneration++; return native.clearLyricCache(); },
    },
    covers: {
      load: async song => {
        const provider = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : 'local';
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
      sessions[provider] ??= {};
      if (value === null) delete sessions[provider][key]; else sessions[provider][key] = value;
      enqueueSave(provider);
    },
  });
  return state.server;
}
