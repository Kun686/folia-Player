import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import type { SubsonicPlaylist } from '../types/navidrome';
import type { MobileNavidromeEditor } from './navidromeEditor';
import { navidromeErrorKey } from './localeNavidrome';

// NavidromePlaylistSheet.tsx — existing touch sheet for original create/add/rename/delete actions.
export type NavidromePlaylistTarget = { kind: 'create' } | { kind: 'edit'; playlist: SubsonicPlaylist } | { kind: 'add'; song: SongResult };
export default function NavidromePlaylistSheet({ target, editor, changed, close }: {
  target: NavidromePlaylistTarget; editor: MobileNavidromeEditor; changed(deleted?: boolean): Promise<void>; close(): void;
}) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null), active = useRef(true);
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [title, setTitle] = useState(target.kind === 'edit' ? target.playlist.name : '');
  const [playlists, setPlaylists] = useState<SubsonicPlaylist[] | null>(null), [readError, setReadError] = useState(false);
  useEffect(() => { active.current = true; dialog.current?.showModal(); return () => { active.current = false; }; }, []);
  const reload = async () => {
    setReadError(false);
    try { const lists = await editor.playlists(); if (active.current) {
      setPlaylists(lists);
      if (editor.getSnapshot().error) { await changed(true); editor.acknowledgeRefresh(); if (active.current) close(); }
    } }
    catch { if (active.current) setReadError(true); }
  };
  useEffect(() => { if (target.kind === 'add') void reload(); }, [target, editor]);
  const apply = async (work: () => Promise<{ ok: boolean }>, deleted = false) => {
    const result = await work(); if (!result.ok) return;
    await changed(deleted); if (active.current) close();
  };
  const disabled = state.busy || !!state.error;
  return <dialog ref={dialog} className="sheet" aria-label={t('mobile.navidrome.playlistTools')}
    onCancel={event => { if (event.target === event.currentTarget) close(); }} onClose={event => { if (event.target === event.currentTarget) close(); }}>
    <header><h2>{t('mobile.navidrome.playlistTools')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
    {target.kind === 'add' && <section><h3>{t('mobile.navidrome.addToPlaylist')}</h3>
      {!playlists && !readError && <p role="status">{t('mobile.loading')}</p>}
      {playlists?.map(list => <button key={list.id} disabled={disabled} onClick={() => void apply(() => editor.add(list.id, [target.song]))}>{list.name}</button>)}
      {playlists?.length === 0 && <p>{t('mobile.empty')}</p>}
    </section>}
    <form onSubmit={event => { event.preventDefault(); void apply(() => target.kind === 'edit'
      ? editor.rename(target.playlist.id, title) : editor.create(title, target.kind === 'add' ? [target.song] : [])); }}>
      <label>{t('mobile.navidrome.playlistName')}<input value={title} maxLength={512} disabled={state.busy} onChange={event => setTitle(event.target.value)} /></label>
      <button disabled={disabled || !title.trim()}>{t(target.kind === 'edit' ? 'mobile.navidrome.renamePlaylist' : 'mobile.navidrome.createPlaylist')}</button>
    </form>
    {target.kind === 'edit' && <button disabled={disabled} onClick={() => {
      if (window.confirm(t('mobile.navidrome.confirmDelete', { name: target.playlist.name }))) void apply(() => editor.delete(target.playlist.id), true);
    }}>{t('mobile.navidrome.deletePlaylist')}</button>}
    {state.busy && <p role="status">{t('mobile.loading')}</p>}
    {(state.error || readError) && <p role="alert">{t(navidromeErrorKey(state.error))}
      <button disabled={state.busy} onClick={() => void reload()}>{t('mobile.navidrome.reviewChanges')}</button></p>}
  </dialog>;
}
