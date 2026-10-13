import { getFromCacheWithMigration, saveToCache } from '../services/db';
import { getSongResourceCacheKey } from '../services/onlineMusic/resourceKeys';
import type { OnlineLyricsState, SongResult } from '../types';
import type { MigrationResult } from './lyrics/renderHints';
import { migrateLyricDataRenderHints as migrateLyrics } from './lyrics/renderHints';
export { resolveOnlineLyrics, resolveOnlineLyricsPureMusic } from './onlineLyricsSelection';

// src/utils/onlineLyricsState.ts

const ONLINE_LYRICS_STATE_SUFFIX = '_state';

const migrateOnlineLyricsState = (value: OnlineLyricsState): MigrationResult<OnlineLyricsState> => {
    const importedMigration = migrateLyrics(value.importedLyrics);
    const overrideMigration = migrateLyrics(value.onlineOverrideLyrics);

    return {
        value: {
            ...value,
            importedLyrics: importedMigration.value,
            onlineOverrideLyrics: overrideMigration.value,
        },
        changed: importedMigration.changed || overrideMigration.changed,
    };
};

export const getOnlineLyricsStateCacheKey = (song: SongResult) =>
    `${getSongResourceCacheKey('lyric', song)}${ONLINE_LYRICS_STATE_SUFFIX}`;

export const loadOnlineLyricsState = async (song: SongResult): Promise<OnlineLyricsState | null> => {
    const key = getOnlineLyricsStateCacheKey(song);
    return getFromCacheWithMigration<OnlineLyricsState>(key, migrateOnlineLyricsState);
};

export const saveOnlineLyricsState = async (song: SongResult, state: OnlineLyricsState): Promise<void> => {
    const key = getOnlineLyricsStateCacheKey(song);
    await saveToCache(key, migrateOnlineLyricsState(state).value);
};

export const getOnlineLyricsSourceLabel = (state: OnlineLyricsState | null | undefined): 'online' | 'imported' =>
    state?.lyricsSource === 'imported' ? 'imported' : 'online';

export { markOnlineLyricsPureMusic } from './onlineLyricsSelection';
