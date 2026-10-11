import { useTranslation } from 'react-i18next';
import type { LocalPlaylists } from './useLocalPlaylists';
import type { MobileLocalCollection } from '../types/mobileLibrary';

// LocalPlaylistToolbar.tsx — editing a playlist never removes its audio from the native library.
export default function LocalPlaylistToolbar({ controller, selected }: { controller: LocalPlaylists; selected?: MobileLocalCollection }) {
  const { t } = useTranslation();
  const playlist = controller.lists.find(list => list.id === selected?.playlistId);
  return <div className="local-playlist-toolbar">
    <button disabled={!controller.ready || controller.busy} onClick={() => controller.create()}>{t('localMusic.createPlaylist')}</button>
    <button disabled={!controller.ready || controller.busy} onClick={() => controller.setFileRequest({ type: 'import' })}>{t('localMusic.importPlaylist')}</button>
    {playlist && <button disabled={controller.busy} onClick={() => controller.setFileRequest({ type: 'export', playlist })}>{t('localMusic.exportPlaylist')}</button>}
    {playlist && !playlist.isFavorite && <>
      <button disabled={controller.busy} onClick={() => controller.setRequest({ type: 'rename', playlist })}>{t('mobile.renamePlaylist')}</button>
      <button disabled={controller.busy} onClick={() => {
        if (window.confirm(t('mobile.confirmDeletePlaylist', { name: playlist.name }))) void controller.run(() => controller.storage.delete(playlist.id));
      }}>{t('localMusic.deletePlaylist')}</button>
    </>}
    {controller.error && <><p role="alert">{t('mobile.playlistError')}</p>
      <button disabled={controller.busy} onClick={() => void controller.refresh()}>{t('mobile.retry')}</button></>}
  </div>;
}
