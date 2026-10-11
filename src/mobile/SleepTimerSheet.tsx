import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import SleepTimerControl from '../components/command-palette/SleepTimerControl';
import type { Theme } from '../types';
import type { useNativeSleepTimer } from './useNativeSleepTimer';

// SleepTimerSheet.tsx — original timer control and translations, native deadline authority.
export default function SleepTimerSheet({ timer, light, theme, close }: {
  timer: ReturnType<typeof useNativeSleepTimer>; light: boolean; theme: Theme; close: () => void;
}) {
  const { t } = useTranslation();
  const value = timer.value;
  const [zeroDuration, setZeroDuration] = useState(false);
  return <div className="sheet-backdrop"><section className="sheet sleep-timer-sheet" role="dialog" aria-modal="true" aria-label={t('commandPalette.sleepTimerTitle')}>
    <header><h2>{t('commandPalette.sleepTimerTitle')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
    <fieldset disabled={!value}>
      <SleepTimerControl isDaylight={light} theme={theme} enabled={value?.enabled ?? false} hours={value?.hours ?? 0}
        minutes={value?.minutes ?? 0} deadlineMs={value?.deadlineMs ?? null}
        queryFeedback={zeroDuration ? { isError: true, text: t('commandPalette.sleepTimerDurationRequired') }
          : timer.error ? { isError: true, text: t('mobile.error') } : null}
        onEnabledChange={enabled => {
          if (enabled && !value?.hours && !value?.minutes) { setZeroDuration(true); return; }
          setZeroDuration(false); timer.change({ enabled });
        }} onHoursChange={hours => { setZeroDuration(false); timer.change({ hours }); }}
        onMinutesChange={minutes => { setZeroDuration(false); timer.change({ minutes }); }} />
    </fieldset>
    {timer.error && <button onClick={timer.refresh}>{t('mobile.retry')}</button>}
  </section></div>;
}
