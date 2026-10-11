import { readStoredLastAppliedThemePointer, readStoredThemeAutoSwitchEnabled, readStoredThemeAutoGenerateEnabled,
  type ThemeGenerationSource,
  type ThemePreferenceSwitchState, type LastAppliedThemePointer } from '../services/themePreferences';

// mobileThemePreferences.ts — original preference keys; migrate the old mobile custom selection into its pin preference.
export function readMobileThemePreferences(hasCustom: boolean): ThemePreferenceSwitchState {
  const saved = localStorage.getItem('custom_theme_preferred');
  const preferred = hasCustom && (saved === 'true' || (saved === null && readStoredLastAppliedThemePointer() === 'custom'));
  const autoSwitch = !preferred && readStoredThemeAutoSwitchEnabled();
  return { isCustomThemePreferred: preferred, songThemeAutoSwitchEnabled: autoSwitch,
    songThemeAutoGenerateEnabled: autoSwitch && readStoredThemeAutoGenerateEnabled() };
}
export function persistMobileThemeChoice(pointer: LastAppliedThemePointer, prefs: ThemePreferenceSwitchState, custom?: string, source?: ThemeGenerationSource) {
  const values: Record<string, string> = {
    custom_theme_preferred: String(prefs.isCustomThemePreferred),
    theme_auto_switch_enabled: String(prefs.songThemeAutoSwitchEnabled),
    theme_auto_generate_enabled: String(prefs.songThemeAutoGenerateEnabled),
    last_applied_theme_pointer: pointer,
    ...(custom === undefined ? {} : { custom_dual_theme: custom }),
    ...(source === undefined ? {} : { theme_generation_source: source }),
  };
  const previous = Object.keys(values).map(key => [key, localStorage.getItem(key)] as const);
  try { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value); }
  catch (error) {
    // Storage can also reject rollback. Keep React state unchanged and retain the editor draft for retry.
    for (const [key, value] of previous) {
      try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Best effort only. */ }
    }
    throw error;
  }
}
