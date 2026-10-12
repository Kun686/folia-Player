import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import type { LyricData, SongResult } from '@/types';
import { writeLyricOffset } from '@/utils/lyrics/lyricOffsetMemory';
import { createLyricSegmentationRecord, getLyricLineSegmentationKey } from '@/utils/lyrics/lyricSegmentationRecord';

// batchLyricExport.test.ts — real collection/adjustment/ZIP bytes over native storage and share boundaries.
const io = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), catalog: vi.fn(), local: vi.fn(), share: vi.fn(), segment: vi.fn(), detail: vi.fn() }));
vi.mock('@/mobile/bridge', () => ({ native: { listExportLyrics: io.list, readExportLyrics: io.read, localCatalog: io.catalog, readLocalMatch: io.local, shareLyricArchive: io.share } }));
vi.mock('@/services/lyricSegmentation', () => ({ loadSegmentationBySongKey: io.segment }));
vi.mock('@/services/db', () => ({ getLocalSongs: vi.fn(), getCacheEntriesByKey: async () => [], saveToCache: vi.fn() }));
vi.mock('@/services/repositories/cacheRepository', () => ({ readCacheEntriesByKey: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { getSongDetail: io.detail } }));
const { exportMobileBatchLyrics } = await import('@/mobile/batchLyricExport');
const song = (providerId: string, mediaId = '42'): SongResult => ({ id: mediaId, name: '歌曲', durationMs: 20_000, artists: [{ id: 0, name: '作者' }], album: { id: 0, name: '' },
    sourceRef: { kind: 'online', providerId, mediaId } });
const lyrics: LyricData = { lines: [{ fullText: '原始歌词', startTime: 1, endTime: 5, words: [{ text: '原始歌词', startTime: 1, endTime: 5 }], translation: 'Original', romanization: 'yuan shi' }] };
const options = { scopes: ['online', 'local'] as ('online' | 'local')[], formats: ['fia', 'lrc'] as ('fia' | 'lrc')[],
    includeTranslation: true, includeRomanization: true, resolveOnlineMetadata: false };
