import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings, Search, Music2, Play, Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../i18n/config';
import { native, isNative } from './bridge';
import { flushSessions } from './runtime';
import { usePlayback } from './usePlayback';
import { useCatalog } from './useCatalog';
import { useProviders } from './useProviders';
import { useLocalCatalog } from './useLocalCatalog';
import { useAppPreferences } from '../hooks/useAppPreferences';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useMediaCache } from './useMediaCache';
import SongList from './SongList';
import LoginSheet from './LoginSheet';
import SettingsSheet from './SettingsSheet';
import PlayerPanel from './PlayerPanel';
import type { SongResult } from '../types';
import { addMobileSongs, editMobileQueue, type QueueAction } from './queueActions';
import { useMediaQuery } from '../hooks/useMediaQuery';

// src/mobile/MobileApp.tsx — phone library + expandable player; split view follows window width.
export default function MobileApp({ initialServer }: { initialServer: string }) {
  const { t } = useTranslation();
  const [server, setServer] = useState(initialServer);
  const [provider, setProvider] = useState(initialServer ? 'netease' : 'local');
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(false);
  const [login, setLogin] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Short landscape windows keep phone navigation, even on large iPhones.
  const split = useMediaQuery('(min-width: 850px) and (min-height: 600px)');
  const [queueView, setQueueView] = useState(false);
  const light = useThemeSettingsStore(s => s.isDaylight);
  const setLight = useThemeSettingsStore(s => s.setDaylightPreference);
  useAppPreferences();
  const [error, setError] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [queueBusy, setQueueBusy] = useState(false);
  const queueLock = useRef(false);
  const available = useProviders(server);
  const providerEnabled = available.providers.includes(provider);
  useEffect(() => {
    if (provider !== 'local' && provider !== 'cached' && available.providers.length && !providerEnabled) setProvider(available.providers[0]);
  }, [available.providers, providerEnabled, provider]);
  const playback = usePlayback();
  const catalog = useCatalog(provider, !!server && isNative && providerEnabled);
  const local = useLocalCatalog();
  const mediaCache = useMediaCache();
  const isCached = provider === 'cached';
  const isLocal = provider === 'local';
  const songs = useMemo(() => queueView ? playback.state.queue : isLocal || isCached ? (isCached ? mediaCache.state?.songs ?? [] : local.songs).filter(song =>
    `${song.name} ${song.artists.map(a => a.name).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : catalog.songs,
  [queueView, playback.state.queue, isLocal, isCached, mediaCache.state?.songs, local.songs, query, catalog.songs]);
  const active = playback.state.currentSong;
  const queueWork = async (work: () => Promise<unknown>) => {
    if (queueLock.current) return;
    queueLock.current = true; setQueueBusy(true); setQueueError('');
    try { await work(); }
    catch (cause) { setQueueError(cause instanceof Error && cause.message === 'queue-changed' ? 'queueChanged'
      : cause instanceof Error && cause.message === 'queue-full' ? 'queueFull' : 'error'); }
    finally { queueLock.current = false; setQueueBusy(false); }
  };
  const play = async (index: number) => {
    await queueWork(async () => {
      if (songs.some(song => song.sourceRef?.kind === 'online')) await flushSessions();
      if (queueView) await native.selectQueue({ index, queueRevision: playback.state.queueRevision });
      else await native.setQueue({ songs, index });
      setExpanded(true);
    });
  };
  const add = (song: SongResult, next = false) => queueWork(async () => {
    if (song.sourceRef?.kind === 'online') await flushSessions();
    await addMobileSongs([song], next ? 'next' : 'append');
  });
  const edit = (action: QueueAction) => void queueWork(() => editMobileQueue(playback.state, action));
  return <main className={'mobile-app ' + (light ? 'daylight' : '')} data-layout={split ? 'split' : 'compact'}>
    <div className="library-panel" inert={expanded && !split}>
      <header className="brand"><div><small>FOLIA</small><h1>{t('mobile.library')}</h1></div>
        <button aria-label={t('mobile.settings')} onClick={() => setSettings(true)}><Settings /></button></header>
      <nav className="providers" aria-label="Music platform">
        {[['local', t('mobile.local')], ['cached', t('options.mediaCache')], ['netease', '网易云'], ['qq', 'QQ 音乐'], ['kugou', '酷狗']].filter(([id]) => id !== 'kugou' || available.providers.includes(id)).map(([id, name]) =>
          <button key={id} aria-pressed={provider === id} onClick={() => { setProvider(id); setQueueView(false); setQuery(''); }}>{name}</button>)}
      </nav>
      {isCached ? <div className="account-row"><span>{mediaCache.state?.count ?? 0} {t('mobile.tracks')}</span></div> : isLocal ? <div className="account-row"><span>{local.songs.length} {t('mobile.tracks')}</span>
        <button disabled={local.busy || !isNative} onClick={() => void local.importAudio()}>{t('mobile.importAudio')}</button></div> :
      <div className="account-row"><span>{catalog.user?.nickname ?? provider.toUpperCase()}</span>
        {catalog.user ? <button disabled={catalog.busy} onClick={() => void catalog.logout().catch(() => setError(true))}>{t('mobile.logout')}</button>
          : <button disabled={!providerEnabled} onClick={() => setLogin(true)}>{t('mobile.login')}</button>}</div>}
      {!isLocal && !isCached && !providerEnabled && <p className="connection-hint">{t('mobile.connect')} <button onClick={() => setSettings(true)}>{t('mobile.settings')}</button></p>}
      <form className="search" onSubmit={e => { e.preventDefault(); setQueueView(false); if (!isLocal && !isCached && query.trim()) void catalog.load({ query: query.trim() }); }}>
        <Search size={20} /><input aria-label={t('mobile.search')} placeholder={t('mobile.search')} value={query} onChange={e => setQuery(e.target.value)} />
        <button disabled={(!isLocal && !isCached && !providerEnabled) || catalog.busy || !query.trim()}>{t('mobile.search')}</button>
      </form>
      <div className="section-heading"><h2>{queueView ? t('mobile.queue') : t(isCached ? 'options.mediaCache' : isLocal ? 'mobile.local' : 'mobile.playlists')}</h2>
        <button aria-pressed={queueView} onClick={() => setQueueView(!queueView)}>{t('mobile.queue')} · {playback.state.queue.length}</button></div>
      {queueView && <div className="queue-toolbar">
        <button disabled={queueBusy || songs.length < 2} onClick={() => edit({ type: 'shuffle' })}>{t('mobile.shuffleQueue')}</button>
        <button disabled={queueBusy || !songs.length} onClick={() => { if (window.confirm(t('mobile.confirmClearQueue'))) edit({ type: 'clear' }); }}>{t('mobile.clearQueue')}</button>
      </div>}
      {!isLocal && !isCached && !queueView && catalog.collections.length > 0 && <div className="collections">{catalog.collections.map(collection =>
        <button key={String(collection.id)} onClick={() => void catalog.load({ collection })}><Music2 size={18} />{collection.name}</button>)}</div>}
      {((!isLocal && !isCached && (catalog.error || available.error)) || error) && <p role="alert">{t('mobile.error')}</p>}
      {isCached && mediaCache.error && <p role="alert">{t('mobile.cacheError')}</p>}
      {queueError && <p role="alert">{t('mobile.' + queueError)}</p>}
      {isLocal && local.error && <p role="alert">{t('mobile.importError')} {local.error}</p>}
      {(catalog.busy || local.busy) && <p role="status">{t('mobile.loading')}</p>}
      {songs.length ? <SongList songs={songs} play={index => void play(index)} add={(song, next) => void add(song, next)}
        busy={queueBusy} edit={queueView ? edit : undefined} currentIndex={queueView ? playback.state.index : undefined}
        remove={isLocal && !queueView ? song => { if (window.confirm(t('mobile.confirmRemove', { name: song.name }))) void local.remove(song); } : undefined} />
        : <div className="empty"><Music2 size={44} /><p>{t(queueView ? 'mobile.queueEmpty' : isLocal ? 'mobile.localEmpty' : 'mobile.noSongs')}</p></div>}
      {!isLocal && !isCached && catalog.more && !queueView && <button disabled={catalog.busy} onClick={() => void catalog.load()}>{t('mobile.more')}</button>}
    </div>
    <PlayerPanel state={playback.state} time={playback.currentTime} visible={playback.visible} light={light}
      expanded={expanded} split={split} collapse={() => setExpanded(false)} />
    <footer className="mini-player" inert={expanded && !split}>
      <button className="mini-title" onClick={() => setExpanded(true)}><Music2 /><span><strong>{active?.name ?? 'Folia'}</strong>
        <small>{active?.artists.map(a => a.name).join(' / ') ?? 'Classic'}</small></span></button>
      <button disabled={!active && !playback.state.queue.length} aria-label={t(playback.state.playing ? 'mobile.pause' : 'mobile.play')}
        onClick={() => void native.command({ action: playback.state.playing ? 'pause' : 'play' }).catch(() => setError(true))}>
        {playback.state.playing ? <Pause /> : <Play />}</button>
    </footer>
    {settings && <SettingsSheet mediaCache={mediaCache} server={server} light={light} setLight={setLight}
      saved={value => { if (value === server) location.reload(); else setServer(value); }} close={() => setSettings(false)} />}
    {login && <LoginSheet provider={provider} refresh={catalog.refresh} close={() => setLogin(false)} />}
  </main>;
}
