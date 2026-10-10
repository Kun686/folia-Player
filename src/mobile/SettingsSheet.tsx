import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { native, isNative } from './bridge';
import { cancelProvider, clearProvider } from './runtime';

// src/mobile/SettingsSheet.tsx
export default function SettingsSheet({ server, light, setLight, saved, close }: {
  server: string; light: boolean; setLight: (value: boolean) => void; saved: (server: string) => void; close: () => void;
}) {
  const { t } = useTranslation();
  const [address, setAddress] = useState(server);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
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
  return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true" aria-label={t('mobile.settings')}>
    <header><h2>{t('mobile.settings')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
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
    <p className="muted">{t('mobile.limited')}</p>
  </section></div>;
}
