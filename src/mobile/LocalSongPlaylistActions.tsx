import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import type { MobileLocalCollection } from '../types/mobileLibrary';
import type { LocalPlaylists } from './useLocalPlaylists';

// LocalSongPlaylistActions.tsx — identity-based list edits remain separate from queue edits and deleting audio.
export default function LocalSongPlaylistActions({ song, controller, selected, close }: {
  song: SongResult; controller: LocalPlaylists; selected?: MobileLocalCollection; close(): void;
}) {
  const { t } = useTranslation();
  if (song.sourceRef?.kind !== 'local') return null;
  const id = song.sourceRef.mediaId;
  const playlist = controller.lists.find(list => list.id === selected?.playlistId);
  const index = playlist?.songIds.indexOf(id) ?? -1;
  const act = (work: () => void) => { close(); work(); };
  return <>
    <button disabled={!controller.ready || controller.busy} onClick={() => act(() => controller.add([song]))}>{t('localMusic.addToPlaylist')}</button>
    <button disabled={!controller.ready || controller.busy} onClick={() => act(() => { void controller.favorite(song); })}>
      {t(controller.isFavorite(song) ? 'mobile.unfavoriteLocal' : 'mobile.favoriteLocal')}</button>
    {playlist && index >= 0 && <>
      <button disabled={controller.busy} onClick={() => act(() => { void controller.run(() => controller.storage.remove(playlist.id, [id])); })}>
        {t('mobile.removeFromPlaylist')}</button>
      {([-1, 1] as const).map(direction => <button key={direction}
        disabled={controller.busy || index + direction < 0 || index + direction >= playlist.songIds.length}
        onClick={() => act(() => { void controller.run(() => controller.storage.move(playlist.id, id, direction)); })}>
        {t(direction < 0 ? 'mobile.moveSongUp' : 'mobile.moveSongDown')}</button>)}
    </>}
  </>;
}
