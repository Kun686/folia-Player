import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings, Search, Music2, Play, Pause, PanelsTopLeft, ArrowRight, MoreHorizontal, ListMusic, ArrowLeft } from 'lucide-react';
import QueueActionsMenu from './QueueActionsMenu';
import { useTranslation } from 'react-i18next';
import '../i18n/config';
import { native, isNative } from './bridge';
import { captureProviderSession, flushSessions } from './runtime';
import { omni } from '../services/onlineMusic/omni';
import { createMobileSongLikes } from './mobileSongLikes';
import OnlineSongLike from './OnlineSongLike';
import OnlineCatalogActions from './OnlineCatalogActions';
import OnlineCatalogSheet from './OnlineCatalogSheet';
import OnlineCollectionSubscription from './OnlineCollectionSubscription';
import type { OnlineCatalogTarget } from './onlineCatalog';
import OnlinePlaylistPicker from './OnlinePlaylistPicker';
import OnlinePlaylistManager from './OnlinePlaylistManager';
import DailyRecommendations from './DailyRecommendations';
import PersonalFM from './PersonalFM';
import { createMobilePlaylistEditor } from './mobilePlaylistEditor';
import { removeFromCache } from '../services/db';
import type { ProviderCollection } from '../types/onlineMusic';
import { usePlayback } from './usePlayback';
import { useMobileTheme } from './useMobileTheme';
import { useCatalog } from './useCatalog';
import { mobileCollectionKey } from './catalogSession';
import { useProviders } from './useProviders';
import { useLocalCatalog } from './useLocalCatalog';
import { useLocalFolders } from './useLocalFolders';
import { localFolderView, type FolderScope } from './localFolderBrowser';
import { filterMobileLocalSongs } from './localLibraryGroups';
import LocalFolderTools from './LocalFolderTools';
import FolderImportStatus from './FolderImportStatus';
import LocalMetadataManager from './LocalMetadataManager';
import LocalTrackSortControls from './LocalTrackSortControls';
import { sortMobileLocalTracks } from './localTrackSorting';
import { useLocalTrackSortStore } from '../library/core/state/useLocalTrackSortStore';
import { formatLocalAlbumTrackLabel } from '../utils/localSongSorting';
import { useLocalBrowser } from './useLocalBrowser';
import { useLocalPlaylists } from './useLocalPlaylists';
import LocalPlaylistToolbar from './LocalPlaylistToolbar';
import LocalPlaylistDialog from './LocalPlaylistDialog';
import LocalPlaylistFileDialog from './LocalPlaylistFileDialog';
import LocalSongPlaylistActions from './LocalSongPlaylistActions';
import LocalEntityDialog from './LocalEntityDialog';
import LocalCollections, { LocalLibraryNav } from './LocalCollections';
import { useAppPreferences } from '../hooks/useAppPreferences';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useMediaCache } from './useMediaCache';
import SongList from './SongList';
import SongThumbnail from './SongThumbnail';
import QueueBrowser from './QueueBrowser';
import CollectionQueueActions from './CollectionQueueActions';
import NavidromeBrowser from './NavidromeBrowser';
import LoginSheet from './LoginSheet';
import SettingsSheet from './SettingsSheet';
import { useNativeSleepTimer } from './useNativeSleepTimer';
import PlayerPanel from './PlayerPanel';
import PlayerFeedback from './PlayerFeedback';
import CatalogTrackFeedback from './CatalogTrackFeedback';
import { usePlaybackCommands } from './usePlaybackCommands';
import type { QueueAddBehavior, SongResult } from '../types';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { captureMobileQueueSessions, flushMobileQueueSessions, enqueueMobileSongs, editMobileQueue, playMobileSearchSong, type QueueAction } from './queueActions';
import { initializeSyncCoordinator } from '../services/sync/syncCoordinator';
import OnlineAccountLibrary from './OnlineAccountLibrary';
import { useSheetViewport } from './useSheetViewport';
import { useLocalLyricPreference } from './LocalLyricPreference';
import { useMobileSongReplacement } from './useMobileSongReplacement';
import SongReplacementDialog from './SongReplacementDialog';
import { usePlaybackEntryViewStore } from '../stores/usePlaybackEntryViewStore';
import PlayerQueueSheet from './PlayerQueueSheet';
import OnlineCollections from './OnlineCollections';
import LibraryAccount from './LibraryAccount';
import { useNativeInterfaceStyle } from './useNativeInterfaceStyle';

