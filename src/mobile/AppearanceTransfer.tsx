import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compressConfig, decompressConfig } from '../utils/appearanceCodec';
import { buildVisualSettingsConfig } from '../services/obs/visualSettingsConfig';
import { applySyncedVisualSettings, readSyncableSettingsState } from '../services/sync/settingsSnapshot';
import { parseSyncedSettingsRecord } from '../services/sync/syncSchema';
import { SYNC_SCHEMA_VERSION } from '../services/sync/syncTypes';
import { hasVisualizerMode } from '../components/visualizer/registry';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import type { MobileTheme } from './useMobileTheme';
import { readMobileTypographyTransfer, applyMobileTypographyTransfer } from './typographyTransfer';
import { useTypographySettingsStore } from '../stores/useTypographySettingsStore';

// src/mobile/AppearanceTransfer.tsx — desktop-compatible appearance codes, with no sync server involved.
export default function AppearanceTransfer({ appearance }: { appearance: MobileTheme }) {
  const { t } = useTranslation();
  const [text, setText] = useState(''), [error, setError] = useState(false);
  const apply = () => {
    try {
      if (text.length > 200_000) throw Error('too-large');
      const config = decompressConfig(text);
      const typography = readMobileTypographyTransfer(config);
      if (config.visualizerMode && !hasVisualizerMode(config.visualizerMode)) throw Error('unknown-mode');
      const validated = parseSyncedSettingsRecord({ schemaVersion: SYNC_SCHEMA_VERSION, updatedAt: new Date().toISOString(), data: config });
      if (!validated) throw Error('invalid-config');
      if (typography.lyricsCustomFontFamily && useTypographySettingsStore.getState().lyricsCustomFont?.source === 'uploaded'
        && !window.confirm(t('options.importDerivedUploadedFont'))) return;
      applySyncedVisualSettings(readSyncableSettingsState(), validated.data);
      applyMobileTypographyTransfer(typography);
      const theme = useThemeSettingsStore.getState(), visual = useVisualizerSettingsStore.getState();
      if (typeof config.staticMode === 'boolean') theme.handleToggleStaticMode(config.staticMode);
      if (typeof config.useCoverColorBg === 'boolean') theme.handleToggleCoverColorBg(config.useCoverColorBg);
      if (typeof config.disableVisualizerGeometricBackground === 'boolean') visual.handleToggleDisableVisualizerGeometricBackground(config.disableVisualizerGeometricBackground);
      if (typeof config.disableVisualizerVignette === 'boolean') visual.handleToggleDisableVisualizerVignette(config.disableVisualizerVignette);
      if (config.theme?.light && config.theme?.dark) appearance.save(config.theme);
      setError(false); setText('');
    } catch { setError(true); }
  };
  return <details className="appearance-transfer"><summary>{t('mobile.appearanceTransfer')}</summary>
    {appearance.custom && <label className="check-label"><input type="checkbox" checked={appearance.selected}
      onChange={e => appearance.select(e.target.checked)} />{t('mobile.customTheme')}: {appearance.custom.dark.name}</label>}
    <label>{t('mobile.appearanceCode')}<textarea aria-label={t('mobile.appearanceCode')} value={text} rows={4} onChange={e => setText(e.target.value)} /></label>
    <div className="actions"><button onClick={() => { setText(compressConfig({ ...buildVisualSettingsConfig(), theme: appearance.theme })); setError(false); }}>{t('mobile.exportAppearance')}</button>
      <button disabled={!text.trim()} onClick={apply}>{t('mobile.importAppearance')}</button></div>
    {error && <p role="alert">{t('mobile.invalidAppearance')}</p>}
  </details>;
}
