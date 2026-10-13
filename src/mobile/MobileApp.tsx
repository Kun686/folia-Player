import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings, Search, Music2, Play, Pause } from 'lucide-react';
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
import LoginSheet from './LoginSheet';
import SettingsSheet from './SettingsSheet';
import { useNativeSleepTimer } from './useNativeSleepTimer';
import PlayerPanel from './PlayerPanel';
import type { QueueAddBehavior, SongResult } from '../types';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { addMobileSongs, editMobileQueue, playMobileSearchSong, type QueueAction } from './queueActions';
import { initializeSyncCoordinator } from '../services/sync/syncCoordinator';
import OnlineAccountLibrary from './OnlineAccountLibrary';
import { useSheetViewport } from './useSheetViewport';
import { useLocalLyricPreference } from './LocalLyricPreference';

// src/mobile/MobileApp.tsx — library and full-window player share the original native playback state.
export default function MobileApp({ initialServer }: { initialServer: string }) {
  useSheetViewport();
  const lyricPreference = useLocalLyricPreference();
  const { t } = useTranslation();
  const server = initialServer;
  const [provider, setProvider] = useState(initialServer ? 'netease' : 'local');
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(false);
  const [entityId, setEntityId] = useState<string>();
  const [onlineTarget, setOnlineTarget] = useState<OnlineCatalogTarget | null>(null);
  const [playlistSong, setPlaylistSong] = useState<SongResult | null>(null);
  const [managedPlaylist, setManagedPlaylist] = useState<ProviderCollection | null>(null);
  const [login, setLogin] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [queueView, setQueueView] = useState(false);
  const light = useThemeSettingsStore(s => s.isDaylight);
  const setLight = useThemeSettingsStore(s => s.setDaylightPreference);
  useAppPreferences();
  useEffect(() => initializeSyncCoordinator(), []);
  const [error, setError] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [queueBusy, setQueueBusy] = useState(false);
  const queueLock = useRef(false);
  const available = useProviders(server);
  const likes = useMemo(() => createMobileSongLikes(omni, captureProviderSession), []);
  const providerEnabled = available.providers.includes(provider);
  useEffect(() => {
    if (provider !== 'local' && provider !== 'cached' && available.providers.length && !providerEnabled) setProvider(available.providers[0]);
  }, [available.providers, providerEnabled, provider]);
  const playback = usePlayback();
  const appearance = useMobileTheme(playback.state.currentSong, playback.songEpoch, playback.captureSongGuard);
  const sleepTimer = useNativeSleepTimer();
  const catalog = useCatalog(provider, !!server && isNative && providerEnabled);
  const catalogRef = useRef(catalog); catalogRef.current = catalog;
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
  const searchingOnline = !isLocal && !isCached && !queueView && catalog.searchQuery !== null;
  const browsingFolders = isLocal && localBrowser.section === 'folders';
  const songs = useMemo(() => queueView ? playback.state.queue : browsingFolders ? filterMobileLocalSongs(folderView.songs, query) : isLocal ? localBrowser.songs : isCached ? (mediaCache.state?.songs ?? []).filter(song =>
    `${song.name} ${song.artists.map(a => a.name).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : catalog.songs,
  [queueView, playback.state.queue, browsingFolders, folderView.songs, isLocal, isCached, mediaCache.state?.songs, localBrowser.songs, query, catalog.songs]);
  const active = playback.state.currentSong;
  const queueWork = async (work: () => Promise<unknown>) => {
    if (queueLock.current) return false;
    queueLock.current = true; setQueueBusy(true); setQueueError('');
    try { await work(); return true; }
    catch (cause) { setQueueError(cause instanceof Error && cause.message === 'queue-changed' ? 'queueChanged'
      : cause instanceof Error && cause.message === 'queue-full' ? 'queueFull' : 'error'); return false; }
    finally { queueLock.current = false; setQueueBusy(false); }
  };
  const play = async (index: number) => {
    const current = searchingOnline ? captureProviderSession(provider) : () => true;
    await queueWork(async () => {
      if (songs.some(song => song.sourceRef?.kind === 'online')) await flushSessions();
      if (queueView) await native.selectQueue({ index, queueRevision: playback.state.queueRevision });
      else if (searchingOnline) await playMobileSearchSong(songs[index], current);
      else await native.setQueue({ songs, index });
      setExpanded(true);
    });
  };
  const add = (song: SongResult, behavior: QueueAddBehavior = useAudioSettingsStore.getState().queueAddBehavior) => queueWork(async () => {
    if (song.sourceRef?.kind === 'online') await flushSessions();
    await addMobileSongs([song], behavior);
  });
  const edit = (action: QueueAction) => void queueWork(() => editMobileQueue(playback.state, action));
  return <main className={'mobile-app ' + (light ? 'daylight' : '')} data-layout="compact">
    <div className="library-panel" inert={expanded}>
      <header className="brand"><div><small>FOLIA</small><h1>{t('mobile.library')}</h1></div>
        <button aria-label={t('mobile.settings')} onClick={() => setSettings(true)}><Settings /></button></header>
      <nav className="providers" aria-label="Music platform">
        {[['local', t('mobile.local')], ['cached', t('options.mediaCache')], ['netease', '网易云'], ['qq', 'QQ 音乐'], ['kugou', '酷狗']].filter(([id]) => id !== 'kugou' || available.providers.includes(id)).map(([id, name]) =>
          <button key={id} disabled={catalog.loggingOut} aria-pressed={provider === id} onClick={() => { setProvider(id); setQueueView(false); setQuery(''); }}>{name}</button>)}
      </nav>
      {isCached ? <div className="account-row"><span>{mediaCache.state?.count ?? 0} {t('mobile.tracks')}</span></div> : isLocal ? <div className="account-row"><span>{local.songs.length} {t('mobile.tracks')}</span>
        <button disabled={local.busy || folders.busy || !isNative} onClick={() => void local.importAudio()}>{t('mobile.importAudio')}</button></div> :
      <div className="account-row"><span>{catalog.user?.nickname ?? provider.toUpperCase()}</span>
        {catalog.user ? <button disabled={catalog.busy} onClick={() => void catalog.logout().catch(() => setError(true))}>{t('mobile.logout')}</button>
          : <button disabled={!providerEnabled || catalog.loggingOut} onClick={() => setLogin(true)}>{t('mobile.login')}</button>}</div>}
      {!isLocal && !isCached && !providerEnabled && <p className="connection-hint">{t('mobile.connect')} <button onClick={() => setSettings(true)}>{t('mobile.settings')}</button></p>}
      <form className="search" onSubmit={e => { e.preventDefault(); setQueueView(false); if (!isLocal && !isCached && query.trim()) void catalog.load({ query: query.trim() }); }}>
        <Search size={20} /><input aria-label={t('mobile.search')} placeholder={t('mobile.search')} value={query} onChange={e => setQuery(e.target.value)} />
        <button disabled={(!isLocal && !isCached && !providerEnabled) || catalog.busy || !query.trim()}>{t('mobile.search')}</button>
      </form>
      <div className="section-heading"><h2>{queueView ? t('mobile.queue') : t(isCached ? 'options.mediaCache' : isLocal ? 'mobile.local' : catalog.collection?.type === 'cloud' ? 'mobile.accountCloud' : 'mobile.playlists')}</h2>
        <button aria-pressed={queueView} onClick={() => setQueueView(!queueView)}>{t('mobile.queue')} · {playback.state.queue.length}</button></div>
      {isLocal && !queueView && <LocalLibraryNav browser={localBrowser} clearQuery={() => setQuery('')} />}
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
        queueBusy={queueBusy} queueError={queueError} add={(song, behavior) => void add(song, behavior)} actions={onlineActions}
        play={(tracks, index) => queueWork(async () => { await flushSessions(); await native.setQueue({ songs: tracks, index }); setExpanded(true); })} />
      {isLocal && !queueView && <FolderImportStatus folders={folders} />}
      {browsingFolders && !queueView && <LocalFolderTools folders={folders} view={folderView} query={query}
        select={scope => { setFolderScope(scope); setQuery(''); }} />}
      {isLocal && !queueView && localBrowser.selected?.entityId && <button className="local-entity-edit"
        disabled={local.busy} onClick={() => setEntityId(localBrowser.selected?.entityId)}>
        {t('localMusic.editEntityTitle', { kind: t(localBrowser.selected.type === 'artist' ? 'localMusic.artistLabel' : 'localMusic.albumLabel') })}</button>}
      {isLocal && !queueView && (localBrowser.section === 'playlists' || localPlaylists.error) &&
        <LocalPlaylistToolbar controller={localPlaylists} selected={localBrowser.selected} />}
      {queueView && <div className="queue-toolbar">
        <button disabled={queueBusy || songs.length < 2} onClick={() => edit({ type: 'shuffle' })}>{t('mobile.shuffleQueue')}</button>
        <button disabled={queueBusy || !songs.length} onClick={() => { if (window.confirm(t('mobile.confirmClearQueue'))) edit({ type: 'clear' }); }}>{t('mobile.clearQueue')}</button>
        <button disabled={!localPlaylists.ready || localPlaylists.busy || !songs.some(song => song.sourceRef?.kind === 'local')}
          onClick={() => localPlaylists.create(songs)}>{t('localMusic.saveQueueAsPlaylist')}</button>
      </div>}
      {!isLocal && !isCached && !queueView && catalog.collections.length > 0 && <div className="collections">{catalog.collections.map(collection =>
        <button key={mobileCollectionKey(collection)} onClick={() => void catalog.load({ collection })}><Music2 size={18} />{collection.name}</button>)}</div>}
      {!isLocal && !isCached && !queueView && <div className="collection-actions">
        {catalog.collection && catalog.user && <OnlineCollectionSubscription
          key={mobileCollectionKey(catalog.collection) + ':' + String(catalog.user.id)} collection={catalog.collection}
          user={catalog.user} editor={playlistEditor} writable={available.subscriptionProviders.includes(provider)} />}
        {catalog.collection && catalog.user && available.playlistEditProviders.includes(provider) && playlistEditor.canEdit(catalog.collection, catalog.user) &&
          <button onClick={() => setManagedPlaylist(catalog.collection)}>{t('mobile.onlinePlaylistManage')}</button>}
        {catalog.collectionsMore && <button disabled={catalog.accountBusy} onClick={() => void catalog.loadCollections()}>{t('mobile.morePlaylists')}</button>}
        {catalog.accountError && <button disabled={catalog.accountBusy} onClick={() => void catalog.refresh()}>{t('mobile.retryPlaylists')}</button>}
        {catalog.trackError && <button disabled={catalog.busy} onClick={() => void catalog.load()}>{t('mobile.retrySongs')}</button>}
        {catalog.logoutError && <button disabled={catalog.loggingOut} onClick={() => void catalog.logout()}>{t('mobile.retry')} · {t('mobile.logout')}</button>}
      </div>}
      {((!isLocal && !isCached && (catalog.error || available.error)) || error) && <p role="alert">{t('mobile.error')}</p>}
      {isCached && mediaCache.error && <p role="alert">{t('mobile.cacheError')}</p>}
      {queueError && <p role="alert">{t('mobile.' + queueError)}</p>}
      {isLocal && local.error && <p role="alert">{t('mobile.importError')} {local.error}</p>}
      {(catalog.busy || catalog.accountBusy || local.busy) && <p role="status">{t('mobile.loading')}</p>}
      {isLocal && !queueView && localBrowser.browsing ? <LocalCollections collections={localBrowser.collections}
        select={id => { localBrowser.select(id); setQuery(''); }} /> : songs.length ? <SongList songs={songs} play={index => void play(index)} add={(song, behavior) => void add(song, behavior)}
        respectAvailability={searchingOnline}
        busy={queueBusy || localPlaylists.busy} edit={queueView ? edit : undefined} currentIndex={queueView ? playback.state.index : undefined}
        libraryActions={(song, close) => <>{onlineActions(song, close)}
          <LocalSongPlaylistActions song={song} controller={localPlaylists}
          selected={isLocal && !queueView ? localBrowser.selected : undefined} close={close} /></>}
        remove={isLocal && !queueView ? song => { if (window.confirm(t('mobile.confirmRemove', { name: song.name }))) void local.remove(song); } : undefined} />
        : (browsingFolders && !queueView && !folderView.root) || (!isLocal && !isCached && !queueView && (catalog.busy || catalog.trackError))
          ? null : <div className="empty"><Music2 size={44} /><p>{t(queueView ? 'mobile.queueEmpty' : searchingOnline ? 'mobile.empty'
            : isLocal ? (local.songs.length ? 'mobile.empty' : 'mobile.localEmpty') : 'mobile.noSongs')}</p></div>}
      {!isLocal && !isCached && catalog.more && !queueView && <button disabled={catalog.busy} onClick={() => void catalog.load()}>{t('mobile.more')}</button>}
    </div>
    <PlayerPanel appearance={appearance} state={playback.state} time={playback.currentTime} visible={playback.visible} light={light} songEpoch={playback.songEpoch}
      likes={likes} songLikeProviders={available.songLikeProviders}
      captureSongGuard={playback.captureSongGuard}
      expanded={expanded} collapse={() => setExpanded(false)} openQueue={() => { setQueueView(true); setExpanded(false); }} />
    <footer className="mini-player" inert={expanded}>
      <button className="mini-title" onClick={() => setExpanded(true)}><Music2 /><span><strong>{active?.name ?? 'Folia'}</strong>
        <small>{active?.artists.map(a => a.name).join(' / ') ?? 'Classic'}</small></span></button>
      <button disabled={!active && !playback.state.queue.length} aria-label={t(playback.state.playing ? 'mobile.pause' : 'mobile.play')}
        onClick={() => void native.command({ action: playback.state.playing ? 'pause' : 'play' }).catch(() => setError(true))}>
        {playback.state.playing ? <Pause /> : <Play />}</button>
    </footer>
    {settings && <SettingsSheet folders={folders} lyricPreference={lyricPreference} appearance={appearance} mediaCache={mediaCache} timer={sleepTimer} server={server} light={light} setLight={setLight}
      saved={() => location.reload()} close={() => setSettings(false)} />}
    {login && <LoginSheet provider={provider} refresh={catalog.refresh} close={() => setLogin(false)} />}
    {onlineTarget && <OnlineCatalogSheet target={onlineTarget} busy={queueBusy} error={queueError} close={() => setOnlineTarget(null)}
      editor={playlistEditor} subscriptionProviders={available.subscriptionProviders}
      play={(tracks, index) => void queueWork(async () => {
        await flushSessions(); await native.setQueue({ songs: tracks, index }); setOnlineTarget(null); setExpanded(true);
      })} add={(song, behavior) => void add(song, behavior)}
      songActions={song => <>{song.sourceRef?.kind === 'online' && <OnlineSongLike song={song} likes={likes}
        writable={available.songLikeProviders.includes(song.sourceRef.providerId)} />}{playlistAction(song)}</>} />}
    {playlistSong && <OnlinePlaylistPicker song={playlistSong} editor={playlistEditor} close={() => setPlaylistSong(null)} />}
    {managedPlaylist && <OnlinePlaylistManager collection={managedPlaylist} editor={playlistEditor} close={() => setManagedPlaylist(null)}
      queueBusy={queueBusy} queueError={queueError}
      play={(tracks, index) => void queueWork(async () => {
        await flushSessions(); await native.setQueue({ songs: tracks, index }); setManagedPlaylist(null); setExpanded(true);
      })} add={(song, behavior) => void add(song, behavior)} />}
    {entityId && local.snapshot && <LocalEntityDialog snapshot={local.snapshot} id={entityId} light={light}
      close={() => setEntityId(undefined)} selected={id => { localBrowser.select(id); void local.refresh(); }} />}
    {localPlaylists.request && <LocalPlaylistDialog controller={localPlaylists} request={localPlaylists.request} />}
    {localPlaylists.fileRequest && <LocalPlaylistFileDialog controller={localPlaylists} request={localPlaylists.fileRequest} songs={local.songs} />}
  </main>;
}
