import { useEffect, useRef, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { useTranslation } from 'react-i18next';
import type { LocalPlaylist } from '../types';
import type { LocalPlaylists, PlaylistRequest } from './useLocalPlaylists';
import { normalizeLocalLibraryName } from '../utils/localLibraryNames';

// LocalPlaylistDialog.tsx — touch-friendly create/rename/add with retained input on write failure.
interface RowProps { lists: LocalPlaylist[]; busy: boolean; choose(id: string): void }
function Row({ index, style, lists, busy, choose }: RowComponentProps<RowProps>) {
  const { t } = useTranslation(), list = lists[index];
  return <div style={style}><button className="playlist-choice" disabled={busy} onClick={() => choose(list.id)}>
    <strong>{list.isFavorite ? t('localMusic.favoritePlaylist') : list.name}</strong>
    <small>{list.songIds.length} {t('mobile.tracks')}</small>
  </button></div>;
}
export default function LocalPlaylistDialog({ controller, request }: { controller: LocalPlaylists; request: PlaylistRequest }) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(request.type === 'rename' ? request.playlist.name : '');
  const [creating, setCreating] = useState(request.type !== 'add');
  const title = t(creating ? request.type === 'rename' ? 'mobile.renamePlaylist' : 'localMusic.createPlaylist' : 'localMusic.addToPlaylist');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const close = () => { if (!controller.busy) controller.setRequest(null); };
  const complete = async (work: () => Promise<unknown>) => {
    if (await controller.run(work)) controller.setRequest(null);
  };
  const needle = normalizeLocalLibraryName(name);
  const lists = controller.lists.filter(list => normalizeLocalLibraryName(list.isFavorite ? t('localMusic.favoritePlaylist') : list.name).includes(needle));
  return <dialog ref={dialog} className="sheet local-playlist-dialog" aria-label={title}
    onCancel={event => { event.preventDefault(); close(); }} onClose={close}>
    <header><h2>{title}</h2><button disabled={controller.busy} onClick={close}>{t('mobile.close')}</button></header>
    {request.type !== 'rename' && <p className="muted">{t('mobile.playlistLocalCount', { count: request.songs.length })}</p>}
    <form onSubmit={event => {
      event.preventDefault();
      if (creating && name.trim()) void complete(() => request.type === 'rename'
        ? controller.storage.rename(request.playlist.id, name) : controller.storage.create(name, request.songs));
    }}>
      <label>{t(creating ? 'localMusic.enterPlaylistName' : 'mobile.searchPlaylists')}
        <input autoFocus maxLength={256} disabled={controller.busy} value={name} onChange={event => setName(event.target.value)} />
      </label>
      {creating && <button disabled={controller.busy || !name.trim()}>{t('localMusic.save')}</button>}
    </form>
    {!creating && <>
      <List className="playlist-choices" style={{ height: 'min(40dvh, 320px)' }} rowComponent={Row}
        rowCount={lists.length} rowHeight={64} rowProps={{ lists, busy: controller.busy, choose: id => {
          if (request.type === 'add') void complete(() => controller.storage.add(id, request.songs));
        } }} overscanCount={3} />
      <button disabled={controller.busy} onClick={() => setCreating(true)}>{t('localMusic.createPlaylist')}</button>
    </>}
    {controller.error && <p role="alert">{t('mobile.playlistError')}</p>}
  </dialog>;
}
