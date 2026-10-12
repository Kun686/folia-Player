import { useEffect, useRef, useState } from 'react';
import type { DualTheme, SongResult } from '../types';
import { BASE_DUAL_THEME } from '../services/baseThemes';
import { sanitizeDualTheme } from '../services/themeSanitizer';
import { readSavedCustomTheme } from '../utils/appearanceCodec';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { getCachedThemeStateForSong, type CachedThemeState } from '../services/themeCache';
import { assertThemeIntent, normalizeCachedTheme, readLastSongTheme, rememberSongTheme, saveEditedSongTheme } from '../services/songThemeCache';
import { readStoredLastAppliedThemePointer, resolveCustomThemePreferenceChange, resolveSongThemeAutoSwitchChange,
  resolveSongThemeAutoGenerateChange, readStoredThemeGenerationSource, type ThemeGenerationSource, type LastAppliedThemePointer } from '../services/themePreferences';
import { persistMobileThemeChoice, readMobileThemePreferences } from './mobileThemePreferences';
import type { SyncedThemeSource } from '../services/sync/syncTypes';
import { getSyncConfig } from '../services/sync/syncConfig';
import { scheduleSavedThemeUpload } from '../services/sync/savedThemeUpload';

// useMobileTheme.ts — original cache and switching semantics, guarded by native song intent and local edit intent.
const empty: CachedThemeState = { kind: 'none' };
export type SongThemeEditSession = { song: SongResult | null; cached: CachedThemeState; ready: boolean; isCurrent(): boolean };
export function useMobileTheme(song: SongResult | null, songEpoch: number, captureSongGuard: (song: SongResult) => () => boolean) {
  const [custom, setCustom] = useState(() => { const saved = readSavedCustomTheme(); return saved ? sanitizeDualTheme(saved) : null; });
  const [mode, setMode] = useState<LastAppliedThemePointer>(readStoredLastAppliedThemePointer);
  const [prefs, setPrefs] = useState(() => readMobileThemePreferences(!!custom));
  const [generationSource, setGenerationSource] = useState(readStoredThemeGenerationSource);
  const [applied, setApplied] = useState<CachedThemeState>(empty);
  const [cache, setCache] = useState<{ key: string | null; value: CachedThemeState }>({ key: null, value: empty });
  const [loading, setLoading] = useState(false), [error, setError] = useState(false), [reload, setReload] = useState(0);
  const mounted = useRef(true), started = useRef(false), loadEpoch = useRef(0), actionEpoch = useRef(0), saving = useRef(false);
  const preferences = useRef(prefs); preferences.current = prefs;
  const songKey = song ? getPlaybackSongKey(song) : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loadEpoch.current++; actionEpoch.current++; }; }, []);
  useEffect(() => {
    const refresh = () => { if (!saving.current) setReload(value => value + 1); };
    window.addEventListener('folia-themes-synced', refresh);
    return () => window.removeEventListener('folia-themes-synced', refresh);
  }, []);
  useEffect(() => {
    const epoch = ++loadEpoch.current;
    if (!song) { setCache({ key: null, value: empty }); setLoading(false); return; }
    const first = !started.current;
    const nativeCurrent = captureSongGuard(song), intent = actionEpoch.current;
    const current = () => mounted.current && epoch === loadEpoch.current && nativeCurrent();
    const canApply = () => current() && intent === actionEpoch.current;
    setLoading(true); setError(false);
    void (async () => {
      try {
        const cached = normalizeCachedTheme(await getCachedThemeStateForSong(song, { strict: true }));
        if (!current()) return;
        setCache({ key: songKey, value: cached });
        let chosen = preferences.current.songThemeAutoSwitchEnabled ? cached : empty;
        if (chosen.kind === 'none' && first && (preferences.current.songThemeAutoSwitchEnabled || readStoredLastAppliedThemePointer() === 'ai')) {
          chosen = await readLastSongTheme();
        }
        // A miss preserves the current theme, matching desktop. Reads cannot override a newer manual choice.
        if (chosen.kind !== 'none' && canApply()) {
          await rememberSongTheme(chosen, canApply);
          if (!canApply()) return;
          persistMobileThemeChoice('ai', preferences.current);
          setApplied(chosen); setMode('ai');
        }
        if (current()) started.current = true;
      } catch { if (canApply()) setError(true); }
      finally { if (current()) setLoading(false); }
    })();
    return () => { loadEpoch.current++; };
  // Native A→B→A events may batch into one render with the same key; its discrete epoch still restarts the read.
  }, [songKey, songEpoch, reload, captureSongGuard]);
  const select = (value: boolean) => {
    if (value && !custom) return;
    const next = resolveCustomThemePreferenceChange(preferences.current, value);
    persistMobileThemeChoice(value ? 'custom' : 'default', next);
    actionEpoch.current++; preferences.current = next; setPrefs(next); setMode(value ? 'custom' : 'default');
    if (!value) setApplied(empty);
    setError(false);
  };
  const save = (value: DualTheme, importedAutoSwitch?: boolean) => {
    const normalized = sanitizeDualTheme(value);
    let next = resolveCustomThemePreferenceChange(preferences.current, true);
    if (importedAutoSwitch !== undefined) next = resolveSongThemeAutoSwitchChange(next, importedAutoSwitch);
    persistMobileThemeChoice('custom', next, JSON.stringify(normalized));
    actionEpoch.current++; preferences.current = next; setPrefs(next); setCustom(normalized); setMode('custom'); setError(false);
  };
  const setAutoSwitch = (value: boolean) => {
    const next = resolveSongThemeAutoSwitchChange(preferences.current, value);
    persistMobileThemeChoice(mode, next);
    actionEpoch.current++; preferences.current = next; setPrefs(next); setError(false);
  };
  const configureGeneration = (value: { enabled?: boolean; source?: ThemeGenerationSource }) => {
    if (value.enabled === undefined && value.source === undefined) return;
    const next = value.enabled === undefined ? preferences.current : resolveSongThemeAutoGenerateChange(preferences.current, value.enabled);
    persistMobileThemeChoice(readStoredLastAppliedThemePointer(), next, undefined, value.source);
    actionEpoch.current++; preferences.current = next; setPrefs(next); setError(false);
    if (value.source) setGenerationSource(value.source);
  };
  const saveSong = async (value: DualTheme, session: SongThemeEditSession) => {
    if (!session.song || !session.ready || saving.current) throw new Error('theme-not-ready');
    assertThemeIntent(session.isCurrent);
    const sync = getSyncConfig();
    saving.current = true;
    const intent = ++actionEpoch.current;
    loadEpoch.current++; setLoading(false);
    const current = () => mounted.current && intent === actionEpoch.current && session.isCurrent();
    try {
      const normalized = await saveEditedSongTheme(session.song, value, current);
      scheduleSavedThemeUpload(session.song, sync);
      assertThemeIntent(current);
      persistMobileThemeChoice('ai', preferences.current);
      setApplied({ kind: 'dual', theme: normalized }); setMode('ai');
      setCache({ key: getPlaybackSongKey(session.song), value: { kind: 'dual', theme: normalized } }); setError(false);
    } finally { saving.current = false; }
  };
  const cached = cache.key === songKey ? cache.value : empty;
  const beginSongEdit = (): SongThemeEditSession => ({ song, cached, ready: !!song && !loading && !error && cache.key === songKey,
    isCurrent: song ? captureSongGuard(song) : () => false });
  const beginGeneration = (): SongThemeEditSession => {
    const session = beginSongEdit(), intent = actionEpoch.current;
    return { ...session, isCurrent: () => mounted.current && intent === actionEpoch.current && session.isCurrent() };
  };
  const saveGenerated = async (value: DualTheme, session: SongThemeEditSession, source: SyncedThemeSource) => {
    if (!session.song || !session.ready || saving.current) throw new Error('theme-not-ready');
    assertThemeIntent(session.isCurrent);
    const sync = getSyncConfig();
    saving.current = true;
    try {
      const apply = !preferences.current.isCustomThemePreferred;
      const normalized = await saveEditedSongTheme(session.song, value, session.isCurrent, { source, remember: apply });
      scheduleSavedThemeUpload(session.song, sync);
      assertThemeIntent(session.isCurrent);
      if (apply) { persistMobileThemeChoice('ai', preferences.current); setApplied({ kind: 'dual', theme: normalized }); setMode('ai'); }
      setCache({ key: getPlaybackSongKey(session.song), value: { kind: 'dual', theme: normalized } }); setError(false);
      return apply;
    } finally { saving.current = false; }
  };
  const applySong = async () => {
    const session = beginSongEdit();
    if (!session.ready || cached.kind === 'none') return;
    const intent = ++actionEpoch.current;
    const current = () => mounted.current && intent === actionEpoch.current && session.isCurrent();
    await rememberSongTheme(cached, current);
    assertThemeIntent(current); persistMobileThemeChoice('ai', preferences.current);
    setApplied(cached); setMode('ai'); setError(false);
  };
  const songPair = applied.kind === 'dual' ? applied.theme : applied.kind === 'legacy' ? { light: applied.theme, dark: applied.theme } : BASE_DUAL_THEME;
  return { theme: mode === 'custom' && custom ? custom : mode === 'ai' ? songPair : BASE_DUAL_THEME,
    custom, selected: mode === 'custom', activeSource: mode, select, save, saveSong, applySong, beginSongEdit, cached, loading, error,
    autoSwitch: prefs.songThemeAutoSwitchEnabled, setAutoSwitch, retry: () => setReload(value => value + 1),
    autoGenerate: prefs.songThemeAutoGenerateEnabled, generationSource, configureGeneration, beginGeneration, saveGenerated };
}
export type MobileTheme = ReturnType<typeof useMobileTheme>;
