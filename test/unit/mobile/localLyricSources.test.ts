import { describe, expect, it, vi } from 'vitest';
import { sourcesJSON } from '@/utils/lyrics/nativeLocalRuntime';
import { localLyricsFromSnapshot, type LocalLyricSnapshot } from '@/utils/lyrics/localLyricSnapshot';
import { resolveLocalSongLyrics } from '@/utils/lyrics/localSongLyrics';

// localLyricSources.test.ts — original embedded/sidecar selection and parsing compared to the independent native host.
vi.mock('@/utils/lyrics/workerClient', async () => {
    const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
    return { parseLyricsAsync: (...args: Parameters<typeof parseLyricsByFormat>) => Promise.resolve(parseLyricsByFormat(...args)) };
});
const embedded = '[00:01.00]你好\n[00:01.00]Hello\n[00:06.00]结束';
describe('local lyric sources', () => {
    it.each([
        { content: '[1000,2000](1000,2000,0)导入', fileName: 'file.yrc', embeddedContent: embedded },
        { content: '[1000,2000](1000,2000,0)导入', fileName: 'file.yrc', embeddedContent: embedded, lyricsSource: 'embedded' },
        { embeddedContent: embedded },
        { embeddedContent: '[00:00.00]Wrong fallback\n[awlrc:awlrc:' + Buffer.from('[00:01.000]<0,1000>正文').toString('base64') + ']' },
        { content: '', embeddedContent: '' },
        { content: '[00:01.00]Local', lyricsSource: 'embedded' },
    ] as Omit<LocalLyricSnapshot, 'token'>[])('preserves original choice and timeline: %j', async input => {
        const snapshot = { ...input, token: 'x' };
        const original = await resolveLocalSongLyrics(localLyricsFromSnapshot(snapshot), 'local');
        const expected = original.lyrics?.lines.map(({ startTime, endTime, fullText }) => ({ startTime, endTime, fullText, words: [] })) ?? null;
        expect(JSON.parse(sourcesJSON(JSON.stringify({ version: 1, snapshot })))).toEqual(expected);
        if (input.lyricsSource === 'embedded' && input.embeddedContent) {
            expect(original.source).toBe('embedded');
            expect(original.lyrics?.lines.some(line => line.fullText === '你好')).toBe(true);
        }
    });
    it('rejects malformed snapshots and never silently changes an invalid explicit source', () => {
        for (const snapshot of [{ content: [] }, { embeddedContent: 3 }, { lyricsSource: 'unknown' },
            { embeddedContent: 'x'.repeat(2_000_001) }, { embeddedTranslation: 4 },
            { embeddedTranslation: 'x'.repeat(2_000_001) }, { translationContent: 4 },
            { translationContent: 'x'.repeat(2_000_001) }, { fileName: {} }]) {
            expect(() => sourcesJSON(JSON.stringify({ version: 1, snapshot }))).toThrow();
        }
        expect(sourcesJSON(JSON.stringify({ version: 1, snapshot: { content: '[00:01.00]local', lyricsSource: 'embedded' } }))).toBe('null');
    });
    it('carries separate embedded translation through the original frontend parser and native planner', async () => {
        const snapshot: LocalLyricSnapshot = { token: 'x', lyricsSource: 'embedded',
            content: '[00:00.00]Imported fallback', embeddedContent: '[00:00.00]Original\n[00:01.00]End',
            embeddedTranslation: '[00:00.00]译文\n[00:01.00]结束' };
        const parsed = await resolveLocalSongLyrics(localLyricsFromSnapshot(snapshot), 'local');
        const first = parsed.lyrics?.lines.find(line => line.fullText === 'Original');
        expect(first?.translation).toBe('译文');
        expect(parsed.source).toBe('embedded');
        expect(JSON.parse(sourcesJSON(JSON.stringify({ version: 1, snapshot })))).toEqual(
            parsed.lyrics?.lines.map(({ startTime, endTime, fullText }) => ({ startTime, endTime, fullText, words: [] })));
    });
    it('keeps a separate folder translation in foreground lyrics and native planning', async () => {
        const snapshot: LocalLyricSnapshot = { token: 'x', content: '[00:00.00]Original\n[00:01.00]End',
            fileName: 'song.lrc', translationContent: '[00:00.00]译文\n[00:01.00]结束' };
        const parsed = await resolveLocalSongLyrics(localLyricsFromSnapshot(snapshot), 'local');
        expect(parsed.lyrics?.lines.find(line => line.fullText === 'Original')?.translation).toBe('译文');
        expect(JSON.parse(sourcesJSON(JSON.stringify({ version: 1, snapshot })))).toEqual(
            parsed.lyrics?.lines.map(({ startTime, endTime, fullText }) => ({ startTime, endTime, fullText, words: [] })));
    });
});
