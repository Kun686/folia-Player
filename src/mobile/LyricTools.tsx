import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionValue } from 'framer-motion';
import type { LyricData, OnlineLyricsState, SongResult, Theme } from '../types';
import type { OnlineLyricsStorage } from '../services/onlineLyricsStorage';
import { getMobileRuntime } from '../services/mobileRuntime';
import OnlineLyricMatchModal from '../components/modal/OnlineLyricMatchModal';
import GlobalLyricOffsetModal from '../components/modal/settings/GlobalLyricOffsetModal';
import LyricTimelineOffsetControl from '../components/panelTab/LyricTimelineOffsetControl';
import LocalLyricTools from './LocalLyricTools';
import LyricDisplaySettings from './LyricDisplaySettings';
import LyricsTimelineModal from '../components/modal/LyricsTimelineModal';
import LyricSegmentationEditor from './LyricSegmentationEditor';
import LyricExportDialog from './LyricExportDialog';
import type { MobileSegmentation } from './useMobileSegmentation';
import { getLyricProviderLabel, getSongNativeLyricProviderSource } from '../utils/lyrics/lyricSourceLabels';
import { importMobileOnlineLyrics, resetMobileOnlineLyrics, scopedLyricStorage, switchMobileOnlineLyrics } from './onlineLyricEditor';
import { MOBILE_LYRIC_MATCH_SOURCES } from './lyricMatchRequests';

