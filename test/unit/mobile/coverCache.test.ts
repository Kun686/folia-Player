import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import { clearCache, clearCacheByCategory, getCacheUsageByCategory, getFromCache, saveToCache } from '../../../src/services/db';
import { installMobileRuntime } from '../../../src/services/mobileRuntime';
import { loadSongCover } from '../../../src/services/onlineMusic/resourceCache';
import type { SongResult } from '../../../src/types';

// coverCache.test.ts — native covers join the original category without a second IndexedDB image copy.
const covers = { load: vi.fn(), usage: vi.fn(), clear: vi.fn() };
const lyrics = { open: vi.fn(), usage: vi.fn(), clear: vi.fn() };
describe('mobile shared cover storage', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    covers.load.mockResolvedValue('data:image/jpeg;base64,fixture'); covers.usage.mockResolvedValue(1024);
    lyrics.usage.mockResolvedValue(2048);
    installMobileRuntime({ fetch: vi.fn(), read: () => null, write: () => undefined, covers, lyrics });
    await appDatabase.delete(); await appDatabase.open();
  });
  afterEach(async () => { await appDatabase.delete(); });
  it('loads by song identity and keeps the bytes out of IndexedDB', async () => {
    const song: SongResult = { id: 42, name: 'Cover', album: { id: 1, name: 'Album', coverUrl: 'https://example.com/cover' },
      artists: [], durationMs: 1000, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42', variant: 'cloud' } };
    await expect(loadSongCover(song)).resolves.toBe('data:image/jpeg;base64,fixture');
    expect(covers.load).toHaveBeenCalledWith(song, false);
    await loadSongCover(song, true);
    expect(covers.load).toHaveBeenLastCalledWith(song, true);
    expect(await getFromCache('cover_online:netease:42')).toBeNull();
  });
  it('counts and clears the existing cover category without clearing lyrics or media', async () => {
    await saveToCache('lyric_online:qq:42', { lines: [] });
    expect((await getCacheUsageByCategory()).cover).toBe(1024);
    await clearCacheByCategory('media'); expect(covers.clear).not.toHaveBeenCalled();
    await clearCacheByCategory('cover'); expect(covers.clear).toHaveBeenCalledTimes(1);
    expect(await getFromCache('lyric_online:qq:42')).toEqual({ lines: [] });
  });
  it('honors cover preservation and reports native deletion failure', async () => {
    await clearCache(['cover_online:qq:42']); expect(covers.clear).not.toHaveBeenCalled();
    await clearCache(); expect(covers.clear).toHaveBeenCalledTimes(1);
    covers.clear.mockRejectedValue(new Error('cache-clear-failed'));
    await expect(clearCacheByCategory('cover')).rejects.toThrow('cache-clear-failed');
  });
  it('does not report a failed native usage read as zero bytes', async () => {
    covers.usage.mockRejectedValue(new Error('cache-read-failed'));
    await expect(getCacheUsageByCategory()).rejects.toThrow('cache-read-failed');
  });
  it('counts and clears native lyrics in their original category, leaving covers and local imports alone', async () => {
    expect((await getCacheUsageByCategory()).lyrics).toBe(2048);
    await clearCacheByCategory('lyrics');
    expect(lyrics.clear).toHaveBeenCalledOnce(); expect(covers.clear).not.toHaveBeenCalled();
    lyrics.clear.mockRejectedValue(new Error('cache-clear-failed'));
    await expect(clearCacheByCategory('lyrics')).rejects.toThrow('cache-clear-failed');
  });
});
