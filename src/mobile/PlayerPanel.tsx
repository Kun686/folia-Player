import { useEffect, useRef, useState } from 'react';
import { useMotionValue, useMotionValueEvent, type MotionValue } from 'framer-motion';
import { Play, Pause, SkipBack, SkipForward, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Classic from '../components/visualizer/classic/Visualizer';
import { DEFAULT_THEME, DAYLIGHT_THEME } from '../services/baseThemes';
import { findLatestActiveLineIndex } from '../utils/appPlaybackHelpers';
import { omni } from '../services/onlineMusic/omni';
import type { LyricData } from '../types';
import { native, type PlaybackSnapshot } from './bridge';

// src/mobile/PlayerPanel.tsx — original parsed lyrics/Classic animations consume the native clock.
export default function PlayerPanel({ state, time, visible, light, expanded, collapse }: {
  state: PlaybackSnapshot; time: MotionValue<number>; visible: boolean; light: boolean; expanded: boolean; collapse: () => void;
}) {
  const { t } = useTranslation();
  const [lyrics, setLyrics] = useState<LyricData | null>(null);
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
  const zero = useMotionValue(0);
  const song = state.queue[state.index];
  const key = song ? JSON.stringify(song.sourceRef) : '';
  useEffect(() => {
    let active = true; setLyrics(null); setLine(-1); lineRef.current = -1; setError(false);
    if (song) void omni.getLyrics(song).then(result => { if (active) setLyrics(result.lyrics); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [key]);
  useEffect(() => {
    const index = findLatestActiveLineIndex(lyrics?.lines ?? [], time.get());
    lineRef.current = index; setLine(index);
  }, [lyrics, time]);
  useMotionValueEvent(time, 'change', value => {
    const next = findLatestActiveLineIndex(lyrics?.lines ?? [], value);
    if (next !== lineRef.current) { lineRef.current = next; setLine(next); }
  });
  const command = (action: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'repeat', position?: number, mode?: string) =>
    void native.command({ action, position, mode }).catch(() => setError(true));
  return <section className={'player-panel ' + (expanded ? 'expanded' : '')} aria-label={t('mobile.play')}>
    <button className="player-collapse" onClick={collapse} aria-label={t('mobile.back')}><ChevronDown /></button>
    <div className="lyric-stage">
      {song && visible && (expanded || wide) && lyrics?.lines.length ? <Classic currentTime={time} lines={lyrics.lines} currentLineIndex={line}
        theme={light ? DAYLIGHT_THEME : DEFAULT_THEME} audioPower={zero}
        audioBands={{ bass: zero, lowMid: zero, mid: zero, vocal: zero, treble: zero }}
        paused={!state.playing} songTitle={song.name}  songArtist={song.artists.map(a => a.name).join(' / ')}
        onLyricLineSeek={position => command('seek', position)} background={{ mode: 'common', common: { disableGeometricBackground: true, disableVignette: true } }} backgroundStaticMode staticMode={false} />
        : <div className="empty-lyrics"><span>Folia</span><p>{song ? t('mobile.noLyrics') : t('mobile.noSongs')}</p></div>}
    </div>
    <div className="player-controls">
      <h2>{song?.name ?? 'Folia'}</h2><p>{song?.artists.map(a => a.name).join(' / ')}</p>
      <input type="range" aria-label={t('mobile.position')} min={0} max={state.duration || 1} step={0.1}
        value={Math.min(state.position, state.duration || 1)} disabled={!song || !state.duration}
        onChange={e => command('seek', Number(e.target.value))} />
      <div className="transport">
        <button onClick={() => command('previous')} aria-label={t('mobile.previous')} disabled={!song}><SkipBack /></button>
        <button className="primary-play" onClick={() => command(state.playing ? 'pause' : 'play')} aria-label={t(state.playing ? 'mobile.pause' : 'mobile.play')} disabled={!song}>
          {state.playing ? <Pause /> : <Play />}
        </button>
        <button onClick={() => command('next')} aria-label={t('mobile.next')} disabled={!song}><SkipForward /></button>
        <select aria-label={t('mobile.repeat')} value={state.repeat} onChange={e => command('repeat', undefined, e.target.value)}>
          {(['off', 'all', 'one'] as const).map(mode => <option key={mode} value={mode}>{t('mobile.' + mode)}</option>)}
        </select>
      </div>
      {(state.error || error) && <p role="alert">{t('mobile.error')} {state.error}</p>}
    </div>
  </section>;
}
