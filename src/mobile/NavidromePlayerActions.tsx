import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import type { NativeNavidromeSettings } from './nativeNavidrome';
import { useNavidromeSettings } from './useNavidromeSettings';
import { navidromeRuntime } from './navidromeRuntime';
import { getNavidromeEditor } from './navidromeEditor';
import { navidromeErrorKey } from './localeNavidrome';
import NavidromeSongActions from './NavidromeSongActions';
import NavidromePlaylistSheet from './NavidromePlaylistSheet';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

// NavidromePlayerActions.tsx — the playing song shares the exact library actions and account-owned write lifetime.
function Connected({ song, settings }: { song: SongResult; settings: NativeNavidromeSettings }) {
  const { t } = useTranslation(), [add, setAdd] = useState(false), [error, setError] = useState(false);
  const editor = useMemo(() => getNavidromeEditor(settings, navidromeRuntime.capture()), [settings]);
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const key = getPlaybackSongKey(song), target = useMemo(() => ({ kind: 'add' as const, song }), [key]);
  const refresh = async () => {
    setError(false);
    try { await editor.playlists(); await editor.liked(song); editor.acknowledgeRefresh(); }
    catch { setError(true); }
  };
  return <div className="online-song-like">
    <NavidromeSongActions song={song} editor={editor} add={() => setAdd(true)} />
    {(state.error || error) && <p role="alert">{t(navidromeErrorKey(state.error))}
      <button disabled={state.busy} onClick={() => void refresh()}>{t('mobile.navidrome.reviewChanges')}</button></p>}
    {add && <NavidromePlaylistSheet target={target} editor={editor} changed={refresh} close={() => setAdd(false)} />}
  </div>;
}
export default function NavidromePlayerActions({ song }: { song: SongResult }) {
  const { t } = useTranslation(), state = useNavidromeSettings();
  if (state.error) return <p role="alert">{t(navidromeErrorKey(state.error))}
    <button onClick={() => void navidromeRuntime.load().catch(() => undefined)}>{t('mobile.retry')}</button></p>;
  if (state.busy || !state.settings) return <p role="status">{t('mobile.loading')}</p>;
  if (!state.settings.enabled || song.sourceRef?.kind !== 'navidrome' || song.sourceRef.scope !== state.settings.scope) {
    return <p role="alert">{t('mobile.navidrome.changed')}</p>;
  }
  return <Connected key={getPlaybackSongKey(song) + ':' + state.epoch} song={song} settings={state.settings} />;
}
