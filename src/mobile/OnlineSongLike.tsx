import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import type { SongResult } from '../types';
import type { MobileSongLikes } from './mobileSongLikes';

// OnlineSongLike.tsx — shared touch action for a library/queue row and the playing song.
export default function OnlineSongLike({ song, likes, writable }: { song: SongResult; likes: MobileSongLikes; writable: boolean }) {
  const { t } = useTranslation(), key = getPlaybackSongKey(song);
  // Metadata snapshots may change each native tick; ownership is the stable source key.
  const session = useMemo(() => likes.createSession(song, writable), [likes, key, writable]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    const sync = () => { if (document.hidden) session.dispose(); else session.start(); };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { document.removeEventListener('visibilitychange', sync); session.dispose(); };
  }, [session]);
  return <div className="online-song-like" aria-label={t('mobile.onlineLikeState')}>
    {state.phase === 'loading' ? <p role="status">{t('mobile.loading')}</p>
      : state.phase === 'anonymous' ? <p>{t('mobile.onlineLikeLogin')}</p>
      : state.phase === 'error' ? <><p role="alert">{t('mobile.onlineLikeError')}</p>
        <button onClick={() => void session.read()}>{t('mobile.onlineLikeReload')}</button></>
      : <><button disabled={!state.writable || state.phase === 'saving'} aria-pressed={!!state.liked}
        onClick={() => void session.change()}>
        <Heart size={18} fill={state.liked ? 'currentColor' : 'none'} aria-hidden="true" />
        {t(state.phase === 'saving' ? 'mobile.loading' : state.writable
          ? (state.liked ? 'mobile.onlineUnlike' : 'mobile.onlineLike')
          : (state.liked ? 'mobile.onlineLiked' : 'mobile.onlineNotLiked'))}
      </button>{!state.writable && <p className="muted">{t('mobile.onlineLikeReadOnly')}</p>}</>}
  </div>;
}
