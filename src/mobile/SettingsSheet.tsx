import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { isNative } from './bridge';
import MediaCacheControls from './MediaCacheControls';
import ResourceCacheControls from './ResourceCacheControls';
import type { useMediaCache } from './useMediaCache';
import { configureGateway } from './runtime';
import type { MobileTheme } from './useMobileTheme';
import BatchLyricExportDialog from './BatchLyricExportDialog';
import SleepTimerSheet from './SleepTimerSheet';
import type { useNativeSleepTimer } from './useNativeSleepTimer';
import LocalLyricPreference, { type useLocalLyricPreference } from './LocalLyricPreference';
import LocalLyricFormatSettings from './LocalLyricFormatSettings';
import AISettingsSheet from './AISettingsSheet';
import SyncSettingsSheet from './SyncSettingsSheet';
import NavidromeSettingsSheet from './NavidromeSettingsSheet';
import QueuePreference from './QueuePreference';
import OnlineLyricPreference from './OnlineLyricPreference';
import type { LocalFolders } from './useLocalFolders';
import DisplaySleepPreference from './DisplaySleepPreference';
import LanguagePreference from './LanguagePreference';
import { useSheetScroll } from './useSheetScroll';
import PlaybackViewPreference from './PlaybackViewPreference';
import MobileSelect from './MobileSelect';

// src/mobile/SettingsSheet.tsx
export default function SettingsSheet({ appearance, mediaCache, timer, server, light, setLight, saved, close, openCache, lyricPreference, folders }: {
  openCache(): void;
  folders: LocalFolders;
  lyricPreference: ReturnType<typeof useLocalLyricPreference>;
  appearance: MobileTheme;
  timer: ReturnType<typeof useNativeSleepTimer>;
  mediaCache: ReturnType<typeof useMediaCache>; server: string; light: boolean; setLight: (value: boolean) => void; saved: (server: string) => void; close: () => void;
}) {
  const { t } = useTranslation();
  const scrollBody = useSheetScroll();
  const [address, setAddress] = useState(server);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [batch, setBatch] = useState(false);
  const [sleep, setSleep] = useState(false);
  const [integration, setIntegration] = useState<'ai' | 'sync' | 'navidrome' | 'lyricFormats' | null>(null);
  const save = async () => {
    setBusy(true); setError(false);
    try {
      const url = new URL(address);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error();
      await configureGateway(url.origin, token);
      setToken(''); saved(url.origin); close();
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  if (batch) return <BatchLyricExportDialog light={light} theme={light ? appearance.theme.light : appearance.theme.dark} close={() => setBatch(false)} />;
  if (sleep) return <SleepTimerSheet timer={timer} light={light} theme={light ? appearance.theme.light : appearance.theme.dark} close={() => setSleep(false)} />;
  if (integration === 'ai') return <AISettingsSheet close={() => setIntegration(null)} />;
  if (integration === 'sync') return <SyncSettingsSheet close={() => setIntegration(null)} />;
  if (integration === 'navidrome') return <NavidromeSettingsSheet close={() => setIntegration(null)} />;
  if (integration === 'lyricFormats') return <LocalLyricFormatSettings folders={folders} close={() => setIntegration(null)} />;
  return <div className="sheet-backdrop"><section className="sheet sheet-pinned settings-sheet" role="dialog" aria-modal="true" aria-label={t('mobile.settings')}>
    <header><h2>{t('mobile.settings')}</h2><button className="sheet-close" aria-label={t('mobile.close')} onClick={close}><X size={22} /></button></header>
    <div className="sheet-body" ref={scrollBody}>
    <section className="settings-group" aria-labelledby="settings-appearance">
      <h3 id="settings-appearance">{t('mobile.settingsGroups.appearance')}</h3>
      <LanguagePreference />
      <label className="mobile-preference preference-row"><span>{t('mobile.theme')}</span><MobileSelect value={light ? 'light' : 'dark'} onChange={e => setLight(e.target.value === 'light')}>
        <option value="dark">{t('mobile.dark')}</option><option value="light">{t('mobile.light')}</option>
      </MobileSelect></label>
    </section>
    <section className="settings-group" aria-labelledby="settings-playback">
      <h3 id="settings-playback">{t('mobile.settingsGroups.playback')}</h3>
      <PlaybackViewPreference />
      <QueuePreference />
      <DisplaySleepPreference />
      <button className="settings-link" onClick={() => setSleep(true)}>{t('commandPalette.sleepTimerTitle')}</button>
    </section>
    <section className="settings-group" aria-labelledby="settings-lyrics">
      <h3 id="settings-lyrics">{t('mobile.settingsGroups.lyrics')}</h3>
      <OnlineLyricPreference />
      <LocalLyricPreference status={lyricPreference} />
      <button className="settings-link" onClick={() => setIntegration('lyricFormats')}>{t('options.localLyricFormatOrder')}</button>
      <button className="settings-link" onClick={() => setBatch(true)}>{t('lyricExport.settingsEntry')}</button>
    </section>
    <section className="settings-group" aria-labelledby="settings-other">
      <h3 id="settings-other">{t('mobile.settingsGroups.other')}</h3>
      <button className="settings-link" onClick={() => setIntegration('ai')}>{t('mobile.ai.settings')}</button>
      <button className="settings-link" onClick={() => setIntegration('navidrome')}>{t('mobile.navidrome.settings')}</button>
      <button className="settings-link" onClick={() => setIntegration('sync')}>{t('options.r2Sync')}</button>
    </section>
    <details className="settings-group settings-disclosure" open={!server}>
    <summary>{t('mobile.settingsGroups.connection')}</summary>
    <p>{t('mobile.optionalServer')}</p>
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>{t('mobile.server')}<input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" required value={address} onChange={e => setAddress(e.target.value)} placeholder="https://music.example.com" /></label>
      <label>{t('mobile.token')}<input type="password" autoComplete="off" required minLength={32} maxLength={4096} value={token} onChange={e => setToken(e.target.value)} /></label>
      <button className="solid" disabled={busy || !isNative}>{busy ? t('mobile.loading') : t('mobile.save')}</button>
    </form>
    {!isNative && <p>{t('mobile.nativeOnly')}</p>}
    {error && <p role="alert">{t('mobile.error')}</p>}
    </details>
    <details className="settings-group settings-disclosure">
    <summary>{t('mobile.settingsGroups.cache')}</summary>
    <button className="settings-link" onClick={openCache}>{t('mobile.browseCache')}</button>
    <MediaCacheControls cache={mediaCache} light={light} />
    <ResourceCacheControls />
    <ResourceCacheControls category="lyrics" />
    </details>
    </div>
  </section></div>;
}
