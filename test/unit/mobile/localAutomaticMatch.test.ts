import { describe, expect, it, vi } from 'vitest';
import { matchLocalLyrics, type LocalAutomaticInput } from '@/services/localAutomaticMatch';
import { localAutomaticInputJSON, localAutomaticResultJSON } from '@/services/onlineMusic/nativeLocalAutomaticMatch';
import { runLocalAutomaticJob } from '@/services/onlineMusic/nativeLocalAutomaticJob';
import { createProviderSongMetadata } from '@/utils/songMetadata';
import type { LocalMatchSnapshot } from '@/types/localSongMatch';
import type { AutoMatchLyricPorts } from '@/utils/lyrics/autoMatchBestLyricTypes';

// localAutomaticMatch.test.ts — desktop policy parity, compact native inputs and lossless selection persistence.
const lyrics = { lines: [{ startTime: 1, endTime: 3, fullText: 'Matched', words: [] }], isWordByWord: false };
const candidate = { id: 42, name: 'Track', artists: [{ id: 1, name: 'Artist' }],
    album: { id: 2, name: 'Album', coverUrl: 'http://example.invalid/cover.jpg' }, durationMs: 30000 };
const settings = { localLyricsPriority: 'local' as const, autoUseBestLyric: false, preferredAlternativeLyricSource: 'qq' as const };
const input = (patch: Partial<LocalAutomaticInput> = {}): LocalAutomaticInput => ({
    context: { title: 'Track', artist: 'Artist', album: 'Album', durationMs: 30000 },
    hasFileLyrics: false, hasLocalCover: false, pureMusic: false, refreshFromMetadata: false, settings, ...patch,
});
const ports = () => ({ metadata: createProviderSongMetadata, match: vi.fn().mockResolvedValue(null),
    search: vi.fn().mockResolvedValue({ items: [candidate] }),
    lyrics: vi.fn().mockResolvedValue({ lyrics, isPureMusic: false }), save: vi.fn().mockResolvedValue(undefined) });
const snapshot = (): LocalMatchSnapshot => ({ base: { ...candidate, id: 'local-id', sourceRef: { kind: 'local', mediaId: 'local-id' } },
    fileName: 'Track.flac', lyrics: { token: 'edit-generation' } });
const request = (value: LocalMatchSnapshot, extra = {}) => JSON.stringify({ version: 1, snapshot: value, settings, ...extra });

