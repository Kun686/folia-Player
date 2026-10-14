import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useVisualizerSettingsStore, selectVisualizerSettingsSnapshot } from '../stores/useVisualizerSettingsStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useVisualizerAssetStore } from '../stores/useVisualizerAssetStore';
import { VISUALIZER_REGISTRY, getVisualizerModeLabel, getVisualizerRegistryEntry, hasVisualizerMode } from '../components/visualizer/registry';
import { VISUALIZER_BACKGROUND_REGISTRY, getVisualizerBackgroundModeLabel, hasVisualizerBackgroundMode, getVisualizerBackgroundRegistryEntry } from '../components/visualizer/backgrounds/registry';
import { useVisualizerBackgroundConfig } from '../components/visualizer/useVisualizerBackgroundConfig';
import AppearanceTransfer from './AppearanceTransfer';
import type { MobileTheme } from './useMobileTheme';
import TypographyControls from './TypographyControls';
import MobileThemeEditor, { type MobileThemeSource } from './MobileThemeEditor';
import SongThemeControls from './SongThemeControls';
import ThemeGenerationControls from './ThemeGenerationControls';
import type { MobileThemeGeneration } from './useMobileThemeGeneration';
import AISettingsSheet from './AISettingsSheet';
import MotionReductionSettingsSection from '../components/modal/settings/MotionReductionSettingsSection';
import VideoLayerSettingsSection from '../components/modal/settings/VideoLayerSettingsSection';
import { useSheetScroll } from './useSheetScroll';

