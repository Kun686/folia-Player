import { Crosshair, ListMusic, MoreHorizontal, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, AudioLines, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMemo, type CSSProperties } from 'react';
import type { MotionValue } from 'framer-motion';
import Lattice from '../components/app/lattice/Lattice';
import type { LatticeLyricSource } from '../components/app/lattice/lyrics/types';
import { PlayerState, type LyricData, type SongResult } from '../types';
import { useLatticeControlsStore } from '../stores/useLatticeControlsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { loadSongCover } from '../services/onlineMusic/resourceCache';
import { createLatticeArtworkSource } from '../components/app/lattice/latticeArtworkSource';
import { LatticeArtworkContext } from '../components/app/lattice/LatticeArtworkContext';
import type { PlaybackSnapshot } from './bridge';
import type { usePlaybackCommands } from './usePlaybackCommands';
import type { ViewportPresentation } from '../types/viewportPresentation';

// MobileLattice.tsx — original poster wall and lyric canvas; every transport action stays with the native queue.
export default function MobileLattice({ state, time, lyrics, lyricSource, light, commands, busy, queueError, toolsHidden,
  playSong, shuffle, back, openPlayer, openQueue, openTools, openVisuals, contentPresentation }: {
  contentPresentation?: ViewportPresentation;
  state: PlaybackSnapshot; time: MotionValue<number>; lyrics: LyricData | null; lyricSource: LatticeLyricSource;
  light: boolean; commands: ReturnType<typeof usePlaybackCommands>; busy: boolean; queueError: string; toolsHidden: boolean;
  playSong: (song: SongResult) => void; shuffle: () => void; back: () => void;
  openPlayer: () => void; openQueue: () => void; openTools: () => void; openVisuals: () => void;
}) {
  const { t } = useTranslation();
  const artwork = useMemo(() => createLatticeArtworkSource(loadSongCover, song => loadSongCover(song, true)), []);
  const focus = useLatticeControlsStore(s => s.focusCurrentSong);
  const keywordColoring = useVisualizerSettingsStore(s => s.monetTuning.keywordColoringEnabled);
  const send = commands.send;
  const theme = lyricSource.theme;
  const loopLabel = `${t('mobile.repeat')} · ${t(`mobile.${state.repeat}`)}`;
  return <div className="mobile-lattice" style={{ '--bg-color': theme.backgroundColor, '--text-primary': theme.primaryColor,
    '--text-secondary': theme.secondaryColor, '--text-accent': theme.accentColor } as CSSProperties}>
    <LatticeArtworkContext.Provider value={artwork}><Lattice fitViewport contentPresentation={contentPresentation} currentSong={state.currentSong} queue={state.queue} currentTime={time}
      playerState={state.playing ? PlayerState.PLAYING : PlayerState.PAUSED}
      playbackDuration={state.duration} canTogglePlayback={!busy && !!state.currentSong}
      lyrics={lyrics} lyricSource={lyricSource} lyricKeywordColoringEnabled={keywordColoring}
      isDaylight={light} onBack={back} backLabel={t('mobile.back')} onOpenPlayer={openPlayer}
      onPlaySong={song => { if (!busy) playSong(song); }}
      onTogglePlayback={() => send({ action: state.playing ? 'pause' : 'play' })}
      onSeek={position => send({ action: 'seek', position })}
      playbackExtras={<div className="lattice-chrome-actions">
        <button disabled={busy || !state.currentSong} aria-label={t('mobile.previous')} onClick={() => send({ action: 'previous' })}><SkipBack /></button>
        <button disabled={busy} aria-label={loopLabel} aria-pressed={state.repeat !== 'off'} onClick={() => send({ action: 'repeat', mode: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off' })}>
          {state.repeat === 'one' ? <Repeat1 /> : <Repeat />}
        </button>
        <button disabled={busy || state.queue.length < 2} aria-label={t('mobile.shuffleQueue')} onClick={shuffle}><Shuffle /></button>
        <button disabled={busy || !state.currentSong} aria-label={t('mobile.next')} onClick={() => send({ action: 'next' })}><SkipForward /></button>
      </div>}
      tools={<nav className="lattice-tools mobile-lattice-tools" aria-label={t('mobile.playerTools')}
        inert={toolsHidden} aria-hidden={toolsHidden}>
        <button disabled={!focus} onClick={() => focus?.()} aria-label={t('home.latticeFocusCurrent')}><Crosshair /></button>
        <button onClick={openQueue} aria-label={t('mobile.queue')}><ListMusic /></button>
        <button onClick={openPlayer} aria-label={t('mobile.lyricPlayer')}><AudioLines /></button>
        <button onClick={openVisuals} aria-label={t('mobile.visuals')}><Settings /></button>
        <button onClick={openTools} aria-label={t('mobile.playerTools')}><MoreHorizontal /></button>
      </nav>} /></LatticeArtworkContext.Provider>
    {queueError && <p className="mobile-lattice-error" role="alert">{t(`mobile.${queueError}`)}</p>}
  </div>;
}
