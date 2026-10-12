import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import type { ProviderCollection } from '../types/onlineMusic';
import type { CollectionResource, CollectionResourceSnapshot } from '../library/core/contracts/resource';
import type { CollectionMutationController } from '../library/core/contracts/mutations';
import { createCollectionResource } from '../library/core/services/createCollectionResource';
import { collectionKey } from '../library/core/model/collectionIdentity';
import { formatEntryKey } from '../library/core/model/collectionEntries';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import type { MobilePlaylistEditor } from './mobilePlaylistEditor';
import SongList from './SongList';

// OnlinePlaylistManager.tsx — original collection resource and authoritative removal controller in a touch sheet.
export default function OnlinePlaylistManager({ collection, editor, close, play, add, queueBusy, queueError }: {
  collection: ProviderCollection; editor: MobilePlaylistEditor; close(): void;
  play(songs: SongResult[], index: number): void; add(song: SongResult, next?: boolean): void;
  queueBusy: boolean; queueError: string;
}) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null);
  const resource = useRef<CollectionResource | null>(null), controller = useRef<CollectionMutationController | null>(null);
  const [state, setState] = useState<CollectionResourceSnapshot | null>(null);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const active = useRef(true), locked = useRef(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    active.current = true; setError(false); setState(null);
    // Editing always reads current server tracks instead of trusting an earlier cached playlist version.
    const descriptor = { ...collection, source: 'online' as const, tracksUpdatedAt: 0, updatedAt: 0 };
    const current = createCollectionResource(collectionKey(descriptor), descriptor); resource.current = current;
    const unsubscribe = current.subscribe(() => setState(current.getSnapshot()));
    let canceled = false;
    void editor.readAccount(collection.providerId).then(account => {
      if (canceled) return;
      if (!editor.canEdit(collection, account.user)) throw new Error('not-owned');
      controller.current = editor.removals(collection, current, account);
      current.ensure(descriptor, { currentUserId: account.user.id }); setState(current.getSnapshot());
    }).catch(() => { if (!canceled) setError(true); });
    return () => { canceled = true; active.current = false; controller.current?.dispose(); controller.current = null;
      unsubscribe(); current.dispose(); resource.current = null; };
  }, [collection, editor, retry]);
  const remove = async (song: SongResult) => {
    if (!controller.current || locked.current || error || !window.confirm(t('mobile.onlinePlaylistConfirm', { song: song.name, playlist: collection.name }))) return;
    locked.current = true; setBusy(true);
    // Removing a song shifts every later offset. Ignore old pages and reread from the start after confirmation.
    const current = resource.current; current?.pause();
    const result = await controller.current.removeEntry({ track: song, entryKey: formatEntryKey(getPlaybackSongKey(song), 0) });
    locked.current = false;
    if (active.current && current === resource.current) {
      setBusy(false); if (!result.ok) setError(true); else current?.reload();
    }
  };
  return <dialog ref={dialog} className="sheet online-catalog-sheet" aria-label={t('mobile.onlinePlaylistManage')}
    onCancel={event => { if (event.target === event.currentTarget) close(); }} onClose={event => { if (event.target === event.currentTarget) close(); }}>
    <header><h2>{collection.name}</h2><button onClick={close}>{t('mobile.close')}</button></header>
    {queueError && <p role="alert">{t('mobile.' + queueError)}</p>}
    {(!state && !error || state?.status === 'loading' || busy) && <p role="status">{t('mobile.loading')}</p>}
    {(error || state?.status === 'error' || state?.sync.status === 'interrupted') && <p role="alert">{t('mobile.onlinePlaylistError')}
      <button disabled={busy} onClick={() => setRetry(value => value + 1)}>{t('mobile.onlinePlaylistReload')}</button></p>}
    {state?.status === 'ready' && <div className="online-catalog-pane">
      {state.tracks.length ? <SongList songs={state.tracks} play={index => play(state.tracks, index)} add={add} busy={busy || queueBusy || error}
        libraryActions={(song, dismiss) => <button disabled={busy || error} onClick={() => { dismiss(); void remove(song); }}>{t('mobile.removeFromPlaylist')}</button>} />
        : <p>{t('mobile.empty')}</p>}
      {!error && state.sync.status === 'syncing' && <p role="status">{t('mobile.loading')}</p>}
    </div>}
  </dialog>;
}
