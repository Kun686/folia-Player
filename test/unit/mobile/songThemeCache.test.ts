import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import { BASE_DUAL_THEME } from '../../../src/services/baseThemes';
import { getCachedThemeStateForSong, getCachedThemeState } from '../../../src/services/themeCache';
import { saveEditedSongTheme, readLastSongTheme } from '../../../src/services/songThemeCache';
import { putCacheEntry } from '../../../src/services/repositories/cacheRepository';
import type { SongResult } from '../../../src/types';

// songThemeCache.test.ts — real Dexie transactions and original identity/cache readers, including rollback and old data.
const song = (provider: 'qq' | 'netease'): SongResult => ({ id: '42', name: provider + ' song', artists: [{ id: 0, name: provider }],
  album: { id: 0, name: '' }, durationMs: 1000, sourceRef: { kind: 'online', providerId: provider, mediaId: '42' } });
const theme = (name: string) => ({ light: { ...BASE_DUAL_THEME.light, name }, dark: { ...BASE_DUAL_THEME.dark, name } });
describe('acknowledged song-theme persistence', () => {
  beforeEach(async () => { await appDatabase.delete(); await appDatabase.open(); });
  afterEach(async () => { vi.restoreAllMocks(); await appDatabase.delete(); });
  it('keeps equal IDs from different platforms separate in the existing readers', async () => {
    await saveEditedSongTheme(song('qq'), theme('QQ'), () => true);
    await saveEditedSongTheme(song('netease'), theme('NetEase'), () => true);
    expect(await getCachedThemeStateForSong(song('qq'), { strict: true })).toMatchObject({ kind: 'dual', theme: { dark: { name: 'QQ' } } });
    expect(await getCachedThemeStateForSong(song('netease'))).toMatchObject({ kind: 'dual', theme: { dark: { name: 'NetEase' } } });
    expect(await readLastSongTheme()).toMatchObject({ kind: 'dual', theme: { dark: { name: 'NetEase' } } });
    expect(await appDatabase.theme_registry.count()).toBe(2);
  });
  it('rolls back theme, last theme and registry together if a write fails', async () => {
    await saveEditedSongTheme(song('qq'), theme('Before'), () => true);
    const before = await appDatabase.api_cache.toArray(), registry = await appDatabase.theme_registry.toArray();
    vi.spyOn(appDatabase.theme_registry, 'bulkPut').mockRejectedValueOnce(new Error('disk full'));
    await expect(saveEditedSongTheme(song('qq'), theme('Failed'), () => true)).rejects.toThrow('disk full');
    expect(await appDatabase.api_cache.toArray()).toEqual(before);
    expect(await appDatabase.theme_registry.toArray()).toEqual(registry);
    await saveEditedSongTheme(song('qq'), theme('Retried'), () => true);
    expect(await readLastSongTheme()).toMatchObject({ theme: { dark: { name: 'Retried' } } });
  });
  it('rejects an already stale edit and aborts a switch arriving during a transaction', async () => {
    await expect(saveEditedSongTheme(song('qq'), theme('Stale'), () => false)).rejects.toThrow('theme-song-changed');
    let active = true;
    const switched = (_key: unknown, value: { key: string }) => { if (value.key === 'last_dual_theme') active = false; };
    appDatabase.api_cache.hook('creating').subscribe(switched);
    try { await expect(saveEditedSongTheme(song('qq'), theme('Late'), () => active)).rejects.toThrow('theme-song-changed'); }
    finally { appDatabase.api_cache.hook('creating').unsubscribe(switched); }
    expect(await appDatabase.api_cache.count()).toBe(0);
    expect(await appDatabase.theme_registry.count()).toBe(0);
  });
  it('preserves the original legacy-theme migration and fallback format', async () => {
    await putCacheEntry('theme_42', BASE_DUAL_THEME.dark);
    expect(await getCachedThemeStateForSong(song('netease'), { strict: true })).toMatchObject({ kind: 'legacy' });
    expect(await getCachedThemeState('online:netease:42')).toMatchObject({ kind: 'legacy' });
    await putCacheEntry('last_theme', BASE_DUAL_THEME.dark);
    expect(await readLastSongTheme()).toMatchObject({ kind: 'legacy' });
  });
  it('surfaces storage errors in strict editor reads while retaining old best-effort callers', async () => {
    const failedRead = { get: vi.fn().mockRejectedValue(new Error('unavailable')) };
    vi.spyOn(appDatabase, 'table').mockReturnValueOnce(failedRead as never);
    await expect(getCachedThemeState('online:qq:42', { strict: true })).rejects.toThrow('unavailable');
    vi.mocked(appDatabase.table).mockReturnValueOnce(failedRead as never);
    await expect(getCachedThemeState('online:qq:42')).resolves.toEqual({ kind: 'none' });
  });
});
