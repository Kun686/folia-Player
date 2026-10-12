import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { List, type RowComponentProps } from 'react-window';
import type { SongResult } from '../types';
import type { ProviderCollection } from '../types/onlineMusic';
import { createCatalogSession } from './catalogSession';
import { mobileCatalogPort } from './useCatalog';
import type { MobilePlaylistEditor, PlaylistAccount } from './mobilePlaylistEditor';

// OnlinePlaylistPicker.tsx — original catalog pagination; only the owning account's editable playlists can be picked.
function Row({ index, style, lists, choose, disabled }: RowComponentProps<{
  lists: ProviderCollection[]; choose(collection: ProviderCollection): void; disabled: boolean;
}>) {
  return <div style={style}><button className="playlist-choice" disabled={disabled} onClick={() => choose(lists[index])}>
    <strong>{lists[index].name}</strong></button></div>;
}
export default function OnlinePlaylistPicker({ song, editor, close }: {
  song: SongResult; editor: MobilePlaylistEditor; close(): void;
}) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null);
  const provider = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : '';
  const catalog = useMemo(() => createCatalogSession(provider, mobileCatalogPort(provider)), [provider]);
  const state = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  const account = useRef<PlaylistAccount | null>(null), alive = useRef(true), locked = useRef(false);
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const read = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(false); account.current = null;
    try {
      const next = await editor.readAccount(provider);
      if (!alive.current) return;
      await catalog.refresh();
      if (!next.current() || String(catalog.getSnapshot().user?.id) !== String(next.user.id)) throw new Error('account-changed');
      account.current = next;
    } catch { if (alive.current) setError(true); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => {
    dialog.current?.showModal(); alive.current = true; catalog.start(); void read();
    return () => { alive.current = false; catalog.dispose(); };
  }, [catalog]);
  const lists = state.collections.filter(value => account.current && editor.canEdit(value, account.current.user)
    && value.providerId === provider && value.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choose = async (collection: ProviderCollection) => {
    if (locked.current || !account.current || error) return;
    locked.current = true; setBusy(true);
    try { await editor.add(song, collection, account.current); if (alive.current) close(); }
    catch { if (alive.current) { account.current = null; setError(true); } }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  return <dialog ref={dialog} className="sheet local-playlist-dialog" aria-label={t('mobile.onlinePlaylistAdd')}
    onCancel={close} onClose={close}>
    <header><h2>{t('mobile.onlinePlaylistAdd')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
    <p>{song.name}</p>
    <label>{t('mobile.searchPlaylists')}<input value={query} onChange={event => setQuery(event.target.value)} /></label>
    {busy && <p role="status">{t('mobile.loading')}</p>}
    {(error || state.accountError) && <p role="alert">{t('mobile.onlinePlaylistError')}
      <button disabled={busy} onClick={() => void read()}>{t('mobile.onlinePlaylistReload')}</button></p>}
    <List className="playlist-choices" style={{ height: 'min(40dvh, 320px)' }} rowComponent={Row} rowCount={lists.length} rowHeight={64}
      rowProps={{ lists, choose: value => void choose(value), disabled: busy || error || state.accountBusy || state.accountError }} />
    {!busy && !error && !state.accountError && !lists.length && <p>{t('mobile.onlinePlaylistEmpty')}</p>}
    {state.collectionsMore && <button disabled={busy || error || state.accountBusy} onClick={() => void catalog.loadCollections()}>{t('mobile.morePlaylists')}</button>}
  </dialog>;
}
