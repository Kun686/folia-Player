import { useEffect, useState } from 'react';
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
import SongList from './SongList';
import LoginSheet from './LoginSheet';
import SettingsSheet from './SettingsSheet';
import PlayerPanel from './PlayerPanel';
import type { SongResult } from '../types';

// src/mobile/MobileApp.tsx — phone library + expandable player; split view follows window width.
export default function MobileApp({ initialServer }: { initialServer: string }) {
  const { t } = useTranslation();
  const [server, setServer] = useState(initialServer);
  const [provider, setProvider] = useState(initialServer ? 'netease' : 'local');
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(false);
  const [login, setLogin] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [queueView, setQueueView] = useState(false);
  const light = useThemeSettingsStore(s => s.isDaylight);
  const setLight = useThemeSettingsStore(s => s.setDaylightPreference);
  useAppPreferences();
  const [error, setError] = useState(false);
  const available = useProviders(server);
  const providerEnabled = available.providers.includes(provider);
  useEffect(() => {
    if (provider !== 'local' && available.providers.length && !providerEnabled) setProvider(available.providers[0]);
  }, [available.providers, providerEnabled, provider]);
  const playback = usePlayback();
  const catalog = useCatalog(provider, !!server && isNative && providerEnabled);
  const local = useLocalCatalog();
  const isLocal = provider === 'local';
  const songs = queueView ? playback.state.queue : isLocal ? local.songs.filter(song =>
    `${song.name} ${song.artists.map(a => a.name).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : catalog.songs;
  const active = playback.state.queue[playback.state.index];
  const play = async (index: number) => {
    try { if (songs.some(song => song.sourceRef?.kind === 'online')) await flushSessions(); await native.setQueue({ songs, index }); setExpanded(true); }
    catch { setError(true); }
  };
  const add = async (song: SongResult) => {
    try { if (song.sourceRef?.kind === 'online') await flushSessions(); await native.setQueue({ songs: [song], index: 0, append: true }); }
    catch { setError(true); }
  };
  return <main className={'mobile-app ' + (light ? 'daylight' : '')}>
    <div className="library-panel">
      <header className="brand"><div><small>FOLIA / PERSONAL</small><h1>{t('mobile.library')}</h1></div>
        <button aria-label={t('mobile.settings')} onClick={() => setSettings(true)}><Settings /></button></header>
      <nav className="providers" aria-label="Music platform">
        {[['local', t('mobile.local')], ['netease', '网易云'], ['qq', 'QQ 音乐'], ['kugou', '酷狗']].filter(([id]) => id !== 'kugou' || available.providers.includes(id)).map(([id, name]) =>
          <button key={id} aria-pressed={provider === id} onClick={() => { setProvider(id); setQueueView(false); setQuery(''); }}>{name}</button>)}
      </nav>
      {isLocal ? <div className="account-row"><span>{local.songs.length} {t('mobile.tracks')}</span>
        <button disabled={local.busy || !isNative} onClick={() => void local.importAudio()}>{t('mobile.importAudio')}</button></div> :
      <div className="account-row"><span>{catalog.user?.nickname ?? provider.toUpperCase()}</span>
        {catalog.user ? <button disabled={catalog.busy} onClick={() => void catalog.logout().catch(() => setError(true))}>{t('mobile.logout')}</button>
          : <button disabled={!providerEnabled} onClick={() => setLogin(true)}>{t('mobile.login')}</button>}</div>}
      {!isLocal && !providerEnabled && <p className="connection-hint">{t('mobile.connect')} <button onClick={() => setSettings(true)}>{t('mobile.settings')}</button></p>}
      <form className="search" onSubmit={e => { e.preventDefault(); setQueueView(false); if (!isLocal && query.trim()) void catalog.load({ query: query.trim() }); }}>
        <Search size={20} /><input aria-label={t('mobile.search')} placeholder={t('mobile.search')} value={query} onChange={e => setQuery(e.target.value)} />
        <button disabled={(!isLocal && !providerEnabled) || catalog.busy || !query.trim()}>{t('mobile.search')}</button>
      </form>
      <div className="section-heading"><h2>{queueView ? t('mobile.queue') : t(isLocal ? 'mobile.local' : 'mobile.playlists')}</h2>
        <button aria-pressed={queueView} onClick={() => setQueueView(!queueView)}>{t('mobile.queue')} · {playback.state.queue.length}</button></div>
      {!isLocal && !queueView && catalog.collections.length > 0 && <div className="collections">{catalog.collections.map(collection =>
        <button key={String(collection.id)} onClick={() => void catalog.load({ collection })}><Music2 size={18} />{collection.name}</button>)}</div>}
      {((!isLocal && (catalog.error || available.error)) || error) && <p role="alert">{t('mobile.error')}</p>}
      {isLocal && local.error && <p role="alert">{t('mobile.importError')} {local.error}</p>}
      {(catalog.busy || local.busy) && <p role="status">{t('mobile.loading')}</p>}
      {songs.length ? <SongList songs={songs} play={index => void play(index)} add={song => void add(song)}
        remove={isLocal && !queueView ? song => { if (window.confirm(t('mobile.confirmRemove', { name: song.name }))) void local.remove(song); } : undefined} />
        : <div className="empty"><Music2 size={44} /><p>{t(isLocal ? 'mobile.localEmpty' : 'mobile.noSongs')}</p></div>}
      {!isLocal && catalog.more && !queueView && <button disabled={catalog.busy} onClick={() => void catalog.load()}>{t('mobile.more')}</button>}
    </div>
    <PlayerPanel state={playback.state} time={playback.currentTime} visible={playback.visible} light={light}
      expanded={expanded} collapse={() => setExpanded(false)} />
    <footer className="mini-player">
      <button className="mini-title" onClick={() => setExpanded(true)}><Music2 /><span><strong>{active?.name ?? 'Folia'}</strong>
        <small>{active?.artists.map(a => a.name).join(' / ') ?? 'Classic'}</small></span></button>
      <button disabled={!active} aria-label={t(playback.state.playing ? 'mobile.pause' : 'mobile.play')}
        onClick={() => void native.command({ action: playback.state.playing ? 'pause' : 'play' }).catch(() => setError(true))}>
        {playback.state.playing ? <Pause /> : <Play />}</button>
    </footer>
    {settings && <SettingsSheet server={server} light={light} setLight={setLight}
      saved={value => { if (value === server) location.reload(); else setServer(value); }} close={() => setSettings(false)} />}
    {login && <LoginSheet provider={provider} refresh={catalog.refresh} close={() => setLogin(false)} />}
  </main>;
}
