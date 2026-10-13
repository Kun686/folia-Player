import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValueEvent, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import VisualizerRenderer from '../components/visualizer/VisualizerRenderer';
import { handleSetVisualizerMode, useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { useRandomVisualizerMode } from '../hooks/useRandomVisualizerMode';
import { useVisualizerBackgroundConfig } from '../components/visualizer/useVisualizerBackgroundConfig';
import { useVisualizerTunings } from '../components/visualizer/useVisualizerTunings';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import type { MobileTheme } from './useMobileTheme';
import { useTypographySettingsStore } from '../stores/useTypographySettingsStore';
import { buildVisualizerTheme } from '../components/app/presentation/buildVisualizerTheme';
import { findLatestActiveLineIndex } from '../utils/appPlaybackHelpers';
import { useMobileLyrics } from './useMobileLyrics';
import { useNativeAudio } from './useNativeAudio';
import VisualSettings from './VisualSettings';
import AudioControls from './AudioControls';
import PlayerChrome from './PlayerChrome';
import { usePlayerChrome } from './usePlayerChrome';
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
import type { SongResult } from '../types';
import { useMobileThemeGeneration } from './useMobileThemeGeneration';
import OnlineSongLike from './OnlineSongLike';
import type { MobileSongLikes } from './mobileSongLikes';
import SongInfoActions from './SongInfoActions';
import { VideoLayerPlayback } from '../components/visualizer/videoLayer/VideoLayerPlayback';

// src/mobile/PlayerPanel.tsx — original registry renderers consume the native clock and decoded audio.
const MobileVisualizer = memo(VisualizerRenderer);
export default function PlayerPanel({ appearance, state, time, visible, light, expanded, collapse, openQueue, captureSongGuard, songEpoch, likes, songLikeProviders }: {
  likes: MobileSongLikes; songLikeProviders: string[];
  songEpoch: number;
  appearance: MobileTheme;
  state: PlaybackSnapshot; time: MotionValue<number>; visible: boolean; light: boolean; expanded: boolean; collapse: () => void; openQueue: () => void;
  captureSongGuard: (song: SongResult) => () => boolean;
}) {
  const { t } = useTranslation();
  const [visualSettings, setVisualSettings] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [transitionSettings, setTransitionSettings] = useState(false);
  const [lyricToolsFor, setLyricToolsFor] = useState<string | null>(null);
  const audioSettingsOpen = useAudioSettingsStore(s => s.isAudioEqualizerOpen);
  const mode = useVisualizerSettingsStore(s => s.visualizerMode);
  const randomMode = useVisualizerSettingsStore(s => s.randomVisualizerModePerSong);
  useRandomVisualizerMode({ currentSong: state.currentSong, enabled: randomMode,
    visualizerMode: mode, setVisualizerMode: handleSetVisualizerMode });
  const visualizerOpacity = useVisualizerSettingsStore(s => s.visualizerOpacity);
  const typography = useTypographySettingsStore(useShallow(s => ({
    hideTranslationSubtitle: s.hidePlayerTranslationSubtitle,
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
  const [error, setError] = useState(false);
  const song = state.currentSong;
  const videoSongKey = JSON.stringify(song?.sourceRef);
  const videoPlayback = useMemo(() => ({ time, playing: state.playing, songKey: videoSongKey }), [time, state.playing, videoSongKey]);
  const { lyricTime, offsetMs, setOffsetMs, toPlaybackTime } = useLyricClock(song, time);
  const seekLyrics = useCallback((position: number) => {
    void native.command({ action: 'seek', position: toPlaybackTime(position) }).catch(() => setError(true));
  }, [toPlaybackTime]);
  const lyricSongKey = JSON.stringify(song?.sourceRef);
  const currentLyricSongKey = useRef(lyricSongKey); currentLyricSongKey.current = lyricSongKey;
  useEffect(() => { currentLyricSongKey.current = lyricSongKey; return () => { currentLyricSongKey.current = ''; }; }, []);
  const lyricTools = lyricToolsFor === lyricSongKey;
  useEffect(() => { setLyricToolsFor(null); }, [lyricSongKey]);
  const { lyrics, rawLyrics, cover, coverLoading, loading: lyricsLoading, error: lyricsError, segmentation, refresh } = useMobileLyrics(song ?? undefined, lyricTools);
  const generation = useMobileThemeGeneration(appearance, song, songEpoch, rawLyrics, lyricsLoading, cover, coverLoading, visible);
  const modalOpen = visualSettings || audioSettingsOpen || transitionSettings || lyricTools;
  const rendering = visible && expanded && !modalOpen;
  const { hidden, reveal: revealChrome, focusProps, stageTapProps } = usePlayerChrome(visible && expanded, state.playing,
    toolsOpen || modalOpen || error || !!state.error || !!lyricsError);
  useEffect(() => { if (modalOpen || !expanded) setToolsOpen(false); }, [modalOpen, expanded]);
  const audio = useNativeAudio(rendering, state.playing);
  const importLyrics = async () => {
    if (song?.sourceRef?.kind !== 'local') return;
    const isCurrent = captureSongGuard(song);
    setError(false);
    try { if (await importMobileLocalLyrics(song.sourceRef.mediaId, () => isCurrent() && currentLyricSongKey.current === lyricSongKey)) refresh(); }
    catch { if (isCurrent() && currentLyricSongKey.current === lyricSongKey) setError(true); }
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
  return <section className={'player-panel ' + (expanded ? 'expanded' : '')} aria-label={t('mobile.play')}
    data-controls-hidden={hidden} {...focusProps}>
    <div className="lyric-stage" {...stageTapProps}>
      {song && rendering ? <VideoLayerPlayback.Provider value={videoPlayback}><MobileVisualizer mode={mode} currentTime={lyricTime} lines={lyrics?.lines ?? NO_LYRIC_LINES} currentLineIndex={line}
        constrainLyricsToStage isPlayerChromeHidden={hidden} visualizerOpacity={visualizerOpacity}
        theme={visualizerTheme} subtitleTheme={visualizerSubtitleTheme} {...typography} {...audio} isDaylight={light}
        paused={!state.playing} songTitle={song.name}  songArtist={song.artists.map(a => a.name).join(' / ')}
        songAlbum={song.album.name} coverUrl={cover} seed={JSON.stringify(song.sourceRef)}
        onLyricLineSeek={seekLyrics}
        background={background} visualizerTunings={visualizerTunings} staticMode={staticMode} {...assets} /></VideoLayerPlayback.Provider>
        : <div className="empty-lyrics"><span>Folia</span><p>{song ? t('mobile.noLyrics') : t('mobile.noSongs')}</p></div>}
      <TransitionOverlays visible={visible} stageVisible={rendering} song={song} cover={cover} light={light}
        theme={light ? appearance.theme.light : appearance.theme.dark} />
      {song && !lyrics?.lines.length && <p className="lyric-notice" role="status">{t('mobile.noLyrics')}</p>}
    </div>
    <PlayerChrome state={state} cover={cover} hidden={hidden} reveal={revealChrome} collapse={collapse} openQueue={openQueue}
      command={command} toolsOpen={toolsOpen} setToolsOpen={setToolsOpen}>
      <AudioControls light={light} theme={light ? appearance.theme.light : appearance.theme.dark}
        unavailable={state.playing && state.audioProcessingAvailable === false} effects={state.audioEffects} listening={state.listening} replayGain={song?.replayGain} />
      {toolsOpen && expanded && song?.sourceRef?.kind === 'online' && <OnlineSongLike song={song} likes={likes}
        writable={songLikeProviders.includes(song.sourceRef.providerId)} />}
      {toolsOpen && expanded && song && <SongInfoActions song={song} details />}
      <div className="player-options"><button onClick={() => setVisualSettings(true)}>{t('mobile.visuals')}</button>
        <button onClick={() => setTransitionSettings(true)}>{t('options.transitionSettings')}</button>
        {song && <button onClick={() => setLyricToolsFor(lyricSongKey)}>{t('localMusic.lyrics')}</button>}
        {song?.sourceRef?.kind === 'local' && <button onClick={() => { setToolsOpen(false); void importLyrics(); }}>{t('mobile.importLyrics')}</button>}</div>
    </PlayerChrome>
    {(state.error || error || lyricsError) && <p className="player-error" role="alert">{t('mobile.error')} {state.error}</p>}
    <TransitionControls light={light} theme={light ? appearance.theme.light : appearance.theme.dark}
      open={transitionSettings} setOpen={setTransitionSettings} />
    {lyricTools && song && <LyricTools key={lyricSongKey} song={song} time={time} lyricTime={lyricTime} lyrics={lyrics}
      captureSongGuard={captureSongGuard}
      rawLyrics={rawLyrics} segmentation={segmentation} duration={state.duration} onSeek={seekLyrics} theme={light ? appearance.theme.light : appearance.theme.dark}
      offsetMs={offsetMs} onOffsetChange={setOffsetMs} light={light} visible={visible} close={() => setLyricToolsFor(null)} />}
    {visualSettings && <VisualSettings light={light} appearance={appearance} visible={visible} generation={generation}
      themeSource={{ songTitle: song?.name, isPureMusic: !!song?.isPureMusic,
        promptSourceText: (song?.isPureMusic ? song.name : lyrics?.lines.map(line => line.fullText).join('\n')) ?? null }} close={() => setVisualSettings(false)} />}
  </section>;
}
