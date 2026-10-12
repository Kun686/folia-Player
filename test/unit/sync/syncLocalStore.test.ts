import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import { BASE_DUAL_THEME } from '../../../src/services/baseThemes';
import { captureSyncLocal, commitSyncThemes } from '../../../src/services/sync/syncLocalStore';
import { saveEditedSongTheme } from '../../../src/services/songThemeCache';
import { getCachedThemeStateForSong } from '../../../src/services/themeCache';
import { SYNC_PROVIDER, type SyncedThemeRecord } from '../../../src/services/sync/syncTypes';
import type { SongResult } from '../../../src/types';

// syncLocalStore.test.ts — actual Dexie transactions prove atomic cache/index writes and compare-before-write under concurrent local edits.
let current = true;
const config = { provider: SYNC_PROVIDER, enabled: true, workerBaseUrl: 'https://sync.example', authToken: '',
  nativeSession: { hasToken: true, scope: 'one', assertCurrent() { if (!current) throw Error('sync-cancelled'); }, request: vi.fn() } };
const theme = (name: string) => ({ light: { ...BASE_DUAL_THEME.light, name }, dark: { ...BASE_DUAL_THEME.dark, name } });
const song: SongResult = { id: '42', name: 'Test', durationMs: 1000, artists: [{ id: 0, name: 'Artist' }], album: { id: 0, name: '' }, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' } };
const remote = (): SyncedThemeRecord => ({ fingerprint: 'netease:id:42', theme: theme('Remote'), source: 'manual', updatedAt: '2099-01-01T00:00:00.000Z' });
beforeEach(async () => { current = true; await appDatabase.delete(); await appDatabase.open(); });
afterEach(async () => { vi.restoreAllMocks(); await appDatabase.delete(); });
it('makes remote cache and registry visible to original song readers together', async () => {
  const snapshot = await captureSyncLocal(config);
  expect(await commitSyncThemes(config, snapshot, [remote()])).toBe(1);
  expect(await getCachedThemeStateForSong(song, { strict: true })).toMatchObject({ kind: 'dual', theme: { dark: { name: 'Remote' } } });
});
it('preserves a manual edit that happened after the network request began, even against a future remote timestamp', async () => {
  await saveEditedSongTheme(song, theme('Original'), () => true);
  const snapshot = await captureSyncLocal(config);
  await saveEditedSongTheme(song, theme('New edit'), () => true);
  expect(await commitSyncThemes(config, snapshot, [remote()])).toBe(0);
  expect(await getCachedThemeStateForSong(song)).toMatchObject({ theme: { dark: { name: 'New edit' } } });
});
it('rolls back every row if the registry write fails, and allows retry', async () => {
  const snapshot = await captureSyncLocal(config);
  vi.spyOn(appDatabase.theme_registry, 'put').mockRejectedValueOnce(Error('disk full'));
  await expect(commitSyncThemes(config, snapshot, [remote()])).rejects.toThrow('disk full');
  expect(await appDatabase.api_cache.count()).toBe(0); expect(await appDatabase.theme_registry.count()).toBe(0);
  expect(await commitSyncThemes(config, snapshot, [remote()])).toBe(1);
});
it('aborts both writes when the connection changes during the transaction', async () => {
  const snapshot = await captureSyncLocal(config);
  const changed = () => { current = false; };
  appDatabase.theme_registry.hook('creating').subscribe(changed);
  try { await expect(commitSyncThemes(config, snapshot, [remote()])).rejects.toThrow('sync-cancelled'); }
  finally { appDatabase.theme_registry.hook('creating').unsubscribe(changed); }
  expect(await appDatabase.api_cache.count()).toBe(0); expect(await appDatabase.theme_registry.count()).toBe(0);
});
