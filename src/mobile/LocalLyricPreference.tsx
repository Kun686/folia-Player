import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { connectLyricSettings } from './lyricSettingsSync';
import { isNative } from './bridge';

// LocalLyricPreference.tsx — mounted sync survives closing settings; source labels and actions are original.
export function useLocalLyricPreference() {
  const [status, setStatus] = useState({ ready: false, error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (isNative) return connectLyricSettings((ready, error) => setStatus({ ready, error }));
  }, [attempt]);
  return { ...status, retry: () => setAttempt(value => value + 1) };
}
export default function LocalLyricPreference({ status }: { status: ReturnType<typeof useLocalLyricPreference> }) {
  const { t } = useTranslation();
  const priority = useLyricSettingsStore(s => s.localLyricsPriority);
  return <section aria-label={t('options.localLyricsPriority')}>
    <label>{t('options.localLyricsPriority')}
      <select disabled={!status.ready} value={priority} aria-describedby="local-lyrics-priority-hint" onChange={event => {
        if (event.target.value === 'local' || event.target.value === 'online') useLyricSettingsStore.getState().handleSetLocalLyricsPriority(event.target.value);
      }}>
        <option value="local">{t('options.localLyricsPriorityLocal')}</option>
        <option value="online">{t('options.localLyricsPriorityOnline')}</option>
      </select>
    </label>
    <p className="muted" id="local-lyrics-priority-hint">{t('options.localLyricsPriorityDesc')}</p>
    {status.error && <p role="alert">{t('mobile.lyricSettingsError')}</p>}
    {!status.ready && status.error && <button onClick={status.retry}>{t('mobile.retry')}</button>}
  </section>;
}