// src/mobile/VisualSettings.tsx — expose existing registry/settings and desktop persistence.
export default function VisualSettings({ light, close, appearance, visible, themeSource, generation }: {
  light: boolean; close: () => void; appearance: MobileTheme; visible: boolean; themeSource: MobileThemeSource; generation: MobileThemeGeneration;
}) {
  const { t } = useTranslation();
  const scrollBody = useSheetScroll();
  const [uploading, setUploading] = useState(false);
  const [themeEditor, setThemeEditor] = useState(false);
  const [aiSettings, setAISettings] = useState(false);
  const s = useVisualizerSettingsStore(useShallow(selectVisualizerSettingsSnapshot));
  const staticMode = useThemeSettingsStore(state => state.staticMode);
  const assets = useVisualizerAssetStore(useShallow(state => ({
    cappellaCustomEmojiImages: state.cappellaCustomEmojiImages, cappellaCustomAvatarImages: state.cappellaCustomAvatarImages,
    monetPortraitImage: state.monetPortraitImage,
  })));
  const entry = getVisualizerRegistryEntry(s.visualizerMode);
  const background = useVisualizerBackgroundConfig();
  const theme = light ? appearance.theme.light : appearance.theme.dark;
  // Keep drafts and native details/scroll state until this settings session closes.
  const subviewOpen = themeEditor || aiSettings;
  return <><div className="sheet-backdrop" hidden={subviewOpen} inert={subviewOpen}><section className="sheet sheet-pinned visual-settings" role="dialog" aria-modal="true" aria-label={t('mobile.visuals')}>
    <header><h2>{t('mobile.visuals')}</h2><button disabled={uploading} onClick={close}>{t('mobile.close')}</button></header>
    <div className="sheet-body" ref={scrollBody}>
    <fieldset className="visual-settings-content" disabled={uploading}>
    <label>{t('mobile.visualizer')}<select aria-label={t('mobile.visualizer')} value={s.visualizerMode} onChange={e => {
      if (hasVisualizerMode(e.target.value)) s.handleSetVisualizerMode(e.target.value, { notify: false });
    }}>{VISUALIZER_REGISTRY.map(item => <option key={item.mode} value={item.mode}>{getVisualizerModeLabel(item.mode, t)}</option>)}</select></label>
    <label className="check-label"><input type="checkbox" checked={s.randomVisualizerModePerSong}
      onChange={e => s.handleToggleRandomVisualizerModePerSong(e.target.checked)} />{t('commandPalette.commands.visualizer-toggle-random-per-song.title')}</label>
    <label>{t('mobile.background')}<select aria-label={t('mobile.background')} value={s.visualizerBackgroundMode ?? 'common'} onChange={e => {
      if (hasVisualizerBackgroundMode(e.target.value)) s.handleSetVisualizerBackgroundMode(e.target.value);
    }}>{VISUALIZER_BACKGROUND_REGISTRY.map(item => <option key={item.mode} value={item.mode}>{getVisualizerBackgroundModeLabel(item.mode, t)}</option>)}</select></label>
    <label>{t('mobile.frameRate')}<select aria-label={t('mobile.frameRate')} value={s.visualizerFrameRate} onChange={e => s.handleSetVisualizerFrameRate(e.target.value === 'off' ? 'off' : Number(e.target.value) as 60 | 90 | 120)}>
      <option value={60}>60 FPS</option><option value={90}>90 FPS</option><option value={120}>120 FPS</option><option value="off">{t('mobile.systemRate')}</option>
    </select></label>
    <label className="check-label"><input type="checkbox" checked={staticMode} onChange={e => useThemeSettingsStore.getState().handleToggleStaticMode(e.target.checked)} />{t('mobile.staticMode')}</label>
    <details className="mobile-motion-settings"><summary>{t('options.reduceMotionSection')}</summary>
      <MotionReductionSettingsSection theme={theme} surfaceIds={['transitionOverlay', 'monetBackground', 'uiMicroMotion']}
        settingsCardClass="border-[var(--border)]" settingsDividerClass="border-[var(--border)]" toggleOffBackgroundClass="bg-[var(--raised)]" />
    </details>
    <details className="mobile-video-settings"><summary>{t('options.videoLayerEnabled')}</summary>
      <VideoLayerSettingsSection theme={theme} onBusyChange={setUploading}
        settingsCardClass="border-[var(--border)]" settingsDividerClass="border-[var(--border)]" toggleOffBackgroundClass="bg-[var(--raised)]"
        getAccentOptionStyle={active => ({ color: 'var(--text)', background: active ? 'var(--raised)' : 'transparent', borderColor: active ? theme.accentColor : 'var(--border)' })} />
    </details>
    <AppearanceTransfer appearance={appearance} />
    <SongThemeControls appearance={appearance} />
    <ThemeGenerationControls appearance={appearance} generation={generation} configure={() => setAISettings(true)} />
    <button disabled={appearance.loading} className="mobile-theme-entry" onClick={() => setThemeEditor(true)}>{t('mobile.themeEditor')}</button>
    <TypographyControls theme={theme} onUploading={setUploading} />
    <Suspense fallback={<p>{t('mobile.loading')}</p>}>{entry.renderSettingsPanel?.({
      t, theme, isDaylight: light, controlCardBg: 'bg-black/5 dark:bg-white/5', rangeInputClass: 'w-full',
      ...assets, classicTuning: s.classicTuning, onClassicTuningChange: s.handleSetClassicTuning,
      partitaTuning: s.partitaTuning, onPartitaTuningChange: s.handleSetPartitaTuning,
      fumeTuning: s.fumeTuning, onFumeTuningChange: s.handleSetFumeTuning,
      claddaghTuning: s.claddaghTuning, onCladdaghTuningChange: s.handleSetCladdaghTuning,
      cappellaTuning: s.cappellaTuning, onCappellaTuningChange: s.handleSetCappellaTuning,
      tiltTuning: s.tiltTuning, onTiltTuningChange: s.handleSetTiltTuning,
      dioramaTuning: s.dioramaTuning, onDioramaTuningChange: s.handleSetDioramaTuning,
      monetTuning: s.monetTuning, onMonetTuningChange: s.handleSetMonetTuning,
      pendoloTuning: s.pendoloTuning, onPendoloTuningChange: s.handleSetPendoloTuning,
      sonnetTuning: s.sonnetTuning, onSonnetTuningChange: s.handleSetSonnetTuning,
      temperaTuning: s.temperaTuning, onTemperaTuningChange: s.handleSetTemperaTuning,
      lumiereTuning: s.lumiereTuning, onLumiereTuningChange: s.handleSetLumiereTuning,
      onImportCappellaCustomEmojiPack: s.handleImportCustomCappellaEmojiPack, onClearCappellaCustomEmojiPack: s.handleClearCustomCappellaEmojiPack,
      onImportCappellaCustomAvatar: s.handleImportCustomCappellaAvatar, onClearCappellaCustomAvatar: s.handleClearCustomCappellaAvatar,
      onUploadMonetPortraitImage: s.handleUploadMonetPortraitImage, onClearMonetPortraitImage: s.handleClearMonetPortraitImage,
    })}</Suspense>
    <details><summary>{t('mobile.background')}</summary><Suspense fallback={<p>{t('mobile.loading')}</p>}>
      {getVisualizerBackgroundRegistryEntry(background.mode ?? 'common').renderSettingsPanel?.({
        config: background, t, theme, isDaylight: light, controlCardBg: 'bg-black/5 dark:bg-white/5', rangeInputClass: 'w-full',
        actions: {
          common: { onCoverColorChange: useThemeSettingsStore.getState().handleToggleCoverColorBg, onOpacityChange: s.handleSetBackgroundOpacity,
            onDisableGeometricChange: s.handleToggleDisableVisualizerGeometricBackground, onDisableVignetteChange: s.handleToggleDisableVisualizerVignette },
          customImage: { onUpload: s.handleUploadMonetBackgroundImage, onClear: s.handleClearMonetBackgroundImage },
          monet: { onTuningChange: s.handleSetMonetBackgroundTuning, onResetTuning: s.handleResetMonetBackgroundTuning },
          nomand: { onTuningChange: s.handleSetNomandBackgroundTuning, onResetTuning: s.handleResetNomandBackgroundTuning },
          latent: { onTuningChange: s.handleSetLatentBackgroundTuning, onResetTuning: s.handleResetLatentBackgroundTuning },
          sora: { onTuningChange: s.handleSetSoraBackgroundTuning, onResetTuning: s.handleResetSoraBackgroundTuning },
          url: { onAdd: s.handleAddUrlBackgroundItem, onUpdate: s.handleUpdateUrlBackgroundItem, onDelete: s.handleDeleteUrlBackgroundItem, onSelect: s.handleSetUrlBackgroundSelectedId },
        },
      })}
    </Suspense></details>
    </fieldset>
    </div>
  </section></div>
    {themeEditor && <MobileThemeEditor appearance={appearance} light={light} visible={visible} source={themeSource} close={() => setThemeEditor(false)} />}
    {aiSettings && <AISettingsSheet close={() => setAISettings(false)} />}
  </>;
}
