import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { omni } from '../services/onlineMusic/omni';
import { createProviderLoginSession } from '../library/core/services/providerLoginSession';
import { windowAccountClock } from '../library/core/services/providerAccountDeps';
import { native } from './bridge';
import { cancelProvider, flushSessions } from './runtime';

// src/mobile/LoginSheet.tsx — reuses QR expiry/cancellation state machine, with immediate foreground polling.
export default function LoginSheet({ provider, refresh, close }: { provider: string; refresh: () => Promise<boolean>; close: () => void }) {
  const { t } = useTranslation();
  const [methods, setMethods] = useState(omni.getQrLoginMethods(provider));
  const [method, setMethod] = useState('');
  const [error, setError] = useState(false);
  const session = useMemo(() => createProviderLoginSession({
    auth: omni, clock: windowAccountClock, diagnostics: { appVersion: __APP_VERSION__, userAgent: navigator.userAgent },
    log: (_level, event) => { if (import.meta.env.DEV) console.info('[mobile-login]', event); },
    onInvalidate: id => { void cancelProvider(id).catch(() => setError(true)); },
    onConfirmed: async () => { await flushSessions(); return refresh(); },
  }), [refresh]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    let active = true;
    void omni.resolveQrLoginMethods(provider).then(value => { if (active) setMethods(value); }).catch(() => setError(true));
    const resume = () => { if (!document.hidden) session.resume(); };
    document.addEventListener('visibilitychange', resume);
    return () => { active = false; session.dispose(); document.removeEventListener('visibilitychange', resume); };
  }, [provider, session]);
  const start = async () => {
    session.stop(); await cancelProvider(provider);
    session.start(provider, method || undefined);
  };
  return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true" aria-label={t('mobile.login')}>
    <header><h2>{t('mobile.login')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
    <p>{t('mobile.qrHelp')}</p>
    {!!methods.length && <select aria-label={t('mobile.login')} value={method} onChange={e => setMethod(e.target.value)}>
      <option value="">{t('mobile.login')}</option>{methods.map(item => <option key={item.id} value={item.id}>{t(item.labelKey as "mobile.login")}</option>)}
    </select>}
    {state.qrImageUrl && <img className="qr-image" src={state.qrImageUrl} alt={t('mobile.login')} />}
    <p role="status">{t(('mobile.' + (['waiting', 'scanned', 'confirmed', 'expired', 'loading'].includes(state.phase) ? state.phase : 'login')) as 'mobile.login')}</p>
    {(state.phase === 'error' || error) && <p role="alert">{t('mobile.error')}</p>}
    <div className="actions">
      <button disabled={state.phase === 'loading'} onClick={() => void start().catch(() => setError(true))}>{t('mobile.refresh')}</button>
      {state.qrImageUrl && <button onClick={() => void native.shareQR({ image: state.qrImageUrl }).catch(() => setError(true))}>{t('mobile.share')}</button>}
    </div>
  </section></div>;
}
