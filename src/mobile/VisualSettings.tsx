import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useVisualizerSettingsStore, selectVisualizerSettingsSnapshot } from '../stores/useVisualizerSettingsStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useVisualizerAssetStore } from '../stores/useVisualizerAssetStore';
import { VISUALIZER_REGISTRY, getVisualizerModeLabel, getVisualizerRegistryEntry, hasVisualizerMode } from '../components/visualizer/registry';
import { VISUALIZER_BACKGROUND_REGISTRY, getVisualizerBackgroundModeLabel, hasVisualizerBackgroundMode, getVisualizerBackgroundRegistryEntry } from '../components/visualizer/backgrounds/registry';
import { useVisualizerBackgroundConfig } from '../components/visualizer/useVisualizerBackgroundConfig';
import type { VisualizerBackgroundActions } from '../components/visualizer/backgrounds/definition';
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
import PlaybackViewPreference from './PlaybackViewPreference';
import LiveSettingsSheet from './LiveSettingsSheet';
import { usePlaybackEntryViewStore } from '../stores/usePlaybackEntryViewStore';
import MobileSelect from './MobileSelect';
import type { ViewportPresentation } from '../types/viewportPresentation';

// src/mobile/VisualSettings.tsx — expose existing registry/settings and desktop persistence.
export default function VisualSettings({ light, close, appearance, visible, themeSource, generation, onPreviewChange }: {
  light: boolean; close: () => void; appearance: MobileTheme; visible: boolean; themeSource: MobileThemeSource; generation: MobileThemeGeneration;
  onPreviewChange?: (presentation: ViewportPresentation) => void;
}) {
  const { t } = useTranslation();
  const scrollBody = useSheetScroll();
  const [uploading, setUploading] = useState(false);
  const [themeEditor, setThemeEditor] = useState(false);
  const [aiSettings, setAISettings] = useState(false);
  const s = useVisualizerSettingsStore(useShallow(selectVisualizerSettingsSnapshot));
  const chooseView = usePlaybackEntryViewStore(state => state.setPlaybackEntryView);
  const staticMode = useThemeSettingsStore(state => state.staticMode);
  const assets = useVisualizerAssetStore(useShallow(state => ({
    cappellaCustomEmojiImages: state.cappellaCustomEmojiImages, cappellaCustomAvatarImages: state.cappellaCustomAvatarImages,
    cappellaCustomEmojiCount: state.cappellaCustomEmojiImages.length,
    hasCappellaCustomEmojiPack: state.cappellaCustomEmojiImages.length > 0,
    hasCappellaCustomAvatar: state.cappellaCustomAvatarImages.length > 0,
    isCappellaCustomEmojiPackLoading: state.isLoadingCappellaCustomEmojiPack,
    isCappellaCustomAvatarLoading: state.isLoadingCappellaCustomAvatarPack,
    monetPortraitImage: state.monetPortraitImage,
    isLoadingMonetPortraitImage: state.isLoadingMonetPortraitImage,
    isLoadingMonetBackgroundImage: state.isLoadingMonetBackgroundImage,
  })));
  const entry = getVisualizerRegistryEntry(s.visualizerMode);
  const background = useVisualizerBackgroundConfig();
  const backgroundEntry = getVisualizerBackgroundRegistryEntry(background.mode ?? 'common');
  const backgroundActions: VisualizerBackgroundActions = {
    common: { onCoverColorChange: useThemeSettingsStore.getState().handleToggleCoverColorBg, onOpacityChange: s.handleSetBackgroundOpacity,
      onDisableGeometricChange: s.handleToggleDisableVisualizerGeometricBackground, onDisableVignetteChange: s.handleToggleDisableVisualizerVignette },
    customImage: { onUpload: s.handleUploadMonetBackgroundImage, onClear: s.handleClearMonetBackgroundImage, isLoading: assets.isLoadingMonetBackgroundImage },
    monet: { onTuningChange: s.handleSetMonetBackgroundTuning, onResetTuning: s.handleResetMonetBackgroundTuning },
    nomand: { onTuningChange: s.handleSetNomandBackgroundTuning, onResetTuning: s.handleResetNomandBackgroundTuning },
    latent: { onTuningChange: s.handleSetLatentBackgroundTuning, onResetTuning: s.handleResetLatentBackgroundTuning },
    sora: { onTuningChange: s.handleSetSoraBackgroundTuning, onResetTuning: s.handleResetSoraBackgroundTuning },
    url: { onAdd: s.handleAddUrlBackgroundItem, onUpdate: s.handleUpdateUrlBackgroundItem, onDelete: s.handleDeleteUrlBackgroundItem, onSelect: s.handleSetUrlBackgroundSelectedId },
  };
  const resetVisualizer = () => entry.resetSettings?.({
    resetClassicTuning: s.handleResetClassicTuning, resetPartitaTuning: s.handleResetPartitaTuning,
    resetFumeTuning: s.handleResetFumeTuning, resetCladdaghTuning: s.handleResetCladdaghTuning,
    resetCappellaTuning: s.handleResetCappellaTuning, resetTiltTuning: s.handleResetTiltTuning,
    resetDioramaTuning: s.handleResetDioramaTuning, resetMonetTuning: s.handleResetMonetTuning,
    resetPendoloTuning: s.handleResetPendoloTuning, resetSonnetTuning: s.handleResetSonnetTuning,
    resetTemperaTuning: s.handleResetTemperaTuning, resetLumiereTuning: s.handleResetLumiereTuning,
  });
  const theme = light ? appearance.theme.light : appearance.theme.dark;
  // Keep drafts and native details/scroll state until this settings session closes.
  const subviewOpen = themeEditor || aiSettings;
  return <><LiveSettingsSheet hidden={subviewOpen} busy={uploading} close={close} onPreviewChange={onPreviewChange}>
    <div className="sheet-body" ref={scrollBody}>
    <fieldset className="visual-settings-content" disabled={uploading}>
    <div className="settings-group visual-quick-settings">
    <PlaybackViewPreference live />
    <div className="visual-mode-fields">
    <label>{t('mobile.visualizer')}<MobileSelect aria-label={t('mobile.visualizer')} value={s.visualizerMode} onChange={e => {
      if (hasVisualizerMode(e.target.value)) { s.handleSetVisualizerMode(e.target.value, { notify: false }); chooseView('player'); }
    }}>{VISUALIZER_REGISTRY.map(item => <option key={item.mode} value={item.mode}>{getVisualizerModeLabel(item.mode, t)}</option>)}</MobileSelect></label>
    <label>{t('mobile.background')}<MobileSelect aria-label={t('mobile.background')} value={s.visualizerBackgroundMode ?? 'common'} onChange={e => {
      if (hasVisualizerBackgroundMode(e.target.value)) { s.handleSetVisualizerBackgroundMode(e.target.value); chooseView('player'); }
    }}>{VISUALIZER_BACKGROUND_REGISTRY.map(item => <option key={item.mode} value={item.mode}>{getVisualizerBackgroundModeLabel(item.mode, t)}</option>)}</MobileSelect></label>
    </div>
    </div>
    <details className="visual-playback-options"><summary>{t('mobile.animationPlayback')}</summary>
    <label className="check-label"><input type="checkbox" checked={s.randomVisualizerModePerSong}
      onChange={e => s.handleToggleRandomVisualizerModePerSong(e.target.checked)} />{t('commandPalette.commands.visualizer-toggle-random-per-song.title')}</label>
    <label>{t('mobile.frameRate')}<MobileSelect aria-label={t('mobile.frameRate')} value={s.visualizerFrameRate} onChange={e => s.handleSetVisualizerFrameRate(e.target.value === 'off' ? 'off' : Number(e.target.value) as 60 | 90 | 120)}>
      <option value={60}>60 FPS</option><option value={90}>90 FPS</option><option value={120}>120 FPS</option><option value="off">{t('mobile.systemRate')}</option>
    </MobileSelect></label>
    <label className="check-label"><input type="checkbox" checked={staticMode} onChange={e => useThemeSettingsStore.getState().handleToggleStaticMode(e.target.checked)} />{t('mobile.staticMode')}</label>
    </details>
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
    {entry.resetSettings && <button className="mobile-visual-reset" onClick={resetVisualizer}>{t('ui.resetVisualizerTuning')}</button>}
    <Suspense fallback={<p>{t('mobile.loading')}</p>}>{entry.renderSettingsPanel?.({
      t, theme, isDaylight: light, controlCardBg: 'var(--mobile-settings-surface)', rangeInputClass: 'w-full',
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
    <details><summary>{t('mobile.background')}</summary>
    {backgroundEntry.resetSettings && <button className="mobile-visual-reset" onClick={() => backgroundEntry.resetSettings?.(backgroundActions)}>{t('ui.default')}</button>}
    <Suspense fallback={<p>{t('mobile.loading')}</p>}>
      {backgroundEntry.renderSettingsPanel?.({
        config: background, t, theme, isDaylight: light, controlCardBg: 'var(--mobile-settings-surface)', rangeInputClass: 'w-full',
        actions: backgroundActions,
      })}
    </Suspense></details>
    </fieldset>
    </div>
  </LiveSettingsSheet>
    {themeEditor && <MobileThemeEditor appearance={appearance} light={light} visible={visible} source={themeSource} close={() => setThemeEditor(false)} />}
    {aiSettings && <AISettingsSheet close={() => setAISettings(false)} />}
  </>;
}
