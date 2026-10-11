import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LyricData, SongResult } from '../../../src/types';
import { createLyricsProcessor } from '../../../src/components/app/playback/createLyricsSetter';
import { createLyricSegmentationRecord, getLyricLineSegmentationKey } from '../../../src/utils/lyrics/lyricSegmentationRecord';
import { clearLyricSegmentationRecord, setLyricSegmentationRecord } from '../../../src/stores/useLyricSegmentationStore';
import { deleteSongSegmentation, loadSongSegmentation, saveSongSegmentation } from '../../../src/services/lyricSegmentation';

// segmentation.test.ts — persistence errors and explicit mobile records cannot inherit desktop state.
const storage = vi.hoisted(() => ({ read: vi.fn(), put: vi.fn(), remove: vi.fn() }));
vi.mock('../../../src/services/repositories/cacheRepository', () => ({
    readCacheEntry: storage.read, putCacheEntry: storage.put, removeCacheEntry: storage.remove,
}));
vi.mock('../../../src/services/db', () => ({ getFromCache: vi.fn(), saveToCache: vi.fn(), removeFromCache: vi.fn() }));
const song = (providerId: 'qq' | 'netease'): SongResult => ({ id: 42, name: 'Test', artists: [], album: { id: 1, name: '' },
    durationMs: 20000, sourceRef: { kind: 'online', providerId, mediaId: '42' } });
const raw: LyricData = { lines: [{ fullText: '第一句歌词', startTime: 0, endTime: 10,
    words: [{ text: '第一句歌词', startTime: 0, endTime: 10 }] }] };
const lineKey = getLyricLineSegmentationKey(raw.lines[0]);
const record = createLyricSegmentationRecord('online:qq:42', 'manual', { [lineKey]: ['第', '一句', '歌词'] });
afterEach(() => { vi.resetAllMocks(); clearLyricSegmentationRecord(); });

describe('mobile segmentation', () => {
    it('uses explicit records while retaining parser timing and raw data, and null restores default', () => {
        setLyricSegmentationRecord('other-song', createLyricSegmentationRecord('other-song', 'manual', { [lineKey]: ['第一句歌词'] }));
        const ref = { current: song('qq') };
        const processed = createLyricsProcessor('', ref, { policy: 'keep' }, record)(raw)!;
        expect(processed.lines[0].wordSegments).toEqual(['第', '一句', '歌词']);
        expect(processed.lines[0].words).toEqual(raw.lines[0].words);
        expect(raw.lines[0].wordSegments).toBeUndefined();
        expect(createLyricsProcessor('', ref, { policy: 'keep' }, null)(raw)!.lines[0].wordSegments).toBeUndefined();
    });
    it('loads provider-prefixed keys and rejects a mismatched stored identity', async () => {
        storage.read.mockResolvedValue(record);
        expect(await loadSongSegmentation(song('qq'), { strict: true })).toEqual(record);
        expect(await loadSongSegmentation(song('netease'), { strict: true })).toBeNull();
        expect(storage.read.mock.calls.map(c => c[0])).toEqual(['lyricSeg_online:qq:42', 'lyricSeg_online:netease:42']);
    });
    it('propagates read, save and reset failures to the editor', async () => {
        const error = Error('controlled-store-failure');
        storage.read.mockRejectedValue(error); storage.put.mockRejectedValue(error); storage.remove.mockRejectedValue(error);
        await expect(loadSongSegmentation(song('qq'), { strict: true })).rejects.toBe(error);
        await expect(saveSongSegmentation(song('qq'), record, { strict: true })).rejects.toBe(error);
        await expect(deleteSongSegmentation(song('qq'), { strict: true })).rejects.toBe(error);
        expect(storage.put).toHaveBeenCalledWith('lyricSeg_online:qq:42', record);
        expect(storage.remove).toHaveBeenCalledWith('lyricSeg_online:qq:42');
    });
});
