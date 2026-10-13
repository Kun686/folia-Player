import { useEffect, useRef, useState } from 'react';
import { Airplay } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isNative, native } from './bridge';

// AudioRouteControl.tsx — the system picker owns route changes; dismissing it is not a successful device selection.
export default function AudioRouteControl({ light }: { light: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const pending = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const choose = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(false);
    try {
      await native.chooseAudioRoute({ light, labels: { title: t('options.audioOutputSettings'), hint: t('mobile.audioRouteHint'),
        close: t('mobile.close'), fallback: t('options.audioOutputDefault') } });
    } catch { if (active.current) setError(true); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return <div className="audio-route-control">
    <button disabled={!isNative || busy} onClick={() => void choose()} aria-busy={busy}>
      <Airplay size={20} aria-hidden="true" />{t('options.audioOutputSettings')}
    </button>
    {error && <p role="alert">{t('mobile.audioRouteFailed')}</p>}
  </div>;
}
