import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
  const [preparing, setPreparing] = useState(false);
  const startEpoch = useRef(0);
  const errorEpoch = useRef(0);
  const session = useMemo(() => createProviderLoginSession({
    auth: omni, clock: windowAccountClock, diagnostics: { appVersion: __APP_VERSION__, userAgent: navigator.userAgent },
    log: (_level, event) => { if (import.meta.env.DEV) console.info('[mobile-login]', event); },
    onInvalidate: id => {
      const epoch = errorEpoch.current;
      void cancelProvider(id).catch(() => { if (epoch === errorEpoch.current) setError(true); });
    },
    onConfirmed: async () => { await flushSessions([provider]); return refresh(); },
  }), [provider, refresh]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    let active = true;
    void omni.resolveQrLoginMethods(provider).then(value => { if (active) setMethods(value); }).catch(() => { if (active) setError(true); });
    const resume = () => { if (!document.hidden) session.resume(); };
    document.addEventListener('visibilitychange', resume);
    return () => { active = false; startEpoch.current++; session.dispose(); errorEpoch.current++; document.removeEventListener('visibilitychange', resume); };
  }, [provider, session]);
  // UI errors belong to the latest action; the shared session still owns QR/auth generations.
  const attempt = async (action: () => Promise<unknown>) => {
    const epoch = ++errorEpoch.current;
    setError(false);
    try { await action(); }
    catch { if (epoch === errorEpoch.current) setError(true); }
  };
  const start = () => {
    const epoch = ++startEpoch.current;
    session.stop();
    setPreparing(true);
    return attempt(async () => {
      try {
        // Resolve capabilities before cancellation can retire their in-flight transport response.
        const available = await omni.resolveQrLoginMethods(provider);
        if (epoch !== startEpoch.current) return;
        setMethods(available);
        await cancelProvider(provider);
        if (epoch !== startEpoch.current) return;
        session.start(provider, available.some(item => item.id === method) ? method : undefined);
      } finally { if (epoch === startEpoch.current) setPreparing(false); }
    });
  };
  const phase = preparing ? 'loading' : state.phase;
  const qrImage = preparing ? '' : state.qrImageUrl;
  return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true" aria-label={t('mobile.login')}>
    <header><h2>{t('mobile.login')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
    <p>{t('mobile.qrHelp')}</p>
    {!!methods.length && <select aria-label={t('mobile.login')} value={method} onChange={e => setMethod(e.target.value)}>
      <option value="">{t('mobile.login')}</option>{methods.map(item => <option key={item.id} value={item.id}>{t(item.labelKey as "mobile.login")}</option>)}
    </select>}
    {qrImage && <img className="qr-image" src={qrImage} alt={t('mobile.login')} />}
    <p role="status">{t(('mobile.' + (['waiting', 'scanned', 'confirmed', 'expired', 'loading'].includes(phase) ? phase : 'login')) as 'mobile.login')}</p>
    {(state.phase === 'error' || error) && <p role="alert">{t('mobile.error')}</p>}
    <div className="actions">
      <button disabled={state.phase === 'loading'} onClick={() => void start()}>{t('mobile.refresh')}</button>
      {qrImage && <button onClick={() => void attempt(() => native.shareQR({ image: qrImage }))}>{t('mobile.share')}</button>}
    </div>
  </section></div>;
}
