import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValueEvent, type MotionValue } from 'framer-motion';
import { Play, Pause, SkipBack, SkipForward, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import VisualizerRenderer from '../components/visualizer/VisualizerRenderer';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { useVisualizerBackgroundConfig } from '../components/visualizer/useVisualizerBackgroundConfig';
import { useVisualizerTunings } from '../components/visualizer/useVisualizerTunings';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useMobileTheme } from './useMobileTheme';
import { useTypographySettingsStore } from '../stores/useTypographySettingsStore';
import { buildVisualizerTheme } from '../components/app/presentation/buildVisualizerTheme';
import { findLatestActiveLineIndex } from '../utils/appPlaybackHelpers';
import { useMobileLyrics } from './useMobileLyrics';
import { useNativeAudio } from './useNativeAudio';
import VisualSettings from './VisualSettings';
import AudioControls from './AudioControls';
import TransitionControls from './TransitionControls';
import LyricTools from './LyricTools';
import { useLyricClock } from './useLyricClock';
import { importMobileLocalLyrics } from './localLyricImport';
import TransitionOverlays from './TransitionOverlays';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { useShallow } from 'zustand/react/shallow';
import { useVisualizerAssetStore } from '../stores/useVisualizerAssetStore';
import { NO_LYRIC_LINES } from '../utils/lyrics/noLyricLines';
import { native, type PlaybackSnapshot } from './bridge';