// src/mobile/MobileApp.tsx — library and full-window player share the original native playback state.
export default function MobileApp({ initialServer }: { initialServer: string }) {
  useSheetViewport();
  const lyricPreference = useLocalLyricPreference();
  const { t } = useTranslation();
  const server = initialServer;
  const [provider, setProvider] = useState(initialServer ? 'netease' : 'local');
  const isNavidrome = provider === 'navidrome';
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(false);
  const [entityId, setEntityId] = useState<string>();
  const [onlineTarget, setOnlineTarget] = useState<OnlineCatalogTarget | null>(null);
  const [playlistSong, setPlaylistSong] = useState<SongResult | null>(null);
  const [managedPlaylist, setManagedPlaylist] = useState<ProviderCollection | null>(null);
  const [login, setLogin] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueView, setQueueView] = useState(false);
  const light = useThemeSettingsStore(s => s.isDaylight);
  useNativeInterfaceStyle(light);
  const setLight = useThemeSettingsStore(s => s.setDaylightPreference);
  useAppPreferences();
  useEffect(() => initializeSyncCoordinator(), []);
  const [error, setError] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [queueBusy, setQueueBusy] = useState(false);
  const queueLock = useRef(false);
  const available = useProviders(server);
  const providerEnabled = available.providers.includes(provider);
  useEffect(() => {
    const supported = available.providers[0];
    if (provider !== 'local' && provider !== 'cached' && provider !== 'navidrome' && supported && !providerEnabled) setProvider(supported);
  }, [available.providers, providerEnabled, provider]);
  const playback = usePlayback();
  const playbackCommands = usePlaybackCommands(playback.songEpoch);
  const appearance = useMobileTheme(playback.state.currentSong, playback.songEpoch, playback.captureSongGuard);
  const sleepTimer = useNativeSleepTimer();
  const catalog = useCatalog(isNavidrome ? '' : provider, !!server && isNative && providerEnabled);
  const checkingAccount = !catalog.accountChecked && (providerEnabled || Boolean(server && isNative && !available.error));
  const replacement = useMobileSongReplacement(available.replacementProviders);
  const cancelReplacement = replacement.cancel;
  useEffect(() => { cancelReplacement(); }, [cancelReplacement, provider, queueView, onlineTarget, managedPlaylist, catalog.collection, catalog.searchQuery]);
  const catalogRef = useRef(catalog); catalogRef.current = catalog;
  const likes = useMemo(() => createMobileSongLikes(omni, captureProviderSession, owner => {
    const current = catalogRef.current;
    if (current.provider === owner && current.collection?.type === 'playlist') {
      void current.refreshCollection(current.collection);
    }
  }), []);
  const playlistEditor = useMemo(() => createMobilePlaylistEditor(omni, captureProviderSession, flushSessions, removeFromCache,
    collection => { void catalogRef.current.refreshCollection(collection); },
    collection => { if (catalogRef.current.provider === collection.providerId) return catalogRef.current.refresh().then(() => undefined); }), []);
  const playlistAction = (song: SongResult) => song.sourceRef?.kind === 'online' && omni.canAddSongToPlaylist(song) &&
    <><button disabled={!available.playlistEditProviders.includes(song.sourceRef.providerId)}
      onClick={() => setPlaylistSong(song)}>{t('mobile.onlinePlaylistAdd')}</button>
      {!available.playlistEditProviders.includes(song.sourceRef.providerId) && <p className="muted">{t('mobile.onlinePlaylistUnavailable')}</p>}</>;
  const onlineActions = (song: SongResult, close: () => void) => <>
    {song.sourceRef?.kind === 'online' && <OnlineSongLike song={song} likes={likes} writable={available.songLikeProviders.includes(song.sourceRef.providerId)} />}
    <OnlineCatalogActions song={song} enabled={song.sourceRef?.kind === 'online' && available.catalogProviders.includes(song.sourceRef.providerId)}
      open={target => { close(); setOnlineTarget(target); }} />{playlistAction(song)}</>;
  const local = useLocalCatalog();
  const folders = useLocalFolders(), [folderScope, setFolderScope] = useState<FolderScope | null>(null);
  const folderView = useMemo(() => localFolderView(folders.catalog, local.songs, folderScope), [folders.catalog, local.songs, folderScope]);
  const localPlaylists = useLocalPlaylists(local.songs);
  const localBrowser = useLocalBrowser(local.songs, query, localPlaylists.lists, local.snapshot);
  const mediaCache = useMediaCache();
  const isCached = provider === 'cached';
  const isLocal = provider === 'local';
  const searchingOnline = !isLocal && !isCached && !isNavidrome && !queueView && catalog.searchQuery !== null;
  const browsingFolders = isLocal && localBrowser.section === 'folders';
  const sortField = useLocalTrackSortStore(s => s.field), sortDirection = useLocalTrackSortStore(s => s.direction);
  const sortable = isLocal && !queueView && (localBrowser.section === 'songs' || (browsingFolders && Boolean(folderView.root)));
  const listedSongs = useMemo(() => queueView ? playback.state.queue : browsingFolders ? filterMobileLocalSongs(folderView.songs, query) : isLocal ? localBrowser.songs : isCached ? (mediaCache.state?.songs ?? []).filter(song =>
    `${song.name} ${song.artists.map(a => a.name).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : catalog.songs,
  [queueView, playback.state.queue, browsingFolders, folderView.songs, isLocal, isCached, mediaCache.state?.songs, localBrowser.songs, query, catalog.songs]);
  const songs = useMemo(() => sortable ? sortMobileLocalTracks(listedSongs, local.snapshot?.editorSongs, sortField, sortDirection) : listedSongs,
    [sortable, listedSongs, local.snapshot?.editorSongs, sortField, sortDirection]);
  const trackLabels = useMemo(() => isLocal && !queueView && localBrowser.selected?.type === 'album'
    ? new Map(local.snapshot?.editorSongs.map(song => [song.id, formatLocalAlbumTrackLabel(song)])) : undefined,
  [isLocal, queueView, localBrowser.selected?.type, local.snapshot?.editorSongs]);
  const active = playback.state.currentSong;
  const loadMoreAction = !isLocal && !isCached && !isNavidrome && !queueView && catalog.more
    ? <button disabled={catalog.busy} onClick={() => void catalog.load()}>{t('mobile.more')}</button> : null;
  const queueWork = async (work: () => Promise<unknown>) => {
    if (queueLock.current) return false;
    queueLock.current = true; setQueueBusy(true); setQueueError('');
    try { await work(); return true; }
    catch (cause) { setQueueError(cause instanceof Error && cause.message === 'queue-changed' ? 'queueChanged'
      : cause instanceof Error && cause.message === 'queue-full' ? 'queueFull'
      : cause instanceof Error && cause.message === 'replacement-unsupported' ? 'replacementUnsupported'
      : cause instanceof Error && cause.message === 'song-unavailable' ? 'replacementUnavailable' : 'error'); return false; }
    finally { queueLock.current = false; setQueueBusy(false); }
  };
  const startCollection = async (tracks: SongResult[], index: number, started: () => void) => {
    const check = captureMobileQueueSessions(tracks);
    if (await replacement.offer(tracks, index, started)) return;
    check(); await flushMobileQueueSessions(tracks); check();
    await native.setQueue({ songs: tracks, index }); check(); started();
  };
  const play = async (index: number) => {
    const current = searchingOnline ? captureProviderSession(provider) : () => true;
    await queueWork(async () => {
      if (!songs[index]) throw new Error('queue-changed');
      if (queueView || searchingOnline) await flushMobileQueueSessions([songs[index]]);
      if (queueView) await native.selectQueue({ index, queueRevision: playback.state.queueRevision });
      else if (searchingOnline) await playMobileSearchSong(songs[index], current);
      else { await startCollection(songs, index, () => setExpanded(true)); return; }
      setExpanded(true);
    });
  };
  const enqueue = async (tracks: SongResult[], behavior: QueueAddBehavior = useAudioSettingsStore.getState().queueAddBehavior, current: () => void = () => {}) => {
    let count: number | undefined;
    await queueWork(async () => { count = await enqueueMobileSongs(tracks, behavior, current); });
    return count;
  };
  const add = (song: SongResult, behavior?: QueueAddBehavior) => enqueue([song], behavior);
  const edit = (action: QueueAction) => void queueWork(() => editMobileQueue(playback.state, action));
  const playQueueSong = (song: SongResult) => void queueWork(async () => {
    const index = playback.state.queue.indexOf(song);
    if (index < 0) throw new Error('queue-changed');
    const check = captureMobileQueueSessions([song]);
    check(); await flushMobileQueueSessions([song]); check();
    await native.selectQueue({ index, queueRevision: playback.state.queueRevision });
  });
  const songActions = (song: SongResult, close: () => void) => <>{onlineActions(song, close)}
    <LocalSongPlaylistActions song={song} controller={localPlaylists}
      selected={isLocal && !queueView ? localBrowser.selected : undefined} close={close} /></>;
  const collectionOverview = !catalog.collection && !searchingOnline;
  const collectionsNav = !isLocal && !isCached && !isNavidrome && !queueView && catalog.collections.length > 0
    ? <OnlineCollections collections={catalog.collections} selected={catalog.collection ?? null} overview={collectionOverview}
        select={collection => { setQuery(''); void catalog.load({ collection }); }} /> : null;
  return <main className={'mobile-app ' + (light ? 'daylight' : '')} data-layout="compact">
    <div className="library-panel" data-online={provider === 'qq' || provider === 'netease' ? 'true' : undefined} inert={expanded || settings}>
      <header className="brand"><h1>{t('mobile.library')}</h1><div className="library-header-actions">
        {catalog.user && !isCached && !isLocal && !isNavidrome && <LibraryAccount name={catalog.user.nickname} busy={catalog.busy}
          logout={() => void catalog.logout().catch(() => setError(true))} />}
        <button aria-label={t('home.latticeLabel')} onClick={() => { usePlaybackEntryViewStore.getState().setPlaybackEntryView('lattice'); setExpanded(true); }}><PanelsTopLeft /></button>
        <button aria-label={t('mobile.settings')} onClick={() => setSettings(true)}><Settings /></button></div></header>
      <nav className="providers" aria-label="Music platform">
        {[['qq', 'QQ 音乐'], ['netease', '网易云'], ['local', t('mobile.local')], ['navidrome', 'Navidrome'], ['cached', t('options.mediaCache')],
          ...(available.providers.includes('kugou') ? [['kugou', '酷狗']] : [])].map(([id, name]) =>
          <button key={id} disabled={catalog.loggingOut} aria-pressed={provider === id} onClick={() => { setProvider(id); setQueueView(false); setQuery(''); }}>{name}</button>)}
      </nav>
      {isNavidrome && !queueView ? <NavidromeBrowser busy={queueBusy} queueError={queueError} queueCount={playback.state.queue.length}
        showQueue={() => setQueueView(true)}
        play={(tracks, index, current, search) => queueWork(async () => { current();
          if (search) await playMobileSearchSong(tracks[index], () => { current(); return true; });
          else await native.setQueue({ songs: tracks, index }); setExpanded(true); })}
        add={(song, behavior, current) => enqueue([song], behavior, current)} enqueue={(tracks, current) => enqueue(tracks, undefined, current)} /> : <>
      {!isNavidrome && <>
      {isCached ? <div className="account-row"><span>{mediaCache.state?.count ?? 0} {t('mobile.tracks')}</span></div> : isLocal ? <div className="account-row"><span>{local.songs.length} {t('mobile.tracks')}</span>
        <button disabled={local.busy || folders.busy || !isNative} onClick={() => void local.importAudio()}>{t('mobile.importAudio')}</button></div> :
      !catalog.user && <div className="account-row"><span>{provider === 'qq' ? 'QQ 音乐' : provider === 'kugou' ? '酷狗' : '网易云'}</span>
        {checkingAccount && !catalog.loggingOut ? <button disabled={!providerEnabled || !catalog.accountError || catalog.accountBusy}
            onClick={() => void catalog.refresh()}>{t(catalog.accountError ? 'mobile.retry' : 'mobile.loading')}</button>
          : <button disabled={!providerEnabled || catalog.loggingOut} onClick={() => setLogin(true)}>{t('mobile.login')}</button>}</div>}
      {!isLocal && !isCached && !isNavidrome && !providerEnabled && <p className="connection-hint">
        {available.error || available.busy
          ? <button disabled={available.busy} onClick={() => available.retry()}>{t(available.busy ? 'mobile.loading' : 'mobile.retry')}</button>
          : t('mobile.connect')} <button onClick={() => setSettings(true)}>{t('mobile.settings')}</button></p>}
      {!queueView && <div className="library-search-tools"><form className="search" onSubmit={e => { e.preventDefault(); setQueueView(false); if (!isLocal && !isCached && !isNavidrome && query.trim()) void catalog.load({ query: query.trim() }); }}>
        <Search size={20} /><input aria-label={t('mobile.search')} placeholder={t('mobile.search')} value={query} onChange={e => setQuery(e.target.value)} />
        <button aria-label={t('mobile.search')} title={t('mobile.search')} disabled={(!isLocal && !isCached && !isNavidrome && !providerEnabled) || catalog.busy || !query.trim()}><ArrowRight size={20} /></button>
      </form>
      {!queueView && ['qq', 'netease'].includes(provider) && <details key={provider} className="online-library-extras">
      <summary aria-label={t('mobile.moreMusicFeatures')} title={t('mobile.moreMusicFeatures')}><MoreHorizontal size={22} /></summary>
      <div className="online-library-extras-body">
      <PersonalFM provider={queueView ? '' : provider} enabled={available.personalFmProviders.includes(provider)} signedIn={!!catalog.user}
        state={playback.state} busy={queueBusy} work={queueWork} playing={() => setExpanded(true)} />
      {!queueView && <OnlineAccountLibrary key={provider + ':' + String(catalog.user?.id)} provider={provider} user={catalog.user}
        albumsEnabled={available.userAlbumProviders.includes(provider)} cloudEnabled={available.cloudProviders.includes(provider)}
        recommendationsEnabled={available.recommendedCollectionProviders.includes(provider)}
        open={collection => {
          if (collection.type === 'cloud') { setQuery(''); void catalog.load({ collection }); }
          else setOnlineTarget({ collection: { ...collection, source: 'online' } });
        }} />}
      <DailyRecommendations provider={queueView ? '' : provider} enabled={available.dailyProviders.includes(provider)} signedIn={!!catalog.user}
        navigationChanged={cancelReplacement}
        queueBusy={queueBusy} queueError={queueError} add={(song, behavior) => void add(song, behavior)} enqueue={enqueue} actions={onlineActions}
        play={(tracks, index, close) => void queueWork(() => startCollection(tracks, index, () => { close(); setExpanded(true); }))} />
      </div></details>}
      </div>}
      </>}
      {isLocal && !queueView && <LocalLibraryNav browser={localBrowser} clearQuery={() => setQuery('')} />}
      {sortable && <LocalTrackSortControls />}
      {isLocal && !queueView && <FolderImportStatus folders={folders} />}
      {isLocal && !queueView && local.snapshot && (localBrowser.section === 'songs' || (browsingFolders && folderView.root)) &&
        <LocalMetadataManager key={browsingFolders ? folderView.root?.id + '/' + folderView.path : 'all'} snapshot={local.snapshot}
          ids={(browsingFolders ? folderView.songs : local.songs).map(song => String(song.id))}
          label={browsingFolders ? folderView.path || folderView.root!.name : t('mobile.local')}
          providers={available.providers} light={light} changed={local.refresh} />}
      {browsingFolders && !queueView && <LocalFolderTools folders={folders} view={folderView} query={query}
        select={scope => { setFolderScope(scope); setQuery(''); }} />}
      {isLocal && !queueView && localBrowser.selected?.entityId && <button className="local-entity-edit"
        disabled={local.busy} onClick={() => setEntityId(localBrowser.selected?.entityId)}>
        {t('localMusic.editEntityTitle', { kind: t(localBrowser.selected.type === 'artist' ? 'localMusic.artistLabel' : 'localMusic.albumLabel') })}</button>}
      {isLocal && !queueView && (localBrowser.section === 'playlists' || localPlaylists.error) &&
        <LocalPlaylistToolbar controller={localPlaylists} selected={localBrowser.selected} />}
      <div className="section-heading library-section-heading">
        {!queueView && !collectionOverview && !isLocal && !isCached && !isNavidrome && <button className="library-collection-back"
          aria-label={t('mobile.backToPlaylists')} title={t('mobile.backToPlaylists')}
          onClick={() => { setQuery(''); catalog.browseCollections(); }}><ArrowLeft size={22} /></button>}
        <div className="library-section-title"><h2>{queueView ? t('mobile.queue') : searchingOnline ? t('home.resultsFor') + ' ' + catalog.searchQuery
        : catalog.collection && !isLocal && !isCached ? catalog.collection.name
        : t(isCached ? 'options.mediaCache' : isLocal ? 'mobile.local' : 'mobile.playlists')}</h2>
        {songs.length > 0 && <small>{songs.length} {t('mobile.tracks')}</small>}</div>
        {!queueView && !isLocal && !isCached && !isNavidrome && catalog.collection && songs.length > 0 &&
          <CollectionQueueActions compact showCount={false} songs={songs} busy={queueBusy || catalog.busy} enqueue={enqueue} />}
        {queueView && <QueueActionsMenu busy={queueBusy} count={songs.length} edit={edit}
          savePlaylist={songs.some(song => song.sourceRef?.kind === 'local') ? () => localPlaylists.create(songs) : undefined}
          saveDisabled={!localPlaylists.ready || localPlaylists.busy} />}
        <button className="library-queue-toggle" aria-label={t(queueView ? 'mobile.library' : 'mobile.queue')}
          title={t(queueView ? 'mobile.library' : 'mobile.queue')} aria-pressed={queueView} onClick={() => setQueueView(!queueView)}>
          {queueView ? <ArrowLeft size={22} /> : <><ListMusic size={22} /><small>{t('mobile.queue')}</small></>}</button></div>
      {collectionOverview && collectionsNav}
      {!isLocal && !isCached && !isNavidrome && !queueView && <div className="collection-actions">
        {catalog.collection && catalog.user && <OnlineCollectionSubscription
          key={mobileCollectionKey(catalog.collection) + ':' + String(catalog.user.id)} collection={catalog.collection}
          user={catalog.user} editor={playlistEditor} writable={available.subscriptionProviders.includes(provider)} />}
        {catalog.collection && catalog.user && available.playlistEditProviders.includes(provider) && playlistEditor.canEdit(catalog.collection, catalog.user) &&
          <button onClick={() => setManagedPlaylist(catalog.collection)}>{t('mobile.onlinePlaylistManage')}</button>}
        {catalog.collectionsMore && <button disabled={catalog.accountBusy} onClick={() => void catalog.loadCollections()}>{t('mobile.morePlaylists')}</button>}
        {catalog.accountError && (catalog.accountChecked || catalog.user) && <button disabled={catalog.accountBusy} onClick={() => void catalog.refresh()}>{t('mobile.retryPlaylists')}</button>}
        {catalog.trackError && <button disabled={catalog.busy} onClick={() => void catalog.load()}>{t('mobile.retrySongs')}</button>}
        {catalog.logoutError && <button disabled={catalog.loggingOut} onClick={() => void catalog.logout()}>{t('mobile.retry')} · {t('mobile.logout')}</button>}
      </div>}
      {((!isLocal && !isCached && !isNavidrome && (catalog.accountError || catalog.logoutError || available.error)) || error) && <p role="alert">{t('mobile.error')}</p>}
      {!isLocal && !isCached && !isNavidrome && !queueView && <CatalogTrackFeedback error={catalog.trackError} code={catalog.trackErrorCode} />}
      {!expanded && <PlayerFeedback state={playback.state} commandError={playbackCommands.error} otherError={false} className="library-playback-error" />}
      {isCached && mediaCache.error && <p role="alert">{t('mobile.cacheError')}</p>}
      {queueError && <p role="alert">{t('mobile.' + queueError)}</p>}
      {isLocal && local.error && <p role="alert">{t('mobile.importError')} {local.error}</p>}
      {(catalog.busy || catalog.accountBusy || local.busy) && <p role="status">{t('mobile.loading')}</p>}
      {!queueView && songs.length > 0 && isLocal && !localBrowser.browsing &&
        <CollectionQueueActions songs={songs} busy={queueBusy || localPlaylists.busy || (isLocal ? local.busy : catalog.busy)} enqueue={enqueue} />}
      {searchingOnline && songs.length > 0 && <div className="collection-queue-actions"><div className="collection-actions">
        <span>{t('libraryTui.scope', { count: songs.length })}</span>
      </div></div>}
      {isLocal && !queueView && localBrowser.browsing ? <LocalCollections collections={localBrowser.collections}
        select={id => { localBrowser.select(id); setQuery(''); }} /> : queueView ? <QueueBrowser state={playback.state}
        busy={queueBusy || localPlaylists.busy} play={index => void play(index)} add={(song, behavior) => void add(song, behavior)} edit={edit} libraryActions={songActions} />
        : songs.length ? <SongList songs={songs} play={index => void play(index)} add={(song, behavior) => void add(song, behavior)}
        trackLabels={trackLabels}
        respectAvailability={searchingOnline}
        busy={queueBusy || localPlaylists.busy}
        libraryActions={songActions}
        remove={isLocal && !queueView ? song => { if (window.confirm(t('mobile.confirmRemove', { name: song.name }))) void local.remove(song); } : undefined} />
        : (collectionOverview && collectionsNav) || (browsingFolders && !queueView && !folderView.root) || (!isLocal && !isCached && !isNavidrome && !queueView && (catalog.busy || catalog.trackError))
          ? null : <div className="empty"><Music2 size={44} /><p>{t(queueView ? 'mobile.queueEmpty' : searchingOnline ? 'mobile.empty'
            : isLocal ? (local.songs.length ? 'mobile.empty' : 'mobile.localEmpty') : 'mobile.noSongs')}</p></div>}
      {loadMoreAction && <div className="library-pagination">{loadMoreAction}</div>}
      </>}
    </div>
    <PlayerPanel appearance={appearance} state={playback.state} time={playback.currentTime} visible={playback.visible} light={light} songEpoch={playback.songEpoch}
      queueBusy={queueBusy} queueError={queueError} playQueueSong={playQueueSong} shuffleQueue={() => edit({ type: 'shuffle' })}
      commands={playbackCommands}
      likes={likes} songLikeProviders={available.songLikeProviders}
      captureSongGuard={playback.captureSongGuard}
      expanded={expanded} queueOpen={queueOpen} collapse={() => { setQueueOpen(false); setExpanded(false); }} openQueue={() => setQueueOpen(true)} />
    {queueOpen && <PlayerQueueSheet state={playback.state} busy={queueBusy || localPlaylists.busy} error={queueError}
      close={() => setQueueOpen(false)} play={index => { const song = playback.state.queue[index]; if (song) playQueueSong(song); }}
      add={(song, behavior) => void add(song, behavior)} edit={edit} libraryActions={songActions} />}
    <footer className="mini-player" inert={expanded || settings}>
      <button className="mini-title" onClick={() => setExpanded(true)}><SongThumbnail song={active} /><span><strong>{active?.name ?? t('mobile.idlePlayer')}</strong>
        <small>{active?.artists.map(a => a.name).join(' / ') ?? t('mobile.chooseSong')}</small></span></button>
      <button disabled={!active && !playback.state.queue.length} aria-label={t(playback.state.playing ? 'mobile.pause' : 'mobile.play')}
        onClick={() => playbackCommands.send({ action: playback.state.playing ? 'pause' : 'play' })}>
        {playback.state.playing ? <Pause /> : <Play />}</button>
    </footer>
    {settings && <SettingsSheet folders={folders} lyricPreference={lyricPreference} appearance={appearance} mediaCache={mediaCache} timer={sleepTimer} server={server} light={light} setLight={setLight}
      openCache={() => { setProvider('cached'); setQueueView(false); setQuery(''); setSettings(false); }}
      saved={() => location.reload()} close={() => setSettings(false)} />}
    {login && <LoginSheet provider={provider} refresh={catalog.refresh} close={() => setLogin(false)} />}
    {onlineTarget && <OnlineCatalogSheet target={onlineTarget} busy={queueBusy} error={queueError} close={() => setOnlineTarget(null)} enqueue={enqueue}
      navigationChanged={cancelReplacement}
      editor={playlistEditor} subscriptionProviders={available.subscriptionProviders}
      play={(tracks, index) => void queueWork(() => startCollection(tracks, index, () => { setOnlineTarget(null); setExpanded(true); }))}
      add={(song, behavior) => void add(song, behavior)}
      songActions={song => <>{song.sourceRef?.kind === 'online' && <OnlineSongLike song={song} likes={likes}
        writable={available.songLikeProviders.includes(song.sourceRef.providerId)} />}{playlistAction(song)}</>} />}
    {playlistSong && <OnlinePlaylistPicker song={playlistSong} editor={playlistEditor} close={() => setPlaylistSong(null)} />}
    {managedPlaylist && <OnlinePlaylistManager collection={managedPlaylist} editor={playlistEditor} close={() => setManagedPlaylist(null)}
      queueBusy={queueBusy} queueError={queueError}
      play={(tracks, index) => void queueWork(() => startCollection(tracks, index, () => { setManagedPlaylist(null); setExpanded(true); }))}
      add={(song, behavior) => void add(song, behavior)} />}
    {entityId && local.snapshot && <LocalEntityDialog snapshot={local.snapshot} id={entityId} light={light}
      close={() => setEntityId(undefined)} selected={id => { localBrowser.select(id); void local.refresh(); }} />}
    {localPlaylists.request && <LocalPlaylistDialog controller={localPlaylists} request={localPlaylists.request} />}
    {localPlaylists.fileRequest && <LocalPlaylistFileDialog controller={localPlaylists} request={localPlaylists.fileRequest} songs={local.songs} />}
    {replacement.pending && <SongReplacementDialog request={replacement.pending} light={light} close={replacement.cancel}
      confirm={async () => { await queueWork(replacement.confirm); }} />}
  </main>;
}
