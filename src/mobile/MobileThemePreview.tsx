import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '../types';
import ThemeParkPreview from '../components/modal/theme-park/ThemeParkPreview';
import { useThemeParkPreviewClock } from '../components/modal/theme-park/useThemeParkPreviewClock';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useTypographySettingsStore } from '../stores/useTypographySettingsStore';
import { useVisualizerAssetStore } from '../stores/useVisualizerAssetStore';
import { useVisualizerTunings } from '../components/visualizer/useVisualizerTunings';
import { useVisualizerBackgroundConfig } from '../components/visualizer/useVisualizerBackgroundConfig';
import { getVisualizerModeLabel } from '../components/visualizer/registry';

// MobileThemePreview.tsx — original sample preview and clock; the host unmounts it while hidden or closed.
export default function MobileThemePreview({ theme, mode }: { theme: Theme; mode: 'light' | 'dark' }) {
  const { t } = useTranslation(), [paused, setPaused] = useState(false);
  const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
  const visualizerOpacity = useVisualizerSettingsStore(state => state.visualizerOpacity);
  const staticMode = useThemeSettingsStore(state => state.staticMode);
  const settings = useTypographySettingsStore(useShallow(state => ({
    fontStyle: state.lyricsFontStyle, fontFamily: state.lyricsCustomFont?.family, fontWeight: state.lyricsFontWeight ?? undefined,
    lyricsFontScale: state.lyricsFontScale, showSubtitleTranslation: state.showSubtitleTranslation, subtitleContentMode: state.subtitleContentMode,
  })));
  const assets = useVisualizerAssetStore(useShallow(state => ({
    cappellaCustomEmojiImages: state.cappellaCustomEmojiImages, cappellaCustomAvatarImages: state.cappellaCustomAvatarImages,
    monetPortraitImage: state.monetPortraitImage,
  })));
  const clock = useThemeParkPreviewClock(visualizerMode, paused);
  const tunings = useVisualizerTunings(), background = useVisualizerBackgroundConfig();
  return <div className="mobile-theme-preview">
    <ThemeParkPreview theme={{ ...theme, fontStyle: settings.fontStyle, fontFamily: settings.fontFamily, fontWeight: settings.fontWeight }}
      mode={mode} visualizerMode={visualizerMode} visualizerModeLabel={getVisualizerModeLabel(visualizerMode, t)}
      visualizerOpacity={visualizerOpacity} staticMode={staticMode} {...settings} {...assets} {...clock}
      visualizerTunings={tunings} backgroundConfig={background} isPaused={paused} onTogglePause={() => setPaused(value => !value)} />
  </div>;
}
