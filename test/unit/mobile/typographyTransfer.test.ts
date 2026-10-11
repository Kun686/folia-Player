import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMobileTypographyTransfer, readMobileTypographyTransfer } from '@/mobile/typographyTransfer';
import { useTypographySettingsStore } from '@/stores/useTypographySettingsStore';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';

// typographyTransfer.test.ts — missing codec fields must round-trip without discarding local font files.
vi.mock('@/services/customLyricsFont', () => ({ clearUploadedLyricsFont: vi.fn(), uploadAndRegisterLyricsFont: vi.fn() }));
beforeEach(() => useTypographySettingsStore.setState({ subtitleFontScale: 1, subtitleOverlayOpacity: 0.6,
  showHarmonySubtitle: true, harmonySubtitleBackground: true,
  lyricsCustomFont: { source: 'uploaded', fontId: 'kept', family: 'Uploaded', label: 'Uploaded' } }));

describe('mobile typography appearance transfer', () => {
  it('uses the original short code and store for non-sync typography fields', () => {
    const config = { subtitleFontScale: 1.2, subtitleOverlayOpacity: 0.35,
      showHarmonySubtitle: false, harmonySubtitleBackground: false, lyricsCustomFontFamily: 'Georgia' };
    applyMobileTypographyTransfer(readMobileTypographyTransfer(decompressConfig(compressConfig(config))));
    expect(useTypographySettingsStore.getState()).toMatchObject({ subtitleFontScale: 1.2, subtitleOverlayOpacity: 0.35,
      showHarmonySubtitle: false, harmonySubtitleBackground: false,
      lyricsCustomFont: { source: 'system', family: 'Georgia', label: 'Georgia' } });
  });
  it('preserves uploaded fonts for absent and null portable family fields', () => {
    applyMobileTypographyTransfer(readMobileTypographyTransfer({}));
    applyMobileTypographyTransfer(readMobileTypographyTransfer({ lyricsCustomFontFamily: null }));
    expect(useTypographySettingsStore.getState().lyricsCustomFont?.fontId).toBe('kept');
  });
  it.each([{ subtitleFontScale: NaN }, { subtitleOverlayOpacity: '0.5' }, { showHarmonySubtitle: 'false' },
    { harmonySubtitleBackground: 0 }, { lyricsCustomFontFamily: [] }, { lyricsCustomFontFamily: 'x'.repeat(1025) }])('rejects invalid supplementary values before mutations: %j', config => {
    expect(() => readMobileTypographyTransfer(config)).toThrow('invalid-typography');
    expect(useTypographySettingsStore.getState().subtitleFontScale).toBe(1);
  });
  it('retains desktop numeric clamps', () => {
    applyMobileTypographyTransfer(readMobileTypographyTransfer({ subtitleFontScale: 100, subtitleOverlayOpacity: -3 }));
    expect(useTypographySettingsStore.getState()).toMatchObject({ subtitleFontScale: 1.4, subtitleOverlayOpacity: 0.2 });
  });
});
