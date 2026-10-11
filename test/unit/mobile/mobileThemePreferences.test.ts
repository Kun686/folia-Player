import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistMobileThemeChoice, readMobileThemePreferences } from '../../../src/mobile/mobileThemePreferences';
import { resolveCustomThemePreferenceChange, resolveSongThemeAutoSwitchChange } from '../../../src/services/themePreferences';

// mobileThemePreferences.test.ts — migrate installed mobile choices and preserve the desktop switch constraints on write failure.
describe('mobile theme selection preferences', () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: (key: string) => values.delete(key) };
    vi.stubGlobal('localStorage', storage); vi.stubGlobal('window', { localStorage: storage });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('preserves the pre-song-theme mobile custom choice without overriding explicit desktop preferences', () => {
    values.set('last_applied_theme_pointer', 'custom');
    expect(readMobileThemePreferences(true)).toEqual({ isCustomThemePreferred: true, songThemeAutoSwitchEnabled: false, songThemeAutoGenerateEnabled: false });
    values.set('custom_theme_preferred', 'false');
    expect(readMobileThemePreferences(true).songThemeAutoSwitchEnabled).toBe(true);
  });
  it('reuses custom priority and auto-switch mutual exclusion', () => {
    const custom = resolveCustomThemePreferenceChange(readMobileThemePreferences(true), true);
    persistMobileThemeChoice('custom', custom, '{}');
    expect(readMobileThemePreferences(true)).toEqual(custom);
    const automatic = resolveSongThemeAutoSwitchChange(custom, true);
    persistMobileThemeChoice('custom', automatic);
    expect(readMobileThemePreferences(true)).toEqual(automatic);
    const off = resolveSongThemeAutoSwitchChange(automatic, false);
    persistMobileThemeChoice('ai', off);
    expect(readMobileThemePreferences(true)).toEqual(off);
  });
  it('rolls back previous preference keys and theme when selection persistence fails', () => {
    values.set('custom_dual_theme', 'old'); values.set('theme_auto_switch_enabled', 'true');
    const previous = new Map(values), setter = localStorage.setItem;
    vi.mocked(setter).mockImplementationOnce((key, value) => { values.set(key, value); })
      .mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(() => persistMobileThemeChoice('custom', resolveCustomThemePreferenceChange(readMobileThemePreferences(true), true), 'new')).toThrow();
    expect(values).toEqual(previous);
  });
});
