import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData, SongResult } from '../../../src/types';
import type { OnlineLyricsStorage } from '../../../src/services/onlineLyricsStorage';

// lyricStorage.test.ts — original orchestration, native persistence and old-request isolation are tested together.
const mocks = vi.hoisted(() => ({ getLyrics: vi.fn(), match: vi.fn(), read: vi.fn(), write: vi.fn(), save: vi.fn(),
  settings: { autoUseBestLyric: true, preferredAlternativeLyricSource: 'qq' } }));
vi.mock('../../../src/services/onlineMusic/omni', () => ({ omni: { getLyrics: mocks.getLyrics } }));
vi.mock('../../../src/utils/lyrics/autoMatchBestLyric', () => ({ autoMatchBestLyric: mocks.match }));
vi.mock('../../../src/stores/useLyricSettingsStore', () => ({ useLyricSettingsStore: { getState: () => mocks.settings } }));
vi.mock('../../../src/services/prefetchService', () => ({ isUrlValid: vi.fn(), updatePrefetchedAudioUrl: vi.fn() }));
vi.mock('../../../src/services/db', () => ({ getFromCache: vi.fn(), getFromCacheWithMigration: vi.fn(), saveToCache: mocks.save }));
vi.mock('../../../src/mobile/bridge', () => ({ native: { readLyricCache: mocks.read, writeLyricCache: mocks.write } }));
import { loadOnlineSongLyrics } from '../../../src/services/onlinePlayback';
import { openNativeLyricsStorage } from '../../../src/mobile/lyricStorage';

