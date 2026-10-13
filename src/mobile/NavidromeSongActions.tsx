import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import type { MobileNavidromeEditor } from './navidromeEditor';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

// NavidromeSongActions.tsx — authoritative favorites and existing playlist tools in the touch song menu.
export default function NavidromeSongActions({ song, editor, add, remove, changed, close }: {
  song: SongResult; editor: MobileNavidromeEditor; add(): void; remove?(): void; changed?(): Promise<void>; close?(): void;
}) {
  const { t } = useTranslation(), [liked, setLiked] = useState<boolean | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const key = getPlaybackSongKey(song);
  useEffect(() => {
    let active = true; setLiked(null); setFailed(false);
    void editor.liked(song).then(value => { if (active) setLiked(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [editor, key, retry, state.revision, state.error]);
  return <>
    <button disabled={state.busy || !!state.error || liked === null} aria-pressed={liked === true} onClick={() => {
      close?.(); void editor.toggleLike(song).then(result => { if (result.ok) void changed?.(); });
    }}>{t(liked ? 'mobile.navidrome.unstar' : 'mobile.navidrome.star')}</button>
    {failed && <button onClick={() => setRetry(value => value + 1)}>{t('mobile.retry')}</button>}
    <button disabled={state.busy || !!state.error} onClick={() => { close?.(); add(); }}>{t('mobile.navidrome.addToPlaylist')}</button>
    {remove && <button disabled={state.busy || !!state.error} onClick={() => { close?.(); remove(); }}>{t('mobile.removeFromPlaylist')}</button>}
  </>;
}
