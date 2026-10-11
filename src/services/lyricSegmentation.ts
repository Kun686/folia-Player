import { getFromCache, removeFromCache, saveToCache } from './db';
import type { LyricSegmentationRecord } from '../types/lyricSegmentation';
import type { SongResult } from '../types';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { isLyricSegmentationRecord } from '../utils/lyrics/lyricSegmentationRecord';
import { putCacheEntry, readCacheEntry, removeCacheEntry } from './repositories/cacheRepository';

// src/services/lyricSegmentation.ts
// Persists the per-song word segmentation a user produced with AI or by hand.
//
// The `lyricSeg_` prefix is chosen, not incidental. Keys starting with `lyric_` are swept by
// cacheRepository's 'lyrics' category, so a user clearing their lyric cache would silently destroy
// work that cost them either money or manual effort. `lyricSeg_` matches no category and lands in
// api_cache through getCacheTableName's fall-through. It IS still removed by "clear all caches",
// which is accepted: that action is explicitly a full reset.

const LYRIC_SEGMENTATION_KEY_PREFIX = 'lyricSeg_';
type StorageOptions = { strict?: boolean };

/** Uses the provider-prefixed playback key, not song.id, so providers cannot collide. */
export const getLyricSegmentationCacheKey = (song: SongResult): string => (
    `${LYRIC_SEGMENTATION_KEY_PREFIX}${getPlaybackSongKey(song)}`
);

/** Same lookup keyed by `getPlaybackSongKey` directly, for callers holding a key but no SongResult. */
export const loadSegmentationBySongKey = async (songKey: string, options: StorageOptions = {}): Promise<LyricSegmentationRecord | null> => {
    const read = options.strict ? readCacheEntry : getFromCache;
    const cached = await read<unknown>(`${LYRIC_SEGMENTATION_KEY_PREFIX}${songKey}`);
    return isLyricSegmentationRecord(cached) && cached.songKey === songKey ? cached : null;
};

export const loadSongSegmentation = async (song: SongResult, options: StorageOptions = {}): Promise<LyricSegmentationRecord | null> => (
    loadSegmentationBySongKey(getPlaybackSongKey(song), options)
);

export const saveSongSegmentation = async (
    song: SongResult,
    record: LyricSegmentationRecord,
    options: StorageOptions = {},
): Promise<void> => {
    // Editors need a rejected write to remain editable instead of reporting an unsaved draft as saved.
    await (options.strict ? putCacheEntry : saveToCache)(getLyricSegmentationCacheKey(song), record);
};

export const deleteSongSegmentation = async (song: SongResult, options: StorageOptions = {}): Promise<void> => {
    await (options.strict ? removeCacheEntry : removeFromCache)(getLyricSegmentationCacheKey(song));
};
