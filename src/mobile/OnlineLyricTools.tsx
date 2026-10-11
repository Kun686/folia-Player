import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionValue } from 'framer-motion';
import type { OnlineLyricsState, SongResult } from '../types';
import type { OnlineLyricsStorage } from '../services/onlineLyricsStorage';
import { getMobileRuntime } from '../services/mobileRuntime';
import OnlineLyricMatchModal from '../components/modal/OnlineLyricMatchModal';
import { getLyricProviderLabel, getSongNativeLyricProviderSource } from '../utils/lyrics/lyricSourceLabels';
import { LYRIC_IMPORT_ACCEPT } from '../utils/lyrics/lyricFileDecoding';
import { importMobileOnlineLyrics, resetMobileOnlineLyrics, scopedLyricStorage, switchMobileOnlineLyrics } from './onlineLyricEditor';

// OnlineLyricTools.tsx — touch entry to the original online lyric operations; parent keys this lifetime to the current song.
const sources = ['netease', 'qq'] as const;
export default function OnlineLyricTools({ song, time, light, close }: {
  song: SongResult; time: MotionValue<number>; light: boolean; close(): void;
}) {
  const { t } = useTranslation(), input = useRef<HTMLInputElement>(null), active = useRef(true), locked = useRef(false);
  const [storage, setStorage] = useState<OnlineLyricsStorage>();
  const [selection, setSelection] = useState<OnlineLyricsState | null>(null);
  const [matching, setMatching] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let mounted = true; active.current = true; setError(false);
    void (async () => {
      const original = await getMobileRuntime()?.lyrics?.open(song);
      if (!original) throw new Error('lyric-cache-unavailable');
      const port = scopedLyricStorage(original, () => mounted && active.current);
      const value = await port.readState();
      if (mounted) { setSelection(value); setStorage(port); }
    })().catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; active.current = false; };
  }, [JSON.stringify(song.sourceRef), retry]);
  const dismiss = () => { active.current = false; close(); };
  const run = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(false);
    try { await work(); if (active.current) dismiss(); }
    catch { if (active.current) setError(true); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  };
  if (matching && storage) return <div className="mobile-lyric-match">
    <OnlineLyricMatchModal song={song} storage={storage} sources={sources} currentTime={time} isDaylight={light}
      onClose={() => setMatching(false)} onMatch={dismiss} />
  </div>;
  const sourceLabel = getLyricProviderLabel(selection?.matchedLyricsSource ?? getSongNativeLyricProviderSource(song), selection?.matchedLyricsProviderPlatform);
  return <div className="sheet-backdrop"><section className="sheet online-lyric-tools" role="dialog" aria-modal="true" aria-label={t('localMusic.lyrics')}>
    <header><h2>{t('localMusic.lyrics')}</h2><button onClick={dismiss}>{t('mobile.close')}</button></header>
    <p>{song.name}</p>
    {!storage && !error && <p role="status">{t('localMusic.loadingLyrics')}</p>}
    <fieldset disabled={!storage || busy} className="online-lyric-actions">
      <legend>{t('localMusic.lyricsSource')}</legend>
      <button aria-pressed={selection?.lyricsSource !== 'imported'} onClick={() => void run(() => switchMobileOnlineLyrics(storage!, 'online'))}>{sourceLabel}</button>
      {selection?.importedLyrics && <button aria-pressed={selection.lyricsSource === 'imported'} onClick={() => void run(() => switchMobileOnlineLyrics(storage!, 'imported'))}>{t('localMusic.statusImported')}</button>}
      {selection?.importedLyricsName && <p className="muted">{selection.importedLyricsName}</p>}
      <button onClick={() => input.current?.click()}>{t('mobile.importLyrics')}</button>
      <input ref={input} type="file" accept={LYRIC_IMPORT_ACCEPT} aria-label={t('mobile.importLyrics')} hidden onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file && storage) void run(() => importMobileOnlineLyrics(storage, file));
      }} />
      <button onClick={() => setMatching(true)}>{t('localMusic.matchOnline')}</button>
      {(selection?.importedLyrics || selection?.hasOnlineOverride) && <button onClick={() => {
        if (window.confirm(t('mobile.confirmResetLyrics'))) void run(() => resetMobileOnlineLyrics(storage!, song));
      }}>{t('mobile.resetLyrics')}</button>}
    </fieldset>
    {busy && <p role="status">{t('localMusic.loadingLyrics')}</p>}
    {error && <p role="alert">{t('mobile.lyricEditError')}</p>}
    {!storage && error && <button onClick={() => setRetry(value => value + 1)}>{t('mobile.retry')}</button>}
  </section></div>;
}
