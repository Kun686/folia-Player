import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData, SongResult } from '@/types';
import { createLyricSegmentationRecord, getLyricLineSegmentationKey } from '@/utils/lyrics/lyricSegmentationRecord';
import { writeLyricOffset } from '@/utils/lyrics/lyricOffsetMemory';

// lyricExport.test.ts — original serialization with native source snapshots; no provider requests.
const io = vi.hoisted(() => ({ cache: vi.fn(), local: vi.fn(), share: vi.fn(), segment: vi.fn(), desktop: vi.fn() }));
vi.mock('@/mobile/bridge', () => ({ native: { readLyricCache: io.cache, readLocalLyrics: io.local, shareLyricFile: io.share } }));
vi.mock('@/services/lyricSegmentation', () => ({ loadSegmentationBySongKey: io.segment }));
vi.mock('@/services/db', () => ({ getLocalSongs: io.desktop, saveToCache: vi.fn() }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({ getSongCacheWithLegacyMigration: io.desktop }));
vi.mock('@/utils/onlineLyricsState', async original => ({
    ...(await original<typeof import('@/utils/onlineLyricsState')>()), loadOnlineLyricsState: io.desktop,
}));
vi.mock('@/utils/lyrics/workerClient', async () => {
    const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
    return { parseLyricsAsync: (...args: Parameters<typeof parseLyricsByFormat>) => Promise.resolve(parseLyricsByFormat(...args)) };
});
const { exportMobileSongLyrics } = await import('@/mobile/lyricExport');
const raw: LyricData = { lines: [
    { fullText: '作词：原作者', startTime: 0, endTime: 2, words: [] },
    { fullText: '第一句歌词', translation: 'First line', romanization: 'diyi', startTime: 2, endTime: 6,
        words: [{ text: '第一句歌词', startTime: 2, endTime: 6 }] },
] };
const song = (providerId: 'qq' | 'netease'): SongResult => ({ id: 42, name: '歌曲', artists: [{ id: 1, name: '作者' }],
    album: { id: 1, name: '专辑' }, durationMs: 20000, sourceRef: { kind: 'online', providerId, mediaId: '42' } });
beforeEach(() => {
    vi.resetAllMocks(); io.segment.mockResolvedValue(null); io.share.mockResolvedValue({ completed: true });
    io.cache.mockResolvedValue({ token: 'a', payload: { lyrics: structuredClone(raw) } });
    for (const key of ['42', 'online:qq:42', 'online:netease:42']) writeLyricOffset(key, 0);
});

describe('mobile current lyric export', () => {
    it('preserves raw credits, timing, saved segmentation and provider-specific offset in FIA', async () => {
        const record = createLyricSegmentationRecord('online:qq:42', 'manual', {
            [getLyricLineSegmentationKey(raw.lines[1])]: ['第一', '句歌', '词'],
        });
        io.segment.mockImplementation(async key => key === record.songKey ? record : null);
        writeLyricOffset('42', 999); writeLyricOffset('online:qq:42', 250); writeLyricOffset('online:netease:42', -100);
        for (const provider of ['qq', 'netease'] as const) {
            expect(await exportMobileSongLyrics(song(provider), 'fia', () => true)).toBe('exported');
            const file = io.share.mock.lastCall![0], document = JSON.parse(file.content);
            expect(file.fileName).toBe('歌曲 - 作者.fia');
            expect(document.song.key).toBe(`online:${provider}:42`);
            expect(document.offsetMs).toBe(provider === 'qq' ? 250 : -100);
            expect(document.lyrics.lines.map((line: any) => line.fullText)).toEqual(raw.lines.map(line => line.fullText));
            expect(document.lyrics.lines[1].startTime).toBe(2);
            expect(document.lyrics.lines[1].wordSegments).toEqual(provider === 'qq' ? ['第一', '句歌', '词'] : undefined);
            expect(io.segment).toHaveBeenLastCalledWith(`online:${provider}:42`, { strict: true });
        }
        expect(raw.lines[1].wordSegments).toBeUndefined(); expect(io.desktop).not.toHaveBeenCalled();
    });
    it('exports imported online lyrics ahead of the cached provider version', async () => {
        const imported = { lines: [{ fullText: '用户导入', startTime: 1, endTime: 3, words: [] }] };
        io.cache.mockResolvedValue({ payload: { lyrics: raw, state: { lyricsSource: 'imported', importedLyrics: imported } } });
        await exportMobileSongLyrics(song('qq'), 'fia', () => true);
        const document = JSON.parse(io.share.mock.lastCall![0].content);
        expect(document.source).toBe('imported'); expect(document.lyrics.lines[0].fullText).toBe('用户导入');
    });
    it('uses the original enhanced LRC with translation and romanization', async () => {
        await exportMobileSongLyrics(song('qq'), 'lrc', () => true);
        const file = io.share.mock.lastCall![0];
        expect(file.fileName).toBe('歌曲 - 作者.lrc');
        expect(file.content).toContain('作词：原作者'); expect(file.content).toContain('First line'); expect(file.content).toContain('diyi');
    });
    it('reads the selected embedded source and names the sidecar after the imported audio', async () => {
        io.local.mockResolvedValue({ token: 'a', lyricsSource: 'embedded', content: '[00:01.00]Wrong source',
            fileName: 'wrong.lrc', embeddedContent: '[00:02.00]Embedded original\n[00:05.00]Next',
            embeddedTranslation: '[00:02.00]内嵌翻译\n[00:05.00]下一句' });
        const local = { ...song('qq'), importedFileName: '01 Original.flac', sourceRef: { kind: 'local', mediaId: 'test-local' } } as SongResult;
        await exportMobileSongLyrics(local, 'fia', () => true);
        const file = io.share.mock.lastCall![0], document = JSON.parse(file.content);
        expect(file.fileName).toBe('01 Original.fia'); expect(document.source).toBe('embedded');
        expect(document.lyrics.lines.find((line: any) => line.fullText === 'Embedded original')?.translation).toBe('内嵌翻译');
        expect(file.content).not.toContain('Wrong source'); expect(io.cache).not.toHaveBeenCalled();
        await exportMobileSongLyrics(local, 'lrc', () => true);
        expect(io.share.mock.lastCall![0].content).toContain('内嵌翻译');
    });
    it('never shares missing or instrumental lyrics, including an explicit no-lyrics match', async () => {
        for (const payload of [{}, { lyrics: raw, state: { hasOnlineOverride: true, onlineOverrideLyrics: null, matchedIsPureMusic: true } }]) {
            io.cache.mockResolvedValue({ payload });
            expect(await exportMobileSongLyrics(song('qq'), 'fia', () => true)).toBe('empty');
        }
        expect(io.share).not.toHaveBeenCalled();
    });
    it('discards delayed work after song change or closing and distinguishes system cancellation', async () => {
        let release!: (value: unknown) => void;
        io.cache.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        let current = true;
        const pending = exportMobileSongLyrics(song('qq'), 'fia', () => current);
        current = false; release({ payload: { lyrics: raw } });
        expect(await pending).toBe('cancelled'); expect(io.share).not.toHaveBeenCalled();
        io.cache.mockResolvedValue({ payload: { lyrics: raw } }); io.share.mockResolvedValue({ completed: false });
        expect(await exportMobileSongLyrics(song('qq'), 'fia', () => true)).toBe('cancelled');
    });
    it('propagates native and segmentation storage failures without sharing incomplete output', async () => {
        io.cache.mockRejectedValueOnce(Error('disk-read-failed'));
        await expect(exportMobileSongLyrics(song('qq'), 'fia', () => true)).rejects.toThrow('disk-read-failed');
        io.segment.mockRejectedValueOnce(Error('segmentation-read-failed'));
        await expect(exportMobileSongLyrics(song('qq'), 'fia', () => true)).rejects.toThrow('segmentation-read-failed');
        expect(io.share).not.toHaveBeenCalled();
        io.share.mockRejectedValueOnce(Error('share-failed'));
        await expect(exportMobileSongLyrics(song('qq'), 'fia', () => true)).rejects.toThrow('share-failed');
    });
});
