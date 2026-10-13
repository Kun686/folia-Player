import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavidromeSettings } from './useNavidromeSettings';
import { navidromeRuntime } from './navidromeRuntime';
import { createMobileNavidromeConnection, type MobileNavidromeConnection } from './navidromeConnection';
import { navidromeErrorKey } from './localeNavidrome';

// NavidromeSettingsSheet.tsx — existing touch sheet, write-only credentials and explicit connection test.
export default function NavidromeSettingsSheet({ close }: { close(): void }) {
  const { t } = useTranslation(), state = useNavidromeSettings(), settings = state.settings;
  const [address, setAddress] = useState(''), [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(false), [clear, setClear] = useState(false), [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const probe = useRef<MobileNavidromeConnection | null>(null), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; probe.current?.dispose(); }; }, []);
  useEffect(() => {
    if (settings) { setAddress(settings.baseURL); setUsername(settings.username); setEnabled(settings.enabled); setPassword(''); setClear(false); }
  }, [settings]);
  const dirty = !!settings && (address.trim().replace(/\/+$/, '') !== settings.baseURL || username.trim() !== settings.username
    || enabled !== settings.enabled || !!password || clear);
  const busy = state.busy || testing;
  const report = (cause: unknown) => { if (mounted.current) { setError(true); setMessage(t(navidromeErrorKey(cause instanceof Error ? cause.message : ''))); } };
  const save = async () => {
    setMessage(''); setError(false);
    try { await navidromeRuntime.save({ baseURL: address, username, enabled, ...(clear ? { password: '' } : password ? { password } : {}) });
      if (mounted.current) setMessage(t('mobile.navidrome.saved'));
    } catch (cause) { report(cause); }
  };
  const test = async () => {
    if (!settings || busy || dirty || probe.current) return;
    const current = navidromeRuntime.capture(), connection = createMobileNavidromeConnection(settings);
    probe.current = connection; setTesting(true); setMessage(''); setError(false);
    try {
      if (!await connection.api.ping(connection.settings)) throw Error('navidrome-network');
      if (mounted.current && current()) setMessage(t('mobile.navidrome.success'));
    } catch (cause) { if (current()) report(cause); }
    finally { connection.dispose(); probe.current = null; if (mounted.current) setTesting(false); }
  };
  return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true" aria-label={t('mobile.navidrome.settings')}>
    <header><h2>{t('mobile.navidrome.settings')}</h2><button disabled={busy} onClick={close}>{t('mobile.close')}</button></header>
    <p>{t('mobile.navidrome.hint')}</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy || !settings}>
      <label className="check-label"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />{t('mobile.navidrome.enabled')}</label>
      <label>{t('mobile.navidrome.address')}<input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" maxLength={2048}
        value={address} onChange={e => setAddress(e.target.value)} placeholder="https://music.example.com/navidrome" /></label>
      <label>{t('mobile.navidrome.username')}<input autoCapitalize="none" autoCorrect="off" autoComplete="off" maxLength={512}
        value={username} onChange={e => setUsername(e.target.value)} /></label>
      <p className="muted">{t('mobile.navidrome.addressHint')}</p>
      <p>{t(settings?.hasPassword ? 'mobile.navidrome.passwordSaved' : 'mobile.navidrome.passwordMissing')}</p>
      <label>{t('mobile.navidrome.password')}<input type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" maxLength={8192}
        disabled={clear} placeholder={t('mobile.navidrome.passwordHint')} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label className="check-label"><input type="checkbox" checked={clear} disabled={!settings?.hasPassword} onChange={e => {
        setClear(e.target.checked); setPassword(''); if (e.target.checked) setEnabled(false);
      }} />{t('mobile.navidrome.clearPassword')}</label>
      <button className="solid" disabled={!dirty}>{t('mobile.save')}</button>
    </fieldset></form>
    {dirty && <p>{t('mobile.navidrome.dirty')}</p>}
    <button disabled={busy || dirty || !settings?.enabled} onClick={() => void test()}>{t('mobile.navidrome.test')}</button>
    {busy && <p role="status">{t('mobile.loading')}</p>}
    {testing && <button onClick={() => probe.current?.dispose()}>{t('mobile.sync.cancel')}</button>}
    {(message || state.error) && <p role={error || state.error ? 'alert' : 'status'}>{message || t(navidromeErrorKey(state.error))}</p>}
    {(error || state.error) && <button disabled={busy} onClick={() => { setMessage(''); void navidromeRuntime.load().catch(report); }}>{t('mobile.retry')}</button>}
  </section></div>;
}
