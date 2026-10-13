import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { LYRIC_MATCH_SOURCES } from '../utils/lyrics/lyricMatchSources';
import { getLyricProviderPreferenceLabel } from '../utils/lyrics/lyricSourceLabels';
import { isLyricProviderSource } from '../utils/lyrics/sourcePriority';

// OnlineLyricPreference.tsx — touch access to the original automatic matching settings and persistence.
export default function OnlineLyricPreference() {
  const { t } = useTranslation();
  const enabled = useLyricSettingsStore(state => state.autoUseBestLyric);
  const source = useLyricSettingsStore(state => state.preferredAlternativeLyricSource);
  const [failed, setFailed] = useState(false);
  const save = (action: () => void) => {
    try { action(); setFailed(false); }
    catch { setFailed(true); }
  };
  return <section className="mobile-preference" aria-label={t('options.autoUseBestLyric')}>
    <button aria-pressed={enabled} aria-describedby="auto-lyrics-hint" className={enabled ? 'solid' : undefined}
      onClick={() => save(() => useLyricSettingsStore.getState().handleToggleAutoUseBestLyric(!enabled))}>
      {t('options.autoUseBestLyric')}
    </button>
    <p className="muted" id="auto-lyrics-hint">{t('options.autoUseBestLyricDesc')}</p>
    <label>{t('settings.lyricMatchPriority')}
      <select value={source} aria-describedby="online-lyrics-priority-hint" onChange={event => {
        const value = event.target.value;
        if (isLyricProviderSource(value)) save(() => useLyricSettingsStore.getState().handleSetPreferredAlternativeLyricSource(value));
      }}>
        {LYRIC_MATCH_SOURCES.map(value => <option key={value} value={value}>{getLyricProviderPreferenceLabel(value)}</option>)}
      </select>
    </label>
    <p className="muted" id="online-lyrics-priority-hint">{t('settings.lyricMatchPriorityDesc')}</p>
    {failed && <p role="alert">{t('mobile.lyricSettingsError')}</p>}
  </section>;
}
