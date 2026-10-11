import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { native, isNative } from './bridge';
import MediaCacheControls from './MediaCacheControls';
import ResourceCacheControls from './ResourceCacheControls';
import type { useMediaCache } from './useMediaCache';
import { cancelProvider, clearProvider } from './runtime';
import type { MobileTheme } from './useMobileTheme';
import BatchLyricExportDialog from './BatchLyricExportDialog';
import SleepTimerSheet from './SleepTimerSheet';
import type { useNativeSleepTimer } from './useNativeSleepTimer';
import AISettingsSheet from './AISettingsSheet';

// src/mobile/SettingsSheet.tsx
export default function SettingsSheet({ appearance, mediaCache, timer, server, light, setLight, saved, close }: {
  appearance: MobileTheme;
  timer: ReturnType<typeof useNativeSleepTimer>;
  mediaCache: ReturnType<typeof useMediaCache>; server: string; light: boolean; setLight: (value: boolean) => void; saved: (server: string) => void; close: () => void;
}) {
  const { t } = useTranslation();
  const [address, setAddress] = useState(server);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [batch, setBatch] = useState(false);
  const [sleep, setSleep] = useState(false);
  const [aiSettings, setAISettings] = useState(false);
  const save = async () => {
    setBusy(true); setError(false);
    try {
      const url = new URL(address);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error();
      for (const provider of ['netease', 'qq', 'kugou']) await cancelProvider(provider);
      // Sessions belong to the configured backend, especially QQ sealed tokens.
      if (url.origin !== server) for (const provider of ['netease', 'qq', 'kugou']) await clearProvider(provider);
      await native.configure({ server: url.origin, token });
      setToken(''); saved(url.origin); close();
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  if (batch) return <BatchLyricExportDialog light={light} theme={light ? appearance.theme.light : appearance.theme.dark} close={() => setBatch(false)} />;
  if (sleep) return <SleepTimerSheet timer={timer} light={light} theme={light ? appearance.theme.light : appearance.theme.dark} close={() => setSleep(false)} />;
  if (aiSettings) return <AISettingsSheet close={() => setAISettings(false)} />;
  return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true" aria-label={t('mobile.settings')}>
    <header><h2>{t('mobile.settings')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
    <p>{t('mobile.optionalServer')}</p>
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>{t('mobile.server')}<input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" required value={address} onChange={e => setAddress(e.target.value)} placeholder="https://music.example.com" /></label>
      <label>{t('mobile.token')}<input type="password" autoComplete="off" required minLength={32} value={token} onChange={e => setToken(e.target.value)} /></label>
      <button className="solid" disabled={busy || !isNative}>{busy ? t('mobile.loading') : t('mobile.save')}</button>
    </form>
    {!isNative && <p>{t('mobile.nativeOnly')}</p>}
    {error && <p role="alert">{t('mobile.error')}</p>}
    <label>{t('mobile.theme')}<select value={light ? 'light' : 'dark'} onChange={e => setLight(e.target.value === 'light')}>
      <option value="dark">{t('mobile.dark')}</option><option value="light">{t('mobile.light')}</option>
    </select></label>
    <MediaCacheControls cache={mediaCache} light={light} />
    <button onClick={() => setSleep(true)}>{t('commandPalette.sleepTimerTitle')}</button>
    <button onClick={() => setAISettings(true)}>{t('mobile.ai.settings')}</button>
    <ResourceCacheControls />
    <ResourceCacheControls category="lyrics" />
    <button onClick={() => setBatch(true)}>{t('lyricExport.settingsEntry')}</button>
    <p className="muted">{t('mobile.limited')}</p>
  </section></div>;
}
