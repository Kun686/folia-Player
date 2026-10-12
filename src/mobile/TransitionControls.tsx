import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TransitionSettingsSection from '../components/modal/settings/TransitionSettingsSection';
import { connectTransitionSettings } from './transitionSettingsSync';
import type { Theme } from '../types';
import { useNativeModels } from './useNativeModels';
import ModelControls from './ModelControls';

// src/mobile/TransitionControls.tsx — original transition section backed by native playback settings.
export default function TransitionControls({ light, theme, open, setOpen }: {
  light: boolean; theme: Theme; open: boolean; setOpen: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState({ ready: false, error: false });
  const [attempt, setAttempt] = useState(0);
  const models = useNativeModels(open);
  useEffect(() => connectTransitionSettings((ready, error) => setStatus({ ready, error })), [attempt]);
  return open ? <div className="sheet-backdrop"><section className="sheet visual-settings transition-settings" role="dialog"
      aria-modal="true" aria-label={t('options.transitionSettings')}>
      <header><h2>{t('options.transitionSettings')}</h2><button onClick={() => setOpen(false)}>{t('mobile.close')}</button></header>
      {status.error && <p role="alert">{t('mobile.transitionSettingsError')}</p>}
      {!status.ready && status.error && <button onClick={() => setAttempt(value => value + 1)}>{t('mobile.retry')}</button>}
      {!status.ready && !status.error && <p role="status">{t('mobile.loading')}</p>}
      <fieldset disabled={!status.ready}>
        <TransitionSettingsSection isDaylight={light} theme={theme} settingsCardClass="border-current/15"
          analysisAvailable={models.state?.analysisAvailable ?? false} capabilityOverride={models.state?.capabilities}
          availabilityText={{ engine: t('mobile.models.engine'), performance: t('mobile.models.performance'), cache: t('mobile.models.cache') }}
          analysisUnavailableMessage={t('mobile.transitionAnalysisUnavailable')} />
      </fieldset>
      <ModelControls models={models} light={light} />
    </section></div> : null;
}
