import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { List, type RowComponentProps } from 'react-window';
import type { ReactNode } from 'react';
import type { QueueAddBehavior, SongResult } from '../types';
import type { OnlineGridViewCollectionDescriptor } from '../library/core/contracts/collection';
import type { LibraryArtistResource, LibraryArtistSnapshot } from '../library/core/contracts/artist';
import type { CollectionResource, CollectionResourceSnapshot } from '../library/core/contracts/resource';
import { createArtistResource } from '../library/core/services/artistResource';
import { createArtistResourceDeps } from '../library/core/services/artistResourceDeps';
import { createCollectionResource } from '../library/core/services/createCollectionResource';
import { collectionKey } from '../library/core/model/collectionIdentity';
import SongList from './SongList';
import CollectionQueueActions, { type EnqueueCollection } from './CollectionQueueActions';

// OnlineCatalogContent.tsx — original Library Core resources, presented through mobile virtual lists.
export interface OnlineCatalogContentProps {
  collection: OnlineGridViewCollectionDescriptor;
  play(songs: SongResult[], index: number): void;
  add(song: SongResult, behavior?: QueueAddBehavior): void;
  actions(song: SongResult, close: () => void): ReactNode;
  open(collection: OnlineGridViewCollectionDescriptor): void;
  busy: boolean;
  enqueue: EnqueueCollection;
}
function Tracks({ songs, ...props }: OnlineCatalogContentProps & { songs: SongResult[] }) {
  const { t } = useTranslation();
  return songs.length ? <><CollectionQueueActions songs={songs} busy={props.busy} enqueue={props.enqueue} />
    <SongList songs={songs} play={index => props.play(songs, index)} add={props.add}
    busy={props.busy} libraryActions={props.actions} /></> : <p>{t('mobile.empty')}</p>;
}
function AlbumsRow({ index, style, albums, open, providerId }: RowComponentProps<{
  albums: LibraryArtistSnapshot['albums']; open: OnlineCatalogContentProps['open']; providerId: string;
}>) {
  const { t } = useTranslation();
  const album = albums[index];
  return <div style={style} className="song-row"><button className="song-main"
    aria-label={t('mobile.catalogAlbum', { name: album.name })}
    onClick={() => open({ ...album, source: 'online', providerId, type: 'album' })}>
    <span><strong>{album.name}</strong></span></button></div>;
}
function ArtistContent(props: OnlineCatalogContentProps) {
  const { t } = useTranslation(), { collection } = props;
  const resource = useRef<LibraryArtistResource | null>(null);
  const [state, setState] = useState<LibraryArtistSnapshot | null>(null);
  const [tab, setTab] = useState<'songs' | 'albums'>('songs');
  useEffect(() => {
    const current = createArtistResource(collectionKey(collection), collection, {
      ...createArtistResourceDeps(t), reportError: () => console.warn('[MobileCatalog] Artist request failed'),
    });
    resource.current = current;
    const unsubscribe = current.subscribe(() => setState(current.getSnapshot()));
    current.ensure(collection); setState(current.getSnapshot());
    return () => { unsubscribe(); current.dispose(); resource.current = null; };
  }, [collection, t]);
  return <div className="online-catalog-pane">
    <nav className="local-sections" aria-label={t('mobile.catalogSections')}>
      <button aria-pressed={tab === 'songs'} onClick={() => setTab('songs')}>{t('mobile.catalogTopSongs')}</button>
      <button aria-pressed={tab === 'albums'} onClick={() => setTab('albums')}>{t('localMusic.albums')}</button>
    </nav>
    {(!state || state.status === 'loading') && <p role="status">{t('mobile.loading')}</p>}
    {state?.status === 'error' && <p role="alert">{t('mobile.error')} <button onClick={() => resource.current?.reload()}>{t('mobile.retry')}</button></p>}
    {state?.status === 'ready' && (tab === 'songs' ? <Tracks {...props} songs={state.topSongs} />
      : <><List className="song-list" rowComponent={AlbumsRow} rowCount={state.albums.length} rowHeight={72}
          rowProps={{ albums: state.albums, open: props.open, providerId: collection.providerId }} overscanCount={4} />
        {!state.albums.length && state.albumSync.state === 'none' && <p>{t('mobile.empty')}</p>}
        {state.albumSync.state === 'syncing' && <p role="status">{t('mobile.loading')}</p>}
        {state.albumSync.state === 'interrupted' && <p role="alert">{t('mobile.error')} <button onClick={() => resource.current?.retryAlbums()}>{t('mobile.retry')}</button></p>}
      </>)}
  </div>;
}
function AlbumContent(props: OnlineCatalogContentProps) {
  const { t } = useTranslation(), { collection } = props;
  const resource = useRef<CollectionResource | null>(null);
  const [state, setState] = useState<CollectionResourceSnapshot | null>(null);
  useEffect(() => {
    const current = createCollectionResource(collectionKey(collection), collection);
    resource.current = current;
    const unsubscribe = current.subscribe(() => setState(current.getSnapshot()));
    current.ensure(collection, {}); setState(current.getSnapshot());
    return () => { unsubscribe(); current.dispose(); resource.current = null; };
  }, [collection]);
  return <div className="online-catalog-pane">
    {(!state || state.status === 'loading' || state.sync.status === 'syncing') && <p role="status">{t('mobile.loading')}</p>}
    {(state?.status === 'error' || state?.sync.status === 'interrupted') && <p role="alert">{t('mobile.error')}
      <button onClick={() => state.status === 'error' ? resource.current?.reload() : resource.current?.resumeSync()}>{t('mobile.retry')}</button></p>}
    {state && state.status !== 'loading' && state.status !== 'error' && <Tracks {...props} songs={state.tracks} />}
  </div>;
}
export default function OnlineCatalogContent(props: OnlineCatalogContentProps) {
  return props.collection.type === 'artist' ? <ArtistContent {...props} /> : <AlbumContent {...props} />;
}
