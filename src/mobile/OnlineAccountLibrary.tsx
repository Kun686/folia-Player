import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { List, type RowComponentProps } from 'react-window';
import type { ProviderCollection, ProviderUser } from '../types/onlineMusic';
import { omni } from '../services/onlineMusic/omni';
import { captureProviderSession } from './runtime';
import { createMobileAccountLibrary, type AccountLibraryKind } from './mobileAccountLibrary';

// OnlineAccountLibrary.tsx — touch entries for original favorite albums and the NetEase cloud drive.
interface Props {
  provider: string; user: ProviderUser | null; albumsEnabled: boolean; cloudEnabled: boolean; recommendationsEnabled: boolean;
  open(collection: ProviderCollection): void;
}
function CollectionRow({ index, style, collections, open }: RowComponentProps<{
  collections: ProviderCollection[]; open(collection: ProviderCollection): void;
}>) {
  const { t } = useTranslation(), collection = collections[index];
  return <div style={style} className="song-row"><button className="song-main"
    aria-label={collection.type === 'cloud' ? t('mobile.accountCloud') : t(collection.type === 'playlist' ? 'mobile.catalogPlaylist' : 'mobile.catalogAlbum', { name: collection.name })}
    onClick={() => open(collection)}><span><strong>{collection.type === 'cloud' ? t('mobile.accountCloud') : collection.name}</strong>
      <small>{collection.type === 'playlist' ? collection.description : collection.artists?.map(artist => artist.name).join(' / ')}</small></span></button></div>;
}
function AccountLibrarySheet({ provider, user, kind, open, close }: Props & { user: ProviderUser; kind: AccountLibraryKind; close(): void }) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null);
  const resource = useMemo(() => createMobileAccountLibrary(provider, user, kind, omni, captureProviderSession(provider)), [provider, user, kind]);
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    resource.setOwner({ providerId: provider, userId: user.id }); void resource.ensure();
    return () => resource.setOwner(null);
  }, [resource, provider, user.id]);
  const title = t(kind === 'albums' ? 'mobile.accountAlbums' : kind === 'recommendations' ? 'mobile.recommendedPlaylists' : 'mobile.accountCloud');
  return <dialog ref={dialog} className="sheet online-catalog-sheet" aria-label={title}
    onCancel={event => { if (event.target === event.currentTarget) close(); }}
    onClose={event => { if (event.target === event.currentTarget) close(); }}>
    <header><h2>{title}</h2><button onClick={close}>{t('mobile.close')}</button></header>
    <button disabled={state.status === 'loading' || !state.owner} onClick={() => void resource.reload()}>{t('mobile.accountLibraryReload')}</button>
    {state.status === 'loading' && <p role="status">{t('mobile.loading')}</p>}
    {(state.status === 'error' || !state.owner) && <p role="alert">{t('mobile.error')}</p>}
    {state.status === 'ready' && !state.data.length && <p>{t('mobile.empty')}</p>}
    {!!state.data.length && <div className="online-catalog-pane"><List className="song-list" rowComponent={CollectionRow}
      rowCount={state.data.length} rowHeight={72} rowProps={{ collections: state.data, open: collection => { close(); open(collection); } }} overscanCount={4} /></div>}
  </dialog>;
}
export default function OnlineAccountLibrary(props: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AccountLibraryKind | null>(null);
  if (!['netease', 'qq'].includes(props.provider)) return null;
  return <div className="account-library">
    <div className="collection-actions">
      <button disabled={!props.user || !props.albumsEnabled} onClick={() => setKind('albums')}>{t('mobile.accountAlbums')}</button>
      {props.provider === 'netease' && <button disabled={!props.user || !props.cloudEnabled} onClick={() => setKind('cloud')}>{t('mobile.accountCloud')}</button>}
      {props.provider === 'netease' && <button disabled={!props.user || !props.recommendationsEnabled} onClick={() => setKind('recommendations')}>{t('mobile.recommendedPlaylists')}</button>}
    </div>
    {!props.albumsEnabled && <p className="muted">{t('mobile.accountLibraryUnavailable')}</p>}
    {props.provider === 'netease' && !props.recommendationsEnabled && <p className="muted">{t('mobile.recommendationsUnavailable')}</p>}
    {props.user && kind && <AccountLibrarySheet {...props} user={props.user} kind={kind} close={() => setKind(null)} />}
  </div>;
}
