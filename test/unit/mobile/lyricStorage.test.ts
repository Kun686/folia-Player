import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData, SongResult } from '../../../src/types';
import type { OnlineLyricsStorage } from '../../../src/services/onlineLyricsStorage';

// lyricStorage.test.ts — original orchestration, native persistence and old-request isolation are tested together.
const mocks = vi.hoisted(() => ({ getLyrics: vi.fn(), match: vi.fn(), read: vi.fn(), write: vi.fn(), save: vi.fn() }));
vi.mock('../../../src/services/onlineMusic/omni', () => ({ omni: { getLyrics: mocks.getLyrics } }));
vi.mock('../../../src/utils/lyrics/autoMatchBestLyric', () => ({ autoMatchBestLyric: mocks.match }));
vi.mock('../../../src/stores/useLyricSettingsStore', () => ({ useLyricSettingsStore: { getState: () => ({ autoUseBestLyric: true }) } }));
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
});