// src/mobile/PlayerPanel.tsx — original registry renderers consume the native clock and decoded audio.
const MobileVisualizer = memo(VisualizerRenderer);
export default function PlayerPanel({ state, time, visible, light, expanded, collapse }: {
  state: PlaybackSnapshot; time: MotionValue<number>; visible: boolean; light: boolean; expanded: boolean; collapse: () => void;
}) {
  const { t } = useTranslation();
  const [visualSettings, setVisualSettings] = useState(false);
  const [transitionSettings, setTransitionSettings] = useState(false);
  const [lyricToolsFor, setLyricToolsFor] = useState<string | null>(null);
  const audioSettingsOpen = useAudioSettingsStore(s => s.isAudioEqualizerOpen);
  const mode = useVisualizerSettingsStore(s => s.visualizerMode);
  const appearance = useMobileTheme();
  const typography = useTypographySettingsStore(useShallow(s => ({
    lyricsFontStyle: s.lyricsFontStyle, lyricsFontWeight: s.lyricsFontWeight,
    lyricsCustomFontFamily: s.lyricsCustomFont?.family ?? null, lyricsFontFallbackFamilies: s.lyricsFontFallbackFamilies,
    lyricsFontScale: s.lyricsFontScale, subtitleFontScale: s.subtitleFontScale, subtitleOverlayOpacity: s.subtitleOverlayOpacity,
    subtitleOverlayBackground: s.subtitleOverlayBackground, subtitleUpcomingLyricsBlur: s.subtitleUpcomingLyricsBlur,
    showHarmonySubtitle: s.showHarmonySubtitle, harmonySubtitleBackground: s.harmonySubtitleBackground,
    showSubtitleTranslation: s.showSubtitleTranslation, subtitleContentMode: s.subtitleContentMode,
    subtitleFontInheritsLyrics: s.subtitleFontInheritsLyrics, subtitleFontStyle: s.subtitleFontStyle,
    subtitleFontWeight: s.subtitleFontWeight, subtitleFontFamily: s.subtitleFontFamily, subtitleFontFallbackFamilies: s.subtitleFontFallbackFamilies,
  })));
  const { visualizerTheme, visualizerSubtitleTheme } = useMemo(() => buildVisualizerTheme({ ...typography, appStyle: {},
    theme: light ? appearance.theme.light : appearance.theme.dark, visualizerMode: mode }), [typography, light, appearance.theme, mode]);
  const staticMode = useThemeSettingsStore(s => s.staticMode);
  const background = useVisualizerBackgroundConfig();
  const visualizerTunings = useVisualizerTunings();
  const assets = useVisualizerAssetStore(useShallow(s => ({
    cappellaCustomEmojiImages: s.cappellaCustomEmojiImages, cappellaCustomAvatarImages: s.cappellaCustomAvatarImages,
    monetPortraitImage: s.monetPortraitImage,
  })));
  const [line, setLine] = useState(-1);
  const lineRef = useRef(-1);
  const [wide, setWide] = useState(matchMedia('(min-width: 850px)').matches);
  useEffect(() => {
    const media = matchMedia('(min-width: 850px)');
    const changed = () => setWide(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  const [error, setError] = useState(false);
  const song = state.currentSong;
  const { lyricTime, offsetMs, setOffsetMs, toPlaybackTime } = useLyricClock(song, time);
  const seekLyrics = useCallback((position: number) => {
    void native.command({ action: 'seek', position: toPlaybackTime(position) }).catch(() => setError(true));
  }, [toPlaybackTime]);
  const lyricSongKey = JSON.stringify(song?.sourceRef);
  const currentLyricSongKey = useRef(lyricSongKey); currentLyricSongKey.current = lyricSongKey;
  useEffect(() => { currentLyricSongKey.current = lyricSongKey; return () => { currentLyricSongKey.current = ''; }; }, []);
  const lyricTools = lyricToolsFor === lyricSongKey;
  useEffect(() => { setLyricToolsFor(null); }, [lyricSongKey]);
  const { lyrics, rawLyrics, cover, error: lyricsError, refresh } = useMobileLyrics(song ?? undefined, lyricTools);
  const rendering = visible && (expanded || wide) && !visualSettings && !audioSettingsOpen && !transitionSettings && !lyricTools;
  const audio = useNativeAudio(rendering, state.playing);
  const importLyrics = async () => {
    if (song?.sourceRef?.kind !== 'local') return;
    setError(false);
    try { if (await importMobileLocalLyrics(song.sourceRef.mediaId, () => currentLyricSongKey.current === lyricSongKey)) refresh(); }
    catch { if (currentLyricSongKey.current === lyricSongKey) setError(true); }
  };
  useEffect(() => {
    const index = findLatestActiveLineIndex(lyrics?.lines ?? [], lyricTime.get());
    lineRef.current = index; setLine(index);
  }, [lyrics, lyricTime]);
  useMotionValueEvent(lyricTime, 'change', value => {
    const next = findLatestActiveLineIndex(lyrics?.lines ?? [], value);
    if (next !== lineRef.current) { lineRef.current = next; setLine(next); }
  });
  const command = (action: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'repeat', position?: number, mode?: string) =>
    void native.command({ action, position, mode }).catch(() => setError(true));
  return <section className={'player-panel ' + (expanded ? 'expanded' : '')} aria-label={t('mobile.play')}>
    <button className="player-collapse" onClick={collapse} aria-label={t('mobile.back')}><ChevronDown /></button>
    <div className="lyric-stage">
      {song && rendering ? <MobileVisualizer mode={mode} currentTime={lyricTime} lines={lyrics?.lines ?? NO_LYRIC_LINES} currentLineIndex={line}
        constrainLyricsToStage
        theme={visualizerTheme} subtitleTheme={visualizerSubtitleTheme} {...typography} {...audio} isDaylight={light}
        paused={!state.playing} songTitle={song.name}  songArtist={song.artists.map(a => a.name).join(' / ')}
        songAlbum={song.album.name} coverUrl={cover} seed={JSON.stringify(song.sourceRef)}
        onLyricLineSeek={seekLyrics}
        background={background} visualizerTunings={visualizerTunings} staticMode={staticMode} {...assets} />
        : <div className="empty-lyrics"><span>Folia</span><p>{song ? t('mobile.noLyrics') : t('mobile.noSongs')}</p></div>}
      <TransitionOverlays visible={visible} stageVisible={rendering} song={song} cover={cover} light={light}
        theme={light ? appearance.theme.light : appearance.theme.dark} />
    </div>
    <div className="player-controls">
      <h2>{song?.name ?? 'Folia'}</h2><p>{song?.artists.map(a => a.name).join(' / ')}</p>
      <input type="range" aria-label={t('mobile.position')} min={0} max={state.duration || 1} step={0.1}
        value={Math.min(state.position, state.duration || 1)} disabled={!song || !state.duration}
        onChange={e => command('seek', Number(e.target.value))} />
      <div className="transport">
        <button onClick={() => command('previous')} aria-label={t('mobile.previous')} disabled={!song}><SkipBack /></button>
        <button className="primary-play" onClick={() => command(state.playing ? 'pause' : 'play')} aria-label={t(state.playing ? 'mobile.pause' : 'mobile.play')} disabled={!song && !state.queue.length}>
          {state.playing ? <Pause /> : <Play />}
        </button>
        <button onClick={() => command('next')} aria-label={t('mobile.next')} disabled={!song}><SkipForward /></button>
        <select aria-label={t('mobile.repeat')} value={state.repeat} onChange={e => command('repeat', undefined, e.target.value)}>
          {(['off', 'all', 'one'] as const).map(mode => <option key={mode} value={mode}>{t('mobile.' + mode)}</option>)}
        </select>
      </div>
      <AudioControls light={light} theme={light ? appearance.theme.light : appearance.theme.dark}
        unavailable={state.playing && state.audioProcessingAvailable === false} effects={state.audioEffects} replayGain={song?.replayGain} />
      <div className="player-options"><button onClick={() => setVisualSettings(true)}>{t('mobile.visuals')}</button>
        <button onClick={() => setTransitionSettings(true)}>{t('options.transitionSettings')}</button>
        {song && <button onClick={() => setLyricToolsFor(lyricSongKey)}>{t('localMusic.lyrics')}</button>}
        {song?.sourceRef?.kind === 'local' && <button onClick={() => void importLyrics()}>{t('mobile.importLyrics')}</button>}</div>
      {song && !lyrics?.lines.length && <p className="muted">{t('mobile.noLyrics')}</p>}
      {(state.error || error || lyricsError) && <p role="alert">{t('mobile.error')} {state.error}</p>}
    </div>
    <TransitionControls light={light} theme={light ? appearance.theme.light : appearance.theme.dark}
      open={transitionSettings} setOpen={setTransitionSettings} />
    {lyricTools && song && <LyricTools key={lyricSongKey} song={song} time={time} lyricTime={lyricTime} lyrics={lyrics}
      rawLyrics={rawLyrics} duration={state.duration} onSeek={seekLyrics} theme={light ? appearance.theme.light : appearance.theme.dark}
      offsetMs={offsetMs} onOffsetChange={setOffsetMs} light={light} visible={visible} close={() => setLyricToolsFor(null)} />}
    {visualSettings && <VisualSettings light={light} appearance={appearance} close={() => setVisualSettings(false)} />}
  </section>;
}
