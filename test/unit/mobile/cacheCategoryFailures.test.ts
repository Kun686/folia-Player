import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCacheByCategory, getCacheUsageByCategory } from '../../../src/services/db';
import * as repository from '../../../src/services/repositories/cacheRepository';
import * as runtime from '../../../src/services/mobileRuntime';

// cacheCategoryFailures.test.ts — the mobile settings boundary must not swallow a storage error.
const covers = { load: vi.fn(), usage: vi.fn(), clear: vi.fn() };
const lyrics = { open: vi.fn(), usage: vi.fn(), clear: vi.fn() };
const empty = { playlist: 0, lyrics: 0, cover: 0, media: 0, analysis: 0, mediaCount: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  covers.usage.mockResolvedValue(1024);
  lyrics.usage.mockResolvedValue(2048);
  covers.clear.mockResolvedValue(undefined);
  lyrics.clear.mockResolvedValue(undefined);
  vi.spyOn(runtime, 'getMobileRuntime').mockReturnValue({
    fetch: vi.fn(), read: () => null, write: () => undefined, covers, lyrics,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('mobile cache category error propagation', () => {
  it('does not replace native byte counts with zero when the browser read fails', async () => {
    const failure = new Error('browser-read-failed');
    const read = vi.spyOn(repository, 'getBrowserCacheUsageByCategory').mockRejectedValueOnce(failure);
    await expect(getCacheUsageByCategory()).rejects.toBe(failure);
    expect(read).toHaveBeenCalledOnce();
    expect(covers.usage).toHaveBeenCalledOnce();
    expect(lyrics.usage).toHaveBeenCalledOnce();
  });

  it.each(['cover', 'lyrics'] as const)('reports a %s browser clear failure after native clear', async category => {
    const failure = new Error('browser-clear-failed');
    const clear = vi.spyOn(repository, 'clearBrowserCacheByCategory').mockRejectedValueOnce(failure);
    await expect(clearCacheByCategory(category)).rejects.toBe(failure);
    expect(clear).toHaveBeenCalledExactlyOnceWith(category);
    expect(category === 'cover' ? covers.clear : lyrics.clear).toHaveBeenCalledOnce();
    expect(category === 'cover' ? lyrics.clear : covers.clear).not.toHaveBeenCalled();
  });

  it('retains the existing non-mobile zero fallback', async () => {
    vi.mocked(runtime.getMobileRuntime).mockReturnValue(null);
    vi.spyOn(repository, 'getBrowserCacheUsageByCategory').mockRejectedValueOnce(new Error('browser-read-failed'));
    await expect(getCacheUsageByCategory()).resolves.toEqual(empty);
    expect(covers.usage).not.toHaveBeenCalled();
  });

  it('retains the existing non-mobile clear fallback', async () => {
    vi.mocked(runtime.getMobileRuntime).mockReturnValue(null);
    vi.spyOn(repository, 'clearBrowserCacheByCategory').mockRejectedValueOnce(new Error('browser-clear-failed'));
    await expect(clearCacheByCategory('cover')).resolves.toBeUndefined();
    expect(covers.clear).not.toHaveBeenCalled();
  });
});
