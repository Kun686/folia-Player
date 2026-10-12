import type { DualTheme, SongResult, Theme } from '../types';
import { appDatabase } from './appDatabase';
import { putCacheEntry, readCacheEntry } from './repositories/cacheRepository';
import { createThemeSyncRecordForSong } from './sync/themeSyncRegistry';
import { writeThemeRegistryEntries } from './repositories/themeRegistryRepository';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { applyStoredAnimationIntensityToDualTheme, applyStoredAnimationIntensityToTheme } from './themePreferences';
import { FALLBACK_AI_DUAL_THEME, sanitizeDualTheme, sanitizeTheme } from './themeSanitizer';
import type { CachedThemeState } from './themeCache';
import type { SyncedThemeSource } from './sync/syncTypes';

// songThemeCache.ts — acknowledged, atomic local writes using the original cache keys and sync registry, without network sync.
export const assertThemeIntent = (isCurrent: () => boolean) => {
  if (!isCurrent()) throw new Error('theme-song-changed');
};
export function normalizeCachedTheme(value: CachedThemeState): CachedThemeState {
  if (value.kind === 'dual') return { kind: 'dual', theme: applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(value.theme)) };
  if (value.kind === 'legacy') return { kind: 'legacy', theme: applyStoredAnimationIntensityToTheme(sanitizeTheme(value.theme, FALLBACK_AI_DUAL_THEME.dark)) };
  return value;
}
export async function readLastSongTheme(): Promise<CachedThemeState> {
  const dual = await readCacheEntry<DualTheme>('last_dual_theme');
  if (dual) return normalizeCachedTheme({ kind: 'dual', theme: dual });
  const legacy = await readCacheEntry<Theme>('last_theme');
  return normalizeCachedTheme(legacy ? { kind: 'legacy', theme: legacy } : { kind: 'none' });
}
export async function rememberSongTheme(value: CachedThemeState, isCurrent: () => boolean) {
  if (value.kind === 'none') return;
  await appDatabase.transaction('rw', appDatabase.api_cache, async () => {
    assertThemeIntent(isCurrent);
    await putCacheEntry(value.kind === 'dual' ? 'last_dual_theme' : 'last_theme', value.theme);
    assertThemeIntent(isCurrent);
  });
}
export async function saveEditedSongTheme(song: SongResult, theme: DualTheme, isCurrent: () => boolean,
  options: { source?: SyncedThemeSource; remember?: boolean } = {}): Promise<DualTheme> {
  const normalized = applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(theme));
  const record = createThemeSyncRecordForSong(song, options.source ?? 'edited');
  // A late song switch aborts all rows together, including the last-used fallback and local sync index.
  await appDatabase.transaction('rw', appDatabase.api_cache, appDatabase.theme_registry, async () => {
    assertThemeIntent(isCurrent);
    if (record) {
      // The sync server orders writes by updatedAt, including concurrent bulk sync. Same-millisecond edits must remain ordered.
      const previous = await appDatabase.theme_registry.get(record.fingerprint);
      const previousTime = typeof previous?.updatedAt === 'string' ? Date.parse(previous.updatedAt) : NaN;
      if (Number.isFinite(previousTime) && previousTime >= Date.parse(record.updatedAt)) {
        record.updatedAt = new Date(previousTime + 1).toISOString();
      }
    }
    await putCacheEntry(`dual_theme_${getPlaybackSongKey(song)}`, normalized);
    if (record) await writeThemeRegistryEntries([record]);
    if (options.remember !== false) await putCacheEntry('last_dual_theme', normalized);
    assertThemeIntent(isCurrent);
  });
  return normalized;
}