describe('original local automatic policy in native runtime', () => {
    it('retains the 50-result NetEase fallback and protected artist/album origins', async () => {
        const io = ports();
        expect(await matchLocalLyrics(input(), io)).toBe(lyrics);
        expect(io.search).toHaveBeenCalledWith('Track - Artist - Album', 50, 0);
        expect(io.lyrics).toHaveBeenCalledWith(candidate);
        expect(io.save).toHaveBeenCalledWith(expect.objectContaining({ source: 'netease', songId: 42,
            coverUrl: 'https://example.invalid/cover.jpg' }), expect.objectContaining({
            protectOrigins: ['manual', 'manual-match', 'split'], songPatch: expect.objectContaining({ useOnlineCover: true }) }));
    });
    it('uses file lyrics first and only matches cover and metadata', async () => {
        const io = ports();
        expect(await matchLocalLyrics(input({ hasFileLyrics: true, hasLocalCover: true }), io)).toBeNull();
        expect(io.match).not.toHaveBeenCalled(); expect(io.lyrics).not.toHaveBeenCalled();
        expect(io.save.mock.calls[0][1].songPatch).toEqual({ useOnlineCover: false });
    });
    it('preserves selected metadata and requests only that identity when best matching is disabled', async () => {
        const io = ports(), metadataCandidate = { source: 'qq' as const, songId: 'mid42' };
        io.match.mockResolvedValue({ lyrics, id: 'mid42', source: 'qq', song: { ...candidate, qqMid: 'mid42' } });
        await matchLocalLyrics(input({ context: { ...input().context, metadataCandidate } }), io);
        expect(io.match).toHaveBeenCalledWith('Track', 'Artist', 30000, expect.objectContaining({ exactMatchOnly: true, metadataCandidate }));
        expect(io.search).not.toHaveBeenCalled();
        expect(io.save).toHaveBeenCalledWith({}, expect.objectContaining({ lyricsOnly: true }));
        io.save.mockClear();
        await matchLocalLyrics(input({ hasFileLyrics: true, context: { ...input().context, metadataCandidate } }), io);
        expect(io.save).not.toHaveBeenCalled();
    });
    it('uses QQ mid and HTTPS cover when best lyrics supply metadata', async () => {
        const io = ports();
        io.match.mockResolvedValue({ lyrics, id: 'mid42', source: 'qq', song: { ...candidate, qqMid: 'mid42' } });
        await matchLocalLyrics(input({ settings: { ...settings, autoUseBestLyric: true } }), io);
        expect(io.search).not.toHaveBeenCalled();
        expect(io.save).toHaveBeenCalledWith(expect.objectContaining({ source: 'qq', songId: 'mid42',
            artists: candidate.artists, coverUrl: 'https://example.invalid/cover.jpg' }), expect.anything());
    });
    it('does not accept unrelated or too short titles', async () => {
        const io = ports(); io.search.mockResolvedValue({ items: [{ ...candidate, name: 'T' }, { ...candidate, name: 'Other song' }] });
        expect(await matchLocalLyrics(input(), io)).toBeNull(); expect(io.save).not.toHaveBeenCalled();
    });
    it('skips disabled automatic matching or fully cached results', () => {
        const value = snapshot();
        value.document = { title: 'Track', titleOrigin: 'import', artistNames: ['Artist'], noAutoMatch: true };
        expect(localAutomaticInputJSON(request(value))).toBe('null');
        value.document = { ...value.document, noAutoMatch: false, matchedLyrics: lyrics, matchedLyricsSongId: 42 };
        expect(localAutomaticInputJSON(request({ ...value, embeddedCover: 'data:image/png;base64,AA==' }))).toBe('null');
    });
    it('never forwards imported lyric or cover bytes to the network job and uses current catalog names', () => {
        const value = { ...snapshot(), hasLocalCover: true, display: { ...candidate, artists: [{ id: 9, name: 'Edited artist' }] } };
        value.lyrics.content = '[00:01.00]private-file-content'; value.embeddedCover = 'private-cover-bytes';
        const compact = localAutomaticInputJSON(request(value, { settings: { ...settings, localLyricsPriority: 'online' } }));
        expect(compact).not.toContain('private-'); expect(compact).not.toContain('edit-generation');
        expect(JSON.parse(compact)).toMatchObject({ hasFileLyrics: true, hasLocalCover: true, context: { artist: 'Edited artist' } });
    });
    it('persists automatic results without changing explicit imported selection or setting manual flags', () => {
        const value = snapshot(); value.lyrics = { ...value.lyrics, content: '[00:01.00]Imported', lyricsSource: 'local' };
        const result = JSON.parse(localAutomaticResultJSON(request(value, { decision: { metadata: { source: 'qq', songId: 'mid42',
            title: 'Track', artists: [{ name: 'Matched artist' }] }, options: { songPatch: { matchedLyrics: lyrics, matchedLyricsSource: 'qq' },
                protectOrigins: ['manual', 'manual-match', 'split'] } } })));
        expect(result.source).toBe('local'); expect(result.document.hasManualLyricSelection).toBeUndefined();
        expect(result.document).toMatchObject({ titleOrigin: 'auto-match', artistNames: ['Matched artist'], matchedLyrics: lyrics });
        expect(value.lyrics.content).toContain('Imported');
    });
    it('clears legacy cached lyrics after a pure-music match across the JSON boundary', async () => {
        const value = snapshot(); value.document = { title: 'Track', titleOrigin: 'manual-match', artistNames: ['Artist'],
            matchedLyrics: lyrics, onlineMetadata: { source: 'netease', songId: 42, artists: [{ name: 'Artist' }], matchMode: 'manual', matchedAt: 1 } };
        const facts = JSON.parse(localAutomaticInputJSON(request(value)));
        const io = { getLyrics: vi.fn().mockResolvedValue({ lyrics: null, isPureMusic: true }),
            withTimeout: (p: Promise<unknown>) => p } as unknown as AutoMatchLyricPorts;
        const decision = await runLocalAutomaticJob(facts, io);
        expect(decision?.clearedFields).toContain('matchedLyrics');
        const result = JSON.parse(localAutomaticResultJSON(request(value, { decision })));
        expect(result.document.matchedLyrics).toBeUndefined(); expect(result.document.matchedIsPureMusic).toBe(true);
        expect(result.document.titleOrigin).toBe('manual-match');
    });
});
