import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import MobileSelect from './MobileSelect';

// QueuePreference.tsx — reuse the original persisted insertion preference for foreground queue actions.
export default function QueuePreference() {
  const { t } = useTranslation();
  const behavior = useAudioSettingsStore(state => state.queueAddBehavior);
  const [failed, setFailed] = useState(false);
  return <section className="mobile-preference" aria-label={t('options.queueSettings')}>
    <label className="preference-row"><span>{t('options.queueDefaultBehavior')}</span>
      <MobileSelect value={behavior} onChange={event => {
        const value = event.target.value;
        if (value !== 'append' && value !== 'next') return;
        try { useAudioSettingsStore.getState().handleSetQueueAddBehavior(value); setFailed(false); }
        catch { setFailed(true); }
      }}>
        <option value="append">{t('options.queueAppendLabel')}</option>
        <option value="next">{t('options.queueNextLabel')}</option>
      </MobileSelect>
    </label>
    {failed && <p role="alert">{t('mobile.error')}</p>}
  </section>;
}
