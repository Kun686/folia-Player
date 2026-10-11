import { useEffect, useRef, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ListMusic, MoreHorizontal, Music2, Pause, Play, Repeat, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatTime } from '../utils/appPlaybackHelpers';
import type { PlaybackSnapshot } from './bridge';

// PlayerChrome.tsx — floating transport over the original full-window visualizer; tools keep their existing components.
export default function PlayerChrome({ state, cover, hidden, reveal, collapse, openQueue, command, toolsOpen, setToolsOpen, children }: {
  state: PlaybackSnapshot; cover?: string; hidden: boolean; reveal(): void; collapse(): void; openQueue(): void;
  command(action: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'repeat', position?: number, mode?: string): void;
  toolsOpen: boolean; setToolsOpen(open: boolean): void; children: ReactNode;
}) {
  const { t } = useTranslation(), reducedMotion = useReducedMotion();
  const dialog = useRef<HTMLDialogElement>(null);
  const song = state.currentSong;
  useEffect(() => {
    if (toolsOpen && !dialog.current?.open) dialog.current?.showModal();
    else if (!toolsOpen && dialog.current?.open) dialog.current.close();
  }, [toolsOpen]);
  const transition = reducedMotion ? { duration: 0.12 } : { type: 'spring' as const, stiffness: 320, damping: 34 };
  return <>
    {hidden && <button className="player-wake" aria-label={t('mobile.showControls')}
      onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); reveal(); }} />}
    <motion.header className="player-heading" inert={hidden || toolsOpen} aria-hidden={hidden}
      initial={false} animate={{ opacity: hidden ? 0 : 1 }} transition={transition}>
      <button className="player-collapse chrome-button" onClick={collapse} aria-label={t('mobile.back')}><ChevronDown /></button>
      <div className="track-heading">
        <div className="track-art" aria-hidden="true">{cover ? <img src={cover} alt="" /> : <Music2 />}</div>
        <div className="track-description"><h2>{song?.name ?? 'Folia'}</h2><p>{song?.artists.map(a => a.name).join(' / ') || t('localMusic.unknownArtist')}</p></div>
      </div>
      <button className="chrome-button" aria-label={t('mobile.playerTools')} aria-haspopup="dialog" onClick={() => setToolsOpen(true)}><MoreHorizontal /></button>
    </motion.header>
    <motion.div className="player-controls" inert={hidden || toolsOpen} aria-hidden={hidden} initial={false}
      animate={{ opacity: hidden ? 0 : 1, y: hidden && !reducedMotion ? 18 : 0, scale: hidden && !reducedMotion ? 0.92 : 1 }} transition={transition}>
      <div className="playback-progress"><input type="range" aria-label={t('mobile.position')} min={0} max={state.duration || 1} step={0.1}
        value={Math.min(state.position, state.duration || 1)} disabled={!song || !state.duration}
        onChange={event => command('seek', Number(event.target.value))} />
        <div className="playback-times" aria-hidden="true"><span>{formatTime(state.position)}</span><span>{formatTime(state.duration)}</span></div>
      </div>
      <div className="transport">
        <div className="repeat-choice" data-repeat={state.repeat}><Repeat size={20} aria-hidden="true" /><select aria-label={t('mobile.repeat')} value={state.repeat} onChange={event => command('repeat', undefined, event.target.value)}>
          {(['off', 'all', 'one'] as const).map(mode => <option key={mode} value={mode}>{t('mobile.' + mode)}</option>)}
        </select>{state.repeat === 'one' && <span aria-hidden="true">1</span>}</div>
        <button onClick={() => command('previous')} aria-label={t('mobile.previous')} disabled={!song}><SkipBack /></button>
        <button className="primary-play" onClick={() => command(state.playing ? 'pause' : 'play')} aria-label={t(state.playing ? 'mobile.pause' : 'mobile.play')} disabled={!song && !state.queue.length}>
          {state.playing ? <Pause /> : <Play />}
        </button>
        <button onClick={() => command('next')} aria-label={t('mobile.next')} disabled={!song}><SkipForward /></button>
        <button onClick={openQueue} aria-label={t('mobile.queue')}><ListMusic /></button>
      </div>
    </motion.div>
    <dialog ref={dialog} className="player-tools sheet" aria-label={t('mobile.playerTools')}
      onCancel={event => { event.preventDefault(); setToolsOpen(false); }} onClose={() => setToolsOpen(false)}
      onClick={event => { if (event.target === event.currentTarget) setToolsOpen(false); }}>
      <header><h2>{t('mobile.playerTools')}</h2><button autoFocus onClick={() => setToolsOpen(false)}>{t('mobile.close')}</button></header>
      {children}
    </dialog>
  </>;
}
