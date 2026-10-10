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
    localStorage.setItem('custom_dual_theme', JSON.stringify(normalized));
    setCustom(normalized); select(true);
  };
  return { theme: selected && custom ? custom : BASE_DUAL_THEME, custom, selected, select, save };
}
export type MobileTheme = ReturnType<typeof useMobileTheme>;
