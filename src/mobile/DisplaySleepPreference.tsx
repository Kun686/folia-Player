import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopSettingsStore } from '../stores/useDesktopSettingsStore';
import { connectDisplaySleepSettings } from './displaySleepSettingsSync';
import { isNative } from './bridge';

// DisplaySleepPreference.tsx — foreground playback only; no JavaScript wake lock or playback commands.
export default function DisplaySleepPreference() {
  const { t } = useTranslation();
  const enabled = useDesktopSettingsStore(state => state.preventDisplaySleepDuringPlayback);
  const [status, setStatus] = useState({ ready: false, error: false });
  const [localError, setLocalError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (isNative) return connectDisplaySleepSettings((ready, error) => setStatus({ ready, error }));
  }, [attempt]);
  return <section className="mobile-preference display-sleep-preference">
    <label className="check-label"><input type="checkbox" checked={enabled} disabled={!status.ready}
      aria-describedby="display-sleep-hint" onChange={event => {
        try { useDesktopSettingsStore.getState().handleTogglePreventDisplaySleepDuringPlayback(event.target.checked); setLocalError(false); }
        catch { setLocalError(true); }
      }} />{t('options.preventDisplaySleepDuringPlayback')}</label>
    <p className="muted" id="display-sleep-hint">{t('mobile.displaySleepHint')}</p>
    {(status.error || localError) && <p role="alert">{t('mobile.error')}</p>}
    {!status.ready && status.error && <button onClick={() => setAttempt(value => value + 1)}>{t('mobile.retry')}</button>}
  </section>;
}
