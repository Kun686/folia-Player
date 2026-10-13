import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { native } from './bridge';
import { mobileSongInfo } from './songInfo';

// SongInfoActions.tsx — touch equivalents of the original title click and Ctrl+click.
function Actions({ text, pageUrl }: Pick<ReturnType<typeof mobileSongInfo>, 'text' | 'pageUrl'>) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'error'>('idle');
  const active = useRef(true), pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const copy = async () => {
    if (pending.current) return;
    pending.current = true; setState('busy');
    try { await native.copyText({ text }); if (active.current) setState('copied'); }
    catch { if (active.current) setState('error'); }
    finally { pending.current = false; }
  };
  return <div className="song-info-actions">
    <button disabled={state === 'busy'} onClick={() => void copy()}>{t('mobile.copySongInfo')}</button>
    {pageUrl && <a href={pageUrl} target="_blank" rel="noopener noreferrer">{t('mobile.openSongPage')}</a>}
    {state === 'copied' && <p role="status">{t('status.copiedSongInfo')}</p>}
    {state === 'error' && <p role="alert">{t('status.copyFailed')}</p>}
  </div>;
}
export default function SongInfoActions({ song, details = false }: { song: SongResult; details?: boolean }) {
  const { t } = useTranslation(), info = mobileSongInfo(song);
  const actions = <Actions key={JSON.stringify([getPlaybackSongKey(song), info.text])} text={info.text} pageUrl={info.pageUrl} />;
  return details ? <details className="song-info-details"><summary>{t('localMusic.currentSongInfo')}</summary>
    <p>{song.name}</p><p>{info.metadata.artists.map(artist => artist.name).join(', ')}</p><p>{info.metadata.album.name}</p>
    {actions}
  </details> : actions;
}
