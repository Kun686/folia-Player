import { useTypographySettingsStore } from '../stores/useTypographySettingsStore';

// typographyTransfer.ts — codec typography fields intentionally absent from the sync-server schema.
// Validate all supplemental values before applying any store mutation; setters retain desktop clamps.
export function readMobileTypographyTransfer(config: Record<string, unknown>) {
  const numeric = ['subtitleFontScale', 'subtitleOverlayOpacity'] as const;
  const boolean = ['showHarmonySubtitle', 'harmonySubtitleBackground'] as const;
  for (const key of numeric) if (config[key] !== undefined && (typeof config[key] !== 'number' || !Number.isFinite(config[key]))) throw Error('invalid-typography');
  for (const key of boolean) if (config[key] !== undefined && typeof config[key] !== 'boolean') throw Error('invalid-typography');
  const family = config.lyricsCustomFontFamily;
  if (family !== undefined && family !== null && (typeof family !== 'string' || family.length > 1024)) throw Error('invalid-typography');
  return {
    subtitleFontScale: config.subtitleFontScale as number | undefined,
    subtitleOverlayOpacity: config.subtitleOverlayOpacity as number | undefined,
    showHarmonySubtitle: config.showHarmonySubtitle as boolean | undefined,
    harmonySubtitleBackground: config.harmonySubtitleBackground as boolean | undefined,
    lyricsCustomFontFamily: typeof family === 'string' ? family.trim() : null,
  };
}

export function applyMobileTypographyTransfer(config: ReturnType<typeof readMobileTypographyTransfer>) {
  const s = useTypographySettingsStore.getState();
  if (config.subtitleFontScale !== undefined) s.handleSetSubtitleFontScale(config.subtitleFontScale);
  if (config.subtitleOverlayOpacity !== undefined) s.handleSetSubtitleOverlayOpacity(config.subtitleOverlayOpacity);
  if (config.showHarmonySubtitle !== undefined) s.handleToggleShowHarmonySubtitle(config.showHarmonySubtitle);
  if (config.harmonySubtitleBackground !== undefined) s.handleToggleHarmonySubtitleBackground(config.harmonySubtitleBackground);
  // As on desktop, an absent/null portable family preserves an uploaded font; files never travel in a code.
  if (config.lyricsCustomFontFamily) s.handleSetLyricsCustomFont({ source: 'system', family: config.lyricsCustomFontFamily, label: config.lyricsCustomFontFamily });
}