beforeEach(() => {
    vi.resetAllMocks();
    io.list.mockResolvedValue({ token: 'export-1', entries: [{ key: 'qq/key', song: song('qq') }, { key: 'netease/key', song: song('netease') }] });
    io.read.mockResolvedValue({ payload: { lyrics } }); io.catalog.mockResolvedValue({ songs: [] });
    io.segment.mockResolvedValue(null); io.share.mockResolvedValue({ completed: true });
    for (const key of ['online:qq:42', 'online:netease:42', '42']) writeLyricOffset(key, 0);
    // Node has Blob but no browser FileReader; the boundary still encodes the real ZIP bytes.
    vi.stubGlobal('FileReader', class {
        result = ''; onload?: () => void;
        readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = 'data:application/zip;base64,' + Buffer.from(bytes).toString('base64'); this.onload?.(); }); }
        abort() {}
    });
});
describe('native batch lyric export', () => {
    it('exports automatic online matches only when the requested local priority selects them', async () => {
        const base: SongResult = { ...song('qq'), id: 'local-1', sourceRef: { kind: 'local', mediaId: 'local-1' } };
        io.catalog.mockResolvedValue({ songs: [base] });
        io.local.mockResolvedValue({ base, fileName: 'priority.flac', lyrics: { token: 'x',
            content: '[00:01.00]Sidecar', fileName: 'priority.lrc', matched: { matchedLyrics: lyrics } } });
        const automatic = await exportMobileBatchLyrics({ ...options, scopes: ['local'] }, 'online');
        expect(automatic.exportedCount).toBe(1);
        expect(automatic.archive?.manifest.exported[0].source).toBe('online');
        expect((await exportMobileBatchLyrics({ ...options, scopes: ['local'] }, 'local')).exportedCount).toBe(0);
    });
    it('exports both providers with distinct keys, saved segmentation, offsets, and original ZIP layout', async () => {
        writeLyricOffset('online:qq:42', 250); writeLyricOffset('42', 999);
        const record = createLyricSegmentationRecord('online:qq:42', 'manual', { [getLyricLineSegmentationKey(lyrics.lines[0])]: ['原始', '歌词'] });
        io.segment.mockImplementation(async key => key === record.songKey ? record : null);
        const result = await exportMobileBatchLyrics(options, 'local');
        expect(result.exportedCount).toBe(2); expect(result.skippedCount).toBe(0);
        const shared = io.share.mock.lastCall![0]; expect(shared.token).toBe('export-1');
        const files = unzipSync(Buffer.from(shared.data, 'base64'));
        const manifest = JSON.parse(strFromU8(files['manifest.json']));
        expect(manifest.exported.map((entry: any) => entry.songKey)).toEqual(['online:qq:42', 'online:netease:42']);
        for (const entry of manifest.exported) {
            const doc = JSON.parse(strFromU8(files[entry.files[0]]));
            expect(doc.lyrics.lines[0].fullText).toBe('原始歌词'); expect(doc.lyrics.lines[0].startTime).toBe(1);
            expect(doc.offsetMs).toBe(entry.songKey.includes(':qq:') ? 250 : undefined);
            expect(doc.lyrics.lines[0].wordSegments).toEqual(entry.songKey.includes(':qq:') ? ['原始', '歌词'] : undefined);
            expect(strFromU8(files[entry.files[1]])).toContain('Original');
        }
        expect(io.detail).not.toHaveBeenCalled(); expect(io.segment).toHaveBeenCalledWith('online:qq:42', { strict: true });
    });
    it('keeps legacy lyrics with explicit recovery warnings and skips instrumental matches', async () => {
        io.list.mockResolvedValue({ token: 'a', entries: [{ key: 'qq/legacy' }, { key: 'qq/pure', song: song('qq') }] });
        io.read.mockImplementation(async ({ key }) => ({ payload: key.endsWith('pure') ? { state: { hasOnlineOverride: true, onlineOverrideLyrics: null, matchedIsPureMusic: true } } : { lyrics } }));
        const result = await exportMobileBatchLyrics(options, 'local');
        expect(result.exportedCount).toBe(1); expect(result.skippedCount).toBe(1);
        expect(result.archive?.manifest.exported[0].warnings?.[0]).toContain('sourceIdentityUnavailable');
        expect(result.archive?.manifest.exported[0].songKey).toBe('native-cache:qq/legacy');
    });
    it('exports only active online matches from local songs using the imported audio name', async () => {
        const base = { ...song('qq'), id: 'local-1', sourceRef: { kind: 'local' as const, mediaId: 'local-1' } };
        io.catalog.mockResolvedValue({ songs: [base] });
        io.local.mockResolvedValue({ base, fileName: '01 Original.flac', lyrics: { token: 'local-token', lyricsSource: 'online', matched: { matchedLyrics: lyrics } } });
        const result = await exportMobileBatchLyrics({ ...options, scopes: ['local'] }, 'online');
        expect(io.list).not.toHaveBeenCalled(); expect(result.exportedCount).toBe(1);
        expect(result.archive?.manifest.exported[0].files).toEqual(['fia/local/01 Original.fia', 'lrc/local/01 Original.lrc']);
        io.local.mockResolvedValue({ base, fileName: '01 Original.flac', lyrics: { token: 'local-token', lyricsSource: 'embedded', embeddedContent: '[00:00.00]内嵌', matched: { matchedLyrics: lyrics } } });
        expect((await exportMobileBatchLyrics({ ...options, scopes: ['local'] }, 'online')).exportedCount).toBe(0);
    });
    it('never shares an incomplete export after cancellation, storage failure, or account invalidation', async () => {
        const controller = new AbortController(); io.read.mockImplementationOnce(async () => { controller.abort(); return { payload: { lyrics } }; });
        await expect(exportMobileBatchLyrics(options, 'local', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(io.share).not.toHaveBeenCalled();
        io.segment.mockRejectedValueOnce(new Error('disk-read-failed'));
        await expect(exportMobileBatchLyrics(options, 'local')).rejects.toThrow('disk-read-failed');
        expect(io.share).not.toHaveBeenCalled();
        io.share.mockRejectedValueOnce(new Error('lyric-cache-changed'));
        await expect(exportMobileBatchLyrics(options, 'local')).rejects.toThrow('lyric-cache-changed');
        io.share.mockResolvedValueOnce({ completed: false });
        await expect(exportMobileBatchLyrics(options, 'local')).rejects.toMatchObject({ name: 'AbortError' });
    });
    it('retains the native offset key when Omni fills in a missing title or artist', async () => {
        io.list.mockResolvedValue({ token: 'a', entries: [{ key: 'qq/key', song: { ...song('qq'), name: '', artists: [] } }] });
        io.detail.mockResolvedValue({ ...song('qq'), id: 999 });
        writeLyricOffset('online:qq:42', -250);
        const result = await exportMobileBatchLyrics({ ...options, resolveOnlineMetadata: true }, 'local');
        const files = unzipSync(new Uint8Array(await result.archive!.blob.arrayBuffer()));
        const doc = JSON.parse(strFromU8(files[result.archive!.manifest.exported[0].files[0]]));
        expect(doc.offsetMs).toBe(-250); expect(doc.song.title).toBe('歌曲');
    });
});