const song: SongResult = { id: 42, name: 'Test', artists: [], album: { id: 1, name: 'Album' }, durationMs: 10000,
  sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' } };
const lyrics: LyricData = { lines: [{ startTime: 1, endTime: 10, fullText: '缓存歌词', words: [], translation: 'cached' }] };
const callbacks = () => ({ isCurrent: () => true, onLyrics: vi.fn(), onDone: vi.fn() });
describe('original lyric loader with native storage', () => {
  beforeEach(() => {
    mocks.settings = { autoUseBestLyric: true, preferredAlternativeLyricSource: 'qq' };
    vi.clearAllMocks(); mocks.read.mockResolvedValue({ token: 'generation', payload: {} });
    mocks.write.mockResolvedValue(undefined); mocks.match.mockResolvedValue(null);
    mocks.getLyrics.mockResolvedValue({ lyrics, isPureMusic: false, chorusRanges: [] });
  });
  it('persists displayable lyrics to native only and shows them before optional matching completes', async () => {
    let finish!: (value: unknown) => void;
    mocks.match.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const storage = await openNativeLyricsStorage(song, () => true), cb = callbacks();
    const task = loadOnlineSongLyrics(song, null, undefined, cb, storage);
    await vi.waitFor(() => expect(cb.onDone).toHaveBeenCalled());
    expect(cb.onLyrics).toHaveBeenCalledWith(lyrics);
    finish(null); await task;
    expect(mocks.write).toHaveBeenCalledWith({ song, token: 'generation', field: 'lyrics', value: lyrics });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('restores words and translation while offline even when automatic matching is enabled', async () => {
    mocks.read.mockResolvedValue({ token: 'generation', payload: { lyrics } });
    mocks.getLyrics.mockRejectedValue(new Error('offline'));
    const cb = callbacks();
    await loadOnlineSongLyrics(song, null, undefined, cb, await openNativeLyricsStorage(song, () => true));
    expect(cb.onLyrics).toHaveBeenLastCalledWith(lyrics); expect(cb.onDone).toHaveBeenCalled();
    expect(mocks.match).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('keeps imported selection and instrumental overrides authoritative without requesting the platform', async () => {
    for (const state of [{ lyricsSource: 'imported', importedLyrics: lyrics },
      { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: null, matchedIsPureMusic: true }]) {
      mocks.read.mockResolvedValue({ token: 'generation', payload: { state } });
      const cb = callbacks();
      await loadOnlineSongLyrics(song, null, undefined, cb, await openNativeLyricsStorage(song, () => true));
      expect(cb.onLyrics).toHaveBeenLastCalledWith(state.lyricsSource === 'imported' ? lyrics : null);
    }
    expect(mocks.getLyrics).not.toHaveBeenCalled();
  });
  it('does not save or publish an auto-match that finishes after a newer song or logout', async () => {
    let current = true, finish!: (value: unknown) => void;
    mocks.match.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const cb = callbacks(), storage = await openNativeLyricsStorage(song, () => current);
    const task = loadOnlineSongLyrics(song, null, undefined, cb, storage);
    await vi.waitFor(() => expect(mocks.match).toHaveBeenCalled());
    current = false; finish({ lyrics, source: 'qq', id: 'other' }); await task;
    expect(mocks.write).not.toHaveBeenCalled();
    await expect(storage.writeLyrics(lyrics)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects an expired native token and preserves unrelated concurrent state fields', async () => {
    const storage: OnlineLyricsStorage = await openNativeLyricsStorage(song, () => true);
    mocks.write.mockRejectedValue(new Error('lyric-cache-changed'));
    await expect(storage.writeState({ lyricsSource: 'online' })).rejects.toThrow('lyric-cache-changed');
    expect(mocks.write).toHaveBeenCalledWith({ song, token: 'generation', field: 'state', value: { lyricsSource: 'online' } });
  });
  it('keeps the owning provider lyric separate from an automatic override and skips rematching after an edit', async () => {
    const alternate = { lines: [{ startTime: 0, endTime: 3, fullText: '另一来源', words: [] }] };
    mocks.match.mockResolvedValue({ lyrics: alternate, source: 'qq', id: 'alternate' });
    const cb = callbacks();
    await loadOnlineSongLyrics(song, null, undefined, cb, await openNativeLyricsStorage(song, () => true));
    expect(cb.onLyrics).toHaveBeenLastCalledWith(alternate);
    expect(mocks.write).toHaveBeenCalledWith({ song, token: 'generation', field: 'lyrics', value: lyrics });
    expect(mocks.write).not.toHaveBeenCalledWith(expect.objectContaining({ field: 'lyrics', value: alternate }));
    mocks.match.mockClear();
    await loadOnlineSongLyrics(song, null, undefined, callbacks(), await openNativeLyricsStorage(song, () => true), { skipAutoMatch: true });
    expect(mocks.match).not.toHaveBeenCalled();
  });
  it('loads an editing preview without persisting provider lyrics or starting automatic matching', async () => {
    for (const prefetched of [null, { lyrics }]) {
      const cb = callbacks();
      await loadOnlineSongLyrics(song, prefetched as Parameters<typeof loadOnlineSongLyrics>[1], undefined, cb,
        await openNativeLyricsStorage(song, () => true), { readOnly: true });
      expect(cb.onLyrics).toHaveBeenLastCalledWith(lyrics);
      expect(cb.onDone).toHaveBeenCalled();
    }
    expect(mocks.match).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('discards a read-only preview that finishes after the editor lifetime ends', async () => {
    let active = true, finish!: (value: unknown) => void;
    mocks.getLyrics.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const cb = callbacks();
    const task = loadOnlineSongLyrics(song, null, undefined, cb, await openNativeLyricsStorage(song, () => active), { readOnly: true });
    await vi.waitFor(() => expect(mocks.getLyrics).toHaveBeenCalled());
    active = false; finish({ lyrics, isPureMusic: false }); await task;
    expect(cb.onLyrics).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(['qq', 'netease', 'amll', 'kugou'])('passes the saved %s preference to the original matcher', async source => {
    mocks.settings.preferredAlternativeLyricSource = source;
    await loadOnlineSongLyrics(song, null, undefined, callbacks(), await openNativeLyricsStorage(song, () => true));
    expect(mocks.match).toHaveBeenCalledWith('Test', '', 10000, expect.objectContaining({
      preferredSource: source, providerCandidate: expect.objectContaining({ providerId: 'netease', song }),
    }));
  });
  it.each([true, false])('uses saved lyrics or provider lyrics without matching when disabled (cached=%s)', async cached => {
    mocks.settings.autoUseBestLyric = false;
    mocks.read.mockResolvedValue({ token: 'generation', payload: cached ? { lyrics } : {} });
    const cb = callbacks();
    await loadOnlineSongLyrics(song, null, undefined, cb, await openNativeLyricsStorage(song, () => true));
    expect(cb.onLyrics).toHaveBeenLastCalledWith(lyrics);
    expect(mocks.match).not.toHaveBeenCalled();
    expect(mocks.getLyrics).toHaveBeenCalledTimes(cached ? 0 : 1);
  });
  it.each([true, false])('preserves saved automatic overrides after preferences change (enabled=%s)', async enabled => {
    const state = { lyricsSource: 'online', hasOnlineOverride: true, matchedLyricsSource: 'qq',
      matchedSongId: 'previous-match', onlineOverrideLyrics: lyrics };
    mocks.read.mockResolvedValue({ token: 'generation', payload: { state } });
    mocks.settings = { autoUseBestLyric: enabled, preferredAlternativeLyricSource: 'amll' };
    const cb = callbacks();
    await loadOnlineSongLyrics(song, null, undefined, cb, await openNativeLyricsStorage(song, () => true));
    expect(cb.onLyrics).toHaveBeenLastCalledWith(lyrics);
    expect(mocks.getLyrics).not.toHaveBeenCalled(); expect(mocks.match).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('does not persist or display an old preference match after a newer load has finished', async () => {
    let current = true, finish!: (value: unknown) => void;
    mocks.match.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = callbacks(); old.isCurrent = () => current;
    const task = loadOnlineSongLyrics(song, null, undefined, old, await openNativeLyricsStorage(song, () => true));
    await vi.waitFor(() => expect(mocks.match).toHaveBeenCalled());
    current = false; mocks.settings.autoUseBestLyric = false;
    const next = callbacks();
    await loadOnlineSongLyrics(song, null, undefined, next, await openNativeLyricsStorage(song, () => true));
    const published = old.onLyrics.mock.calls.length, writes = mocks.write.mock.calls.length;
    finish({ lyrics: { lines: [{ ...lyrics.lines[0], fullText: '旧偏好结果' }] }, source: 'qq', id: 'old' });
    await task;
    expect(old.onLyrics).toHaveBeenCalledTimes(published);
    expect(mocks.write).toHaveBeenCalledTimes(writes);
    expect(next.onLyrics).toHaveBeenLastCalledWith(lyrics);
    expect(mocks.write).not.toHaveBeenCalledWith(expect.objectContaining({ field: 'state' }));
  });
  it('uses compare-and-swap only for automatic selections; explicit edits remain writable', async () => {
    mocks.read.mockResolvedValue({ token: 'generation', selectionToken: 'choice-v1', sessionToken: 'sessions-v1', payload: {} });
    const storage = await openNativeLyricsStorage(song, () => true);
    await storage.writeAutomaticState!({ lyricsSource: 'online', hasOnlineOverride: true });
    expect(mocks.write).toHaveBeenLastCalledWith({ song, token: 'generation', selectionToken: 'choice-v1', sessionToken: 'sessions-v1',
      field: 'state', value: { lyricsSource: 'online', hasOnlineOverride: true } });
    await storage.writeState({ lyricsSource: 'imported', importedLyrics: lyrics });
    expect(mocks.write.mock.lastCall![0]).not.toHaveProperty('selectionToken');
  });

  it('revokes a rejected automatic snapshot instead of publishing its older baseline over a newer choice', async () => {
    mocks.read.mockResolvedValue({ token: 'generation', selectionToken: 'old', sessionToken: 'old-session', payload: {} });
    const storage = await openNativeLyricsStorage(song, () => true);
    mocks.write.mockRejectedValue(new Error('lyric-cache-changed'));
    await expect(storage.writeAutomaticState!({ lyricsSource: 'online' })).rejects.toThrow();
    expect(storage.isCurrent()).toBe(false);
    await expect(storage.writeLyrics(lyrics)).rejects.toMatchObject({ name: 'AbortError' });
  });

});
