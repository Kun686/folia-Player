import { lazy, Suspense, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';
import { motion, useMotionValueEvent, type MotionValue } from 'framer-motion';
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
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { useMobileLyrics } from './useMobileLyrics';
import { useNativeAudio } from './useNativeAudio';
import VisualSettings from './VisualSettings';
import AudioControls from './AudioControls';
import PlayerChrome from './PlayerChrome';
import PlayerFeedback from './PlayerFeedback';
import type { usePlaybackCommands } from './usePlaybackCommands';
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
import type { PlaybackSnapshot } from './bridge';
import type { SongResult } from '../types';
import { useMobileThemeGeneration } from './useMobileThemeGeneration';
import OnlineSongLike from './OnlineSongLike';
import NavidromePlayerActions from './NavidromePlayerActions';
import type { MobileSongLikes } from './mobileSongLikes';
import SongInfoActions from './SongInfoActions';
import { VideoLayerPlayback } from '../components/visualizer/videoLayer/VideoLayerPlayback';
import { usePlaybackEntryViewStore } from '../stores/usePlaybackEntryViewStore';
import { useImmersiveStatusBar } from './useImmersiveStatusBar';
import { useCircularPlayer } from './useCircularPlayer';
import { FULL_VIEWPORT_PRESENTATION } from '../types/viewportPresentation';

// src/mobile/PlayerPanel.tsx — original registry renderers consume the native clock and decoded audio.
const MobileVisualizer = memo(VisualizerRenderer);
const MobileLattice = lazy(() => import('./MobileLattice'));
export default function PlayerPanel({ appearance, state, time, visible, light, expanded, collapse, openQueue, queueOpen, captureSongGuard, songEpoch, likes, songLikeProviders, commands, queueBusy, queueError, playQueueSong, shuffleQueue }: {
  queueOpen: boolean;
  queueBusy: boolean; queueError: string; playQueueSong: (song: SongResult) => void; shuffleQueue: () => void;
  commands: ReturnType<typeof usePlaybackCommands>;
  likes: MobileSongLikes; songLikeProviders: string[];
  songEpoch: number;
  appearance: MobileTheme;
  state: PlaybackSnapshot; time: MotionValue<number>; visible: boolean; light: boolean; expanded: boolean; collapse: () => void; openQueue: () => void;
  captureSongGuard: (song: SongResult) => () => boolean;
}) {
  const { t } = useTranslation();
  const presentation = useCircularPlayer(expanded);
  const lattice = usePlaybackEntryViewStore(s => s.playbackEntryView === 'lattice');
  const statusBarError = useImmersiveStatusBar(lattice && visible && presentation.present);
  const chooseView = usePlaybackEntryViewStore(s => s.setPlaybackEntryView);
  const [visualSettings, setVisualSettings] = useState(false);
  const [contentPresentation, setContentPresentation] = useState(FULL_VIEWPORT_PRESENTATION);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [transitionSettings, setTransitionSettings] = useState(false);
  const [lyricToolsFor, setLyricToolsFor] = useState<string | null>(null);
  const audioSettingsOpen = useAudioSettingsStore(s => s.isAudioEqualizerOpen);
  const mode = useVisualizerSettingsStore(s => s.visualizerMode);
  // Keep the current scene mounted while a newly selected lazy renderer loads. Only mode is
  // deferred: the native clock, audio, typography and tuning must continue updating immediately.
  const renderedMode = useDeferredValue(mode);
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
    theme: light ? appearance.theme.light : appearance.theme.dark, visualizerMode: renderedMode }), [typography, light, appearance.theme, renderedMode]);
  const staticMode = useThemeSettingsStore(s => s.staticMode);
  const background = useVisualizerBackgroundConfig();
  const visualizerTunings = useVisualizerTunings();
  const onMonetTuningChange = useVisualizerSettingsStore(s => s.handleSetMonetTuning);
  const assets = useVisualizerAssetStore(useShallow(s => ({
    cappellaCustomEmojiImages: s.cappellaCustomEmojiImages, cappellaCustomAvatarImages: s.cappellaCustomAvatarImages,
    monetPortraitImage: s.monetPortraitImage,
  })));
  const [line, setLine] = useState(-1);
  const lineRef = useRef(-1);
  const [error, setError] = useState(false);
  const { send, error: commandError } = commands;
  const song = state.currentSong;
  const videoSongKey = JSON.stringify(song?.sourceRef);
  const videoPlayback = useMemo(() => ({ time, playing: state.playing, songKey: videoSongKey }), [time, state.playing, videoSongKey]);
  const { lyricTime, offsetMs, setOffsetMs, toPlaybackTime } = useLyricClock(song, time);
  const seekLyrics = useCallback((position: number) => {
    send({ action: 'seek', position: toPlaybackTime(position) });
  }, [toPlaybackTime, send]);
  const lyricSongKey = JSON.stringify(song?.sourceRef);
  const currentLyricSongKey = useRef(lyricSongKey); currentLyricSongKey.current = lyricSongKey;
  useEffect(() => { currentLyricSongKey.current = lyricSongKey; return () => { currentLyricSongKey.current = ''; }; }, []);
  const lyricTools = lyricToolsFor === lyricSongKey;
  useEffect(() => { setLyricToolsFor(null); }, [lyricSongKey]);
  const { lyrics, rawLyrics, cover, coverLoading, loading: lyricsLoading, error: lyricsError, segmentation, refresh } = useMobileLyrics(song ?? undefined, lyricTools);
  const generation = useMobileThemeGeneration(appearance, song, songEpoch, rawLyrics, lyricsLoading, cover, coverLoading, visible);
  const modalOpen = visualSettings || audioSettingsOpen || transitionSettings || lyricTools;
  // Visual adjustments preview against the running renderer, without restarting its clock or audio feed.
  const rendering = visible && presentation.present && !audioSettingsOpen && !transitionSettings && !lyricTools;
  const { hidden, reveal: revealChrome, focusProps, stageTapProps } = usePlayerChrome(visible && expanded, lattice || state.playing,
    queueOpen || toolsOpen || modalOpen || error || statusBarError || commandError || !!state.error || !!lyricsError);
  useEffect(() => { if (modalOpen || !expanded) setToolsOpen(false); }, [modalOpen, expanded]);
  const audio = useNativeAudio(rendering && !lattice, state.playing);
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
    send({ action, position, mode });
  return <motion.section className={'player-panel ' + (presentation.present ? 'expanded' : '')} aria-label={t('mobile.play')}
    style={presentation.style} inert={!expanded} aria-hidden={!expanded} data-expanded={expanded}
    data-controls-hidden={hidden} data-surface={lattice ? 'lattice' : 'player'} {...focusProps}>
    <div className="lyric-stage" inert={modalOpen} {...(lattice ? {} : stageTapProps)}>
      {lattice && rendering ? <Suspense fallback={<p className="lyric-notice" role="status">{t('mobile.loading')}</p>}>
        <MobileLattice state={state} time={time} lyrics={lyrics ?? null} light={light} commands={commands} toolsHidden={hidden || modalOpen} contentPresentation={contentPresentation}
          lyricSource={{ currentTime: lyricTime, lines: lyrics?.lines ?? NO_LYRIC_LINES, currentLineIndex: line,
            theme: visualizerTheme, subtitleTheme: visualizerSubtitleTheme, paused: !state.playing, staticMode,
            showSubtitleTranslation: typography.showSubtitleTranslation, hideTranslationSubtitle: typography.hideTranslationSubtitle,
            subtitleContentMode: typography.subtitleContentMode }}
          busy={queueBusy} queueError={queueError} playSong={playQueueSong} shuffle={shuffleQueue}
          back={collapse} openQueue={openQueue} openPlayer={() => chooseView('player')} openTools={() => setToolsOpen(true)} openVisuals={() => setVisualSettings(true)} />
      </Suspense> : song && rendering ? <VideoLayerPlayback.Provider value={videoPlayback}><MobileVisualizer mode={renderedMode} currentTime={lyricTime} lines={lyrics?.lines ?? NO_LYRIC_LINES} currentLineIndex={line}
        constrainLyricsToStage contentPresentation={contentPresentation} isPlayerChromeHidden={hidden || visualSettings} visualizerOpacity={visualizerOpacity}
        theme={visualizerTheme} subtitleTheme={visualizerSubtitleTheme} {...typography} {...audio} isDaylight={light}
        paused={!state.playing} songTitle={song.name}  songArtist={song.artists.map(a => a.name).join(' / ')}
        songAlbum={song.album.name} coverUrl={cover} seed={getPlaybackSongKey(song)}
        onLyricLineSeek={seekLyrics}
        background={background} visualizerTunings={visualizerTunings} onMonetTuningChange={onMonetTuningChange} staticMode={staticMode} {...assets} /></VideoLayerPlayback.Provider>
        : <div className="empty-lyrics"><Music2 size={56} aria-hidden="true" /><p>{song ? t('mobile.noLyrics') : t('mobile.noSongs')}</p></div>}
      <TransitionOverlays visible={visible} stageVisible={rendering && !lattice} song={song} cover={cover} light={light}
        theme={light ? appearance.theme.light : appearance.theme.dark} />
      {!lattice && song && !lyricsLoading && !lyricsError && !lyrics?.lines.length && <p className="lyric-notice" role="status">{t('mobile.noLyrics')}</p>}
    </div>
    <PlayerChrome state={state} cover={cover} hidden={hidden} blocked={modalOpen} reveal={revealChrome} collapse={collapse} openQueue={openQueue}
      command={command} toolsOpen={toolsOpen} setToolsOpen={setToolsOpen}
      toolActions={<><button onClick={() => { chooseView(lattice ? 'player' : 'lattice'); setToolsOpen(false); }}>{t(lattice ? 'mobile.lyricPlayer' : 'home.latticeLabel')}</button>
        <button onClick={() => setVisualSettings(true)}>{t('mobile.visuals')}</button>
        <button onClick={() => setTransitionSettings(true)}>{t('options.transitionSettings')}</button>
        {song && <button onClick={() => setLyricToolsFor(lyricSongKey)}>{t('localMusic.lyrics')}</button>}
        {song?.sourceRef?.kind === 'local' && <button onClick={() => { setToolsOpen(false); void importLyrics(); }}>{t('mobile.importLyrics')}</button>}</>}>
      <AudioControls light={light} theme={light ? appearance.theme.light : appearance.theme.dark}
        unavailable={state.playing && state.audioProcessingAvailable === false} effects={state.audioEffects} listening={state.listening} replayGain={song?.replayGain} />
      {toolsOpen && expanded && song?.sourceRef?.kind === 'online' && <OnlineSongLike song={song} likes={likes}
        writable={songLikeProviders.includes(song.sourceRef.providerId)} />}
      {toolsOpen && expanded && song?.sourceRef?.kind === 'navidrome' && <NavidromePlayerActions song={song} />}
      {toolsOpen && expanded && song && <SongInfoActions song={song} details />}
    </PlayerChrome>
    <PlayerFeedback state={state} commandError={commandError} otherError={error || statusBarError} retryLyrics={lyricsError ? refresh : undefined} />
    <TransitionControls light={light} theme={light ? appearance.theme.light : appearance.theme.dark}
      open={transitionSettings} setOpen={setTransitionSettings} />
    {lyricTools && song && <LyricTools key={lyricSongKey} song={song} time={time} lyricTime={lyricTime} lyrics={lyrics}
      captureSongGuard={captureSongGuard}
      rawLyrics={rawLyrics} segmentation={segmentation} duration={state.duration} onSeek={seekLyrics} theme={light ? appearance.theme.light : appearance.theme.dark}
      offsetMs={offsetMs} onOffsetChange={setOffsetMs} light={light} visible={visible} close={() => setLyricToolsFor(null)} />}
    {visualSettings && <VisualSettings light={light} appearance={appearance} visible={visible} generation={generation} onPreviewChange={setContentPresentation}
      themeSource={{ songTitle: song?.name, isPureMusic: !!song?.isPureMusic,
        promptSourceText: (song?.isPureMusic ? song.name : lyrics?.lines.map(line => line.fullText).join('\n')) ?? null }} close={() => setVisualSettings(false)} />}
  </motion.section>;
}
