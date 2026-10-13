import { getOnlineMusicProvider } from '../../services/onlineMusic/providerRegistry';
import { searchQQLyrics, fetchQQLyrics } from './providers/qqLyricProvider';
import { fetchAmllDbLyrics } from './providers/amllDbProvider';
import { createAutoMatchBestLyric } from './autoMatchBestLyricCore';

// src/utils/lyrics/autoMatchBestLyric.ts
// Original Web/Electron provider adapter; the same matching policy can run in an independent native host.
export type { AutoMatchProviderCandidate, AutoMatchBestLyricOptions, AutoMatchBestLyricMatch,
    AutoMatchBestLyricPureMusic, AutoMatchBestLyricResult } from './autoMatchBestLyricTypes';

// Bounds slow remote providers so one source cannot block the whole automatic match.
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
                timer = setTimeout(() => {
                    console.warn(`[autoMatchBestLyric] ${label} timed out after ${timeoutMs}ms`);
                    resolve(fallback);
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

export const autoMatchBestLyric = createAutoMatchBestLyric({
    searchSongs: (providerId, query, limit, offset) => getOnlineMusicProvider(providerId)?.search?.searchSongs(query, limit, offset)
        ?? Promise.resolve({ items: [], hasMore: false, nextOffset: 0 }),
    getLyrics: (providerId, song) => getOnlineMusicProvider(providerId)?.lyrics?.getLyrics(song) ?? Promise.resolve(null),
    getChorusRanges: (providerId, song) => getOnlineMusicProvider(providerId)?.lyrics?.getChorusRanges?.(song.id) ?? Promise.resolve([]),
    searchQQ: searchQQLyrics,
    fetchQQ: fetchQQLyrics,
    fetchAmll: fetchAmllDbLyrics,
    withTimeout,
});
