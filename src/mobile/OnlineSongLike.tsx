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
  const busy = state.phase === 'loading' || state.phase === 'saving';
  const retry = state.phase === 'error', anonymous = state.phase === 'anonymous';
  const ready = state.phase === 'ready' || state.phase === 'saving';
  const label = retry ? 'mobile.onlineLikeReload' : busy ? 'mobile.loading'
    : anonymous || state.writable ? (state.liked ? 'mobile.onlineUnlike' : 'mobile.onlineLike')
    : (state.liked ? 'mobile.onlineLiked' : 'mobile.onlineNotLiked');
  const messages = [
    { key: 'mobile.onlineLikeLogin', active: anonymous },
    { key: 'mobile.onlineLikeError', active: retry },
    { key: 'mobile.onlineLikeReadOnly', active: ready && !state.writable },
  ];
  return <div className="online-song-like" aria-label={t('mobile.onlineLikeState')}>
    <button disabled={busy || anonymous || (!retry && !state.writable)}
      aria-pressed={ready ? !!state.liked : undefined}
      onClick={() => void (retry ? session.read() : session.change())}>
      <Heart size={18} fill={ready && state.liked ? 'currentColor' : 'none'} aria-hidden="true" />
      <span role={busy ? 'status' : undefined}>{t(label)}</span>
    </button>
    {/* Invisible messages still size the shared slot, so network results cannot move touch targets. */}
    <div className="online-song-like-message">
      {messages.map(message => <p key={message.key} className="muted" data-active={message.active}
        aria-hidden={!message.active} role={message.active && retry ? 'alert' : undefined}>{t(message.key)}</p>)}
    </div>
  </div>;
}
