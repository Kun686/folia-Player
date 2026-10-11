import { useState } from 'react';
import type { DualTheme } from '../types';
import { BASE_DUAL_THEME } from '../services/baseThemes';
import { sanitizeDualTheme } from '../services/themeSanitizer';
import { readSavedCustomTheme } from '../utils/appearanceCodec';
import { readStoredLastAppliedThemePointer, saveStoredLastAppliedThemePointer } from '../services/themePreferences';

// src/mobile/useMobileTheme.ts — use Folia's existing saved theme pair and selection keys.
export function useMobileTheme() {
  const [custom, setCustom] = useState(() => {
    const saved = readSavedCustomTheme();
    return saved ? sanitizeDualTheme(saved) : null;
  });
  const [selected, setSelected] = useState(readStoredLastAppliedThemePointer() === 'custom');
  const select = (value: boolean) => { saveStoredLastAppliedThemePointer(value ? 'custom' : 'default'); setSelected(value); };
  const save = (value: DualTheme) => {
    const normalized = sanitizeDualTheme(value);
    const previous = localStorage.getItem('custom_dual_theme');
    localStorage.setItem('custom_dual_theme', JSON.stringify(normalized));
    try { select(true); }
    catch (error) {
      if (previous === null) localStorage.removeItem('custom_dual_theme');
      else localStorage.setItem('custom_dual_theme', previous);
      throw error;
    }
    setCustom(normalized);
  };
  return { theme: selected && custom ? custom : BASE_DUAL_THEME, custom, selected, select, save };
}
export type MobileTheme = ReturnType<typeof useMobileTheme>;
