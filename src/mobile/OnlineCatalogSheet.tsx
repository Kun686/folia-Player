import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { QueueAddBehavior, SongResult } from '../types';
import type { OnlineGridViewCollectionDescriptor } from '../library/core/contracts/collection';
import { collectionKey } from '../library/core/model/collectionIdentity';
import { captureProviderSession } from './runtime';
import { resolveOnlineCatalog, type OnlineCatalogTarget } from './onlineCatalog';
import OnlineCatalogActions from './OnlineCatalogActions';
import OnlineCatalogContent from './OnlineCatalogContent';
import type { MobilePlaylistEditor } from './mobilePlaylistEditor';
import OnlineCollectionSubscription from './OnlineCollectionSubscription';

// OnlineCatalogSheet.tsx — scoped navigation; dismissing or replacing a target rejects late resolution.
export default function OnlineCatalogSheet({ target, play, add, busy, close, error: queueError, songActions, editor, subscriptionProviders }: {
  target: OnlineCatalogTarget; play(songs: SongResult[], index: number): void;
  add(song: SongResult, behavior?: QueueAddBehavior): void; busy: boolean; close(): void;
  error: string; songActions(song: SongResult): ReactNode;
  editor: MobilePlaylistEditor; subscriptionProviders: string[];
}) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null);
  const [stack, setStack] = useState<OnlineCatalogTarget[]>([target]);
  const [result, setResult] = useState<{ target: OnlineCatalogTarget; collection: OnlineGridViewCollectionDescriptor | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const current = stack[stack.length - 1];
  const resolved = result?.target === current ? result.collection : null;
  const error = result?.target === current && !result.collection;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { setStack([target]); }, [target]);
  useEffect(() => {
    let active = true;
    setResult(null);
    const provider = 'collection' in current ? current.collection.providerId
      : current.song.sourceRef?.kind === 'online' ? current.song.sourceRef.providerId : '';
    const sameSession = captureProviderSession(provider);
    void resolveOnlineCatalog(current).then(value => {
      if (!active) return;
      setResult({ target: current, collection: sameSession() ? value : null });
    }).catch(() => { if (active) setResult({ target: current, collection: null }); });
    return () => { active = false; };
  }, [current, retry]);
  const open = (next: OnlineCatalogTarget) => setStack(previous => [...previous, next]);
  return <dialog ref={dialog} className="sheet online-catalog-sheet" aria-label={t('mobile.catalogTitle')}
    onCancel={event => { if (event.target === event.currentTarget) close(); }}
    onClose={event => { if (event.target === event.currentTarget) close(); }}>
    <header><h2>{'collection' in current ? current.collection.name : current.entity.name}</h2>
      {stack.length > 1 && <button disabled={busy} onClick={() => setStack(previous => previous.slice(0, -1))}>{t('mobile.catalogBack')}</button>}
      <button onClick={close}>{t('mobile.close')}</button></header>
    {queueError && <p role="alert">{t('mobile.' + queueError)}</p>}
    {resolved && <OnlineCollectionSubscription key={'subscription:' + collectionKey(resolved)} collection={resolved} editor={editor}
      writable={subscriptionProviders.includes(resolved.providerId)} />}
    {error ? <p role="alert">{t('mobile.error')} <button onClick={() => setRetry(value => value + 1)}>{t('mobile.retry')}</button></p>
      : resolved ? <OnlineCatalogContent key={collectionKey(resolved)} collection={resolved} play={play} add={add} busy={busy}
          open={collection => open({ collection })}
          actions={(song, dismiss) => <>{songActions(song)}<OnlineCatalogActions song={song} enabled
            open={next => { dismiss(); open(next); }} /></>} /> : <p role="status">{t('mobile.loading')}</p>}
  </dialog>;
}
