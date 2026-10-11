import { DualTheme, SongResult, Theme } from '../types';
import { getFromCache, saveToCache } from './db';
import { createSongSyncFingerprintCandidates } from './sync/syncFingerprint';
import { readThemeSyncRegistry, registerThemeSyncRecordForSongIfMissing } from './sync/themeSyncRegistry';
import { sanitizeDualTheme, sanitizeTheme, FALLBACK_AI_DUAL_THEME } from './themeSanitizer';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { readCacheEntry, putCacheEntry } from './repositories/cacheRepository';

export type ThemeCacheSongKey = string | number;

export type CachedThemeState =
    | { kind: 'dual'; theme: DualTheme }
    | { kind: 'legacy'; theme: Theme }
    | { kind: 'none' };

// Interactive editors must distinguish unavailable storage from a cache miss; old callers keep best-effort reads.
export type ThemeCacheReadOptions = { strict?: boolean };
export async function getCachedThemeState(songKey: ThemeCacheSongKey, options: ThemeCacheReadOptions = {}): Promise<CachedThemeState> {
    const read = options.strict ? readCacheEntry : getFromCache;
    const dualTheme = await read<DualTheme>(`dual_theme_${songKey}`);
    if (dualTheme) {
        return { kind: 'dual', theme: sanitizeDualTheme(dualTheme) };
    }

    const legacyTheme = await read<Theme>(`theme_${songKey}`);
    if (legacyTheme) {
        return { kind: 'legacy', theme: sanitizeTheme(legacyTheme, FALLBACK_AI_DUAL_THEME.dark) };
    }

    return { kind: 'none' };
}


export async function getCachedThemeStateForSong(song: SongResult | null, options: ThemeCacheReadOptions = {}): Promise<CachedThemeState> {
    if (!song) {
        return { kind: 'none' };
    }

    const read = options.strict ? readCacheEntry : getFromCache;
    const write = options.strict ? putCacheEntry : saveToCache;
    const registry = await readThemeSyncRegistry();
    const registryRecord = createSongSyncFingerprintCandidates(song)
        .map(fingerprint => registry[fingerprint])
        .find(Boolean);
    if (registryRecord) {
        const syncedLocalTheme = await read<DualTheme>(registryRecord.cacheKey);
        if (syncedLocalTheme) {
            return { kind: 'dual', theme: sanitizeDualTheme(syncedLocalTheme) };
        }
    }

    const sourceAwareSongKey = getPlaybackSongKey(song);
    const localThemeState = await getCachedThemeState(sourceAwareSongKey, options);
    if (localThemeState.kind !== 'none') {
        if (localThemeState.kind === 'dual') {
            await registerThemeSyncRecordForSongIfMissing(song, 'manual');
        }
        return localThemeState;
    }

    const legacyThemeState = await getCachedThemeState(song.id, options);
    if (legacyThemeState.kind === 'dual') {
        await write(`dual_theme_${sourceAwareSongKey}`, legacyThemeState.theme);
        await registerThemeSyncRecordForSongIfMissing(song, 'manual');
    } else if (legacyThemeState.kind === 'legacy') {
        await write(`theme_${sourceAwareSongKey}`, legacyThemeState.theme);
    }
    if (legacyThemeState.kind !== 'none') return legacyThemeState;

    return { kind: 'none' };
}

export async function getLastDualTheme(): Promise<DualTheme | null> {
    const dualTheme = await getFromCache<DualTheme>('last_dual_theme');
    return dualTheme ? sanitizeDualTheme(dualTheme) : null;
}

export async function getLastLegacyTheme(): Promise<Theme | null> {
    const legacyTheme = await getFromCache<Theme>('last_theme');
    return legacyTheme ? sanitizeTheme(legacyTheme, FALLBACK_AI_DUAL_THEME.dark) : null;
}