// LyricTools.tsx — original lyric operations and timing controls, keyed to the displayed song by the parent.
export default function LyricTools({ song, time, lyricTime, lyrics, rawLyrics, segmentation, duration, onSeek, theme, offsetMs, onOffsetChange, light, visible, close, captureSongGuard }: {
  song: SongResult; time: MotionValue<number>; lyricTime: MotionValue<number>; lyrics: LyricData | null;
  rawLyrics: LyricData | null; duration: number; onSeek(position: number): void; theme: Theme;
  segmentation: MobileSegmentation;
  offsetMs: number; onOffsetChange(value: number): void; light: boolean; visible: boolean; close(): void;
  captureSongGuard: (song: SongResult) => () => boolean;
}) {
  const { t } = useTranslation(), input = useRef<HTMLInputElement>(null), active = useRef(true), locked = useRef(false);
  const [storage, setStorage] = useState<OnlineLyricsStorage>();
  const [selection, setSelection] = useState<OnlineLyricsState | null>(null);
  const [matching, setMatching] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [displaySettings, setDisplaySettings] = useState(false), [timeline, setTimeline] = useState(false);
  const [segmenting, setSegmenting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [retry, setRetry] = useState(0);
  const online = song.sourceRef?.kind === 'online' || song.sourceRef?.kind === 'navidrome';
  useEffect(() => {
    let mounted = true; active.current = true; setError(false);
    if (online) void (async () => {
      const original = await getMobileRuntime()?.lyrics?.open(song);
      if (!original) throw new Error('lyric-cache-unavailable');
      const port = scopedLyricStorage(original, () => mounted && active.current);
      const value = await port.readState();
      if (mounted) { setSelection(value); setStorage(port); }
    })().catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; active.current = false; };
  }, [JSON.stringify(song.sourceRef), retry, online]);
  const dismiss = () => { active.current = false; close(); };
  const run = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(false);
    try { await work(); if (active.current) dismiss(); }
    catch { if (active.current) setError(true); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  };
  if (displaySettings) return <LyricDisplaySettings lyrics={rawLyrics} title={song.name} light={light} close={() => setDisplaySettings(false)} />;
  if (exporting) return <LyricExportDialog song={song} lyrics={rawLyrics} light={light} theme={theme} close={() => setExporting(false)} />;
  if (segmenting) return <LyricSegmentationEditor lyrics={rawLyrics} title={song.name} segmentation={segmentation}
    theme={theme} light={light} visible={visible} captureGuard={() => captureSongGuard(song)} close={() => setSegmenting(false)} />;
  if (timeline) return <div className="mobile-lyrics-timeline"><LyricsTimelineModal isOpen={visible} lyrics={lyrics}
    currentTime={lyricTime} duration={duration} onSeek={onSeek} onClose={() => setTimeline(false)}
    isDaylight={light} theme={theme} primaryColor={theme.primaryColor} secondaryColor={theme.secondaryColor} accentColor={theme.accentColor} /></div>;
  if (matching && storage) return <div className="mobile-lyric-match">
    <OnlineLyricMatchModal song={song} storage={storage} sources={MOBILE_LYRIC_MATCH_SOURCES} currentTime={time} isDaylight={light}
      onClose={() => setMatching(false)} onMatch={dismiss} />
  </div>;
  if (calibrating) return <div className="mobile-lyric-offset">
    <GlobalLyricOffsetModal isOpen={visible} isDaylight={light} lyrics={lyrics} lyricCurrentTime={lyricTime}
      onClose={() => setCalibrating(false)} />
  </div>;
  const sourceLabel = song.sourceRef?.kind === 'navidrome' && !selection?.matchedLyricsSource ? 'Navidrome'
    : getLyricProviderLabel(selection?.matchedLyricsSource ?? getSongNativeLyricProviderSource(song), selection?.matchedLyricsProviderPlatform);
  return <div className="sheet-backdrop"><section className="sheet online-lyric-tools" role="dialog" aria-modal="true" aria-label={t('localMusic.lyrics')}>
    <header><h2>{t('localMusic.lyrics')}</h2><button onClick={dismiss}>{t('mobile.close')}</button></header>
    <p>{song.name}</p>
    {online && !storage && !error && <p role="status">{t('localMusic.loadingLyrics')}</p>}
    {online ? <fieldset disabled={!storage || busy} className="online-lyric-actions">
      <legend>{t('localMusic.lyricsSource')}</legend>
      <button aria-pressed={selection?.lyricsSource !== 'imported'} onClick={() => void run(() => switchMobileOnlineLyrics(storage!, 'online'))}>{sourceLabel}</button>
      {selection?.importedLyrics && <button aria-pressed={selection.lyricsSource === 'imported'} onClick={() => void run(() => switchMobileOnlineLyrics(storage!, 'imported'))}>{t('localMusic.statusImported')}</button>}
      {selection?.importedLyricsName && <p className="muted">{selection.importedLyricsName}</p>}
      <button onClick={() => input.current?.click()}>{t('mobile.importLyrics')}</button>
      {/* iOS may disable FIA/LRC files when WebKit maps accept extensions to document types.
          Let the original import parser validate the selected file, including its size limit. */}
      <input ref={input} type="file" aria-label={t('mobile.importLyrics')} hidden onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file && storage) void run(() => importMobileOnlineLyrics(storage, file));
      }} />
      <button onClick={() => setMatching(true)}>{t('localMusic.matchOnline')}</button>
      {(selection?.importedLyrics || selection?.hasOnlineOverride) && <button onClick={() => {
        if (window.confirm(t('mobile.confirmResetLyrics'))) void run(() => resetMobileOnlineLyrics(storage!, song));
      }}>{t('mobile.resetLyrics')}</button>}
    </fieldset> : song.sourceRef?.kind === 'local' && <LocalLyricTools key={song.sourceRef.mediaId}
      id={song.sourceRef.mediaId} light={light} time={time} onDone={dismiss} captureSongGuard={() => captureSongGuard(song)} />}
    <div className="mobile-lyric-timing">
      <button onClick={() => setTimeline(true)}>{t('timeline.title')}</button>
      <button onClick={() => setDisplaySettings(true)} disabled={!rawLyrics}>{t('lyricFilter.title')}</button>
      <button onClick={() => setSegmenting(true)} disabled={!rawLyrics}>{t('commandPalette.commands.lyric-segmentation.title')}</button>
      <button onClick={() => setExporting(true)}>{t('lyricFile.exportHeading')}</button>
      <LyricTimelineOffsetControl offsetMs={offsetMs} onOffsetChange={onOffsetChange} isDaylight={light} />
      <button onClick={() => setCalibrating(true)}>{t('options.globalLyricTimelineOffset')}</button>
    </div>
    {busy && <p role="status">{t('localMusic.loadingLyrics')}</p>}
    {error && <p role="alert">{t('mobile.lyricEditError')}</p>}
    {online && !storage && error && <button onClick={() => setRetry(value => value + 1)}>{t('mobile.retry')}</button>}
  </section></div>;
}
