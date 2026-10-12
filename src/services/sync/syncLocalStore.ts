import type { DualTheme } from '../../types';
import { appDatabase, type StoredCacheEntry } from '../appDatabase';
import { putCacheEntry } from '../repositories/cacheRepository';
import { sanitizeDualTheme } from '../themeSanitizer';
import { getThemeCacheKeyFromFingerprint, getThemeSyncRegistryRecords, type ThemeSyncRegistryRecord } from './themeSyncRegistry';
import type { SyncedThemeRecord } from './syncTypes';
import { assertSyncCurrent, type SyncConnection } from './syncConnection';
import { parseSyncedThemeRecord } from './syncSchema';

// syncLocalStore.ts — atomic theme/index updates, with compare-before-write so a late download cannot replace a local edit.
export interface SyncLocalSnapshot {
  records: ThemeSyncRegistryRecord[];
  cache: Map<string, StoredCacheEntry>;
}
// Single-song uploads read the committed theme and its original timestamp together, without registering a newer timestamp.
export async function readSavedThemeForSync(fingerprint: string, config: SyncConnection): Promise<SyncedThemeRecord | null> {
  return appDatabase.transaction('r', appDatabase.api_cache, appDatabase.theme_registry, async () => {
    assertSyncCurrent(config);
    const record = await appDatabase.theme_registry.get(fingerprint);
    if (!record) return null;
    if (typeof record.cacheKey !== 'string') throw new Error('sync-invalid-local-record');
    const cached = await appDatabase.api_cache.get(record.cacheKey);
    assertSyncCurrent(config);
    if (!cached) return null;
    const parsed = parseSyncedThemeRecord({ fingerprint, updatedAt: record.updatedAt, source: record.source, theme: cached.data });
    if (!parsed) throw new Error('sync-invalid-local-record');
    return parsed;
  });
}
export async function captureSyncLocal(config: SyncConnection): Promise<SyncLocalSnapshot> {
  await getThemeSyncRegistryRecords({ strict: true }); // Complete the existing legacy migration before opening the transaction.
  return appDatabase.transaction('r', appDatabase.api_cache, appDatabase.theme_registry, async () => {
    assertSyncCurrent(config);
    const records = await appDatabase.theme_registry.toArray() as ThemeSyncRegistryRecord[];
    const rows = await appDatabase.api_cache.bulkGet(records.map(record => record.cacheKey));
    assertSyncCurrent(config);
    return { records, cache: new Map(rows.filter((row): row is StoredCacheEntry => !!row).map(row => [row.key, row])) };
  });
}
export async function commitSyncThemes(config: SyncConnection, snapshot: SyncLocalSnapshot, remote: SyncedThemeRecord[], overwrite = false) {
  const expected = new Map(snapshot.records.map(record => [record.fingerprint, record]));
  return appDatabase.transaction('rw', appDatabase.api_cache, appDatabase.theme_registry, async () => {
    let written = 0;
    for (const record of remote) {
      assertSyncCurrent(config);
      const before = expected.get(record.fingerprint), current = await appDatabase.theme_registry.get(record.fingerprint);
      // Includes content as well as timestamps: two local edits in one millisecond are still distinct.
      if (JSON.stringify(current ?? null) !== JSON.stringify(before ?? null)) continue;
      const key = before?.cacheKey ?? getThemeCacheKeyFromFingerprint(record.fingerprint);
      const cached = await appDatabase.api_cache.get(key);
      if (JSON.stringify(cached ?? null) !== JSON.stringify(snapshot.cache.get(key) ?? null)) continue;
      if (!overwrite && before && Date.parse(record.updatedAt) <= Date.parse(before.updatedAt)) continue;
      await putCacheEntry(key, sanitizeDualTheme(record.theme));
      await appDatabase.theme_registry.put({ fingerprint: record.fingerprint, cacheKey: key, updatedAt: record.updatedAt, source: record.source });
      written++;
    }
    assertSyncCurrent(config);
    return written;
  });
}
export function collectSnapshotUploads(snapshot: SyncLocalSnapshot, remote: Map<string, SyncedThemeRecord>, allowed: Set<string>) {
  return snapshot.records.flatMap(record => {
    const cached = snapshot.cache.get(record.cacheKey), other = remote.get(record.fingerprint);
    if (!allowed.has(record.fingerprint) || !cached || (other && Date.parse(record.updatedAt) <= Date.parse(other.updatedAt))) return [];
    return [{ fingerprint: record.fingerprint, updatedAt: record.updatedAt, source: record.source,
      theme: sanitizeDualTheme(cached.data as DualTheme) }];
  });
}
