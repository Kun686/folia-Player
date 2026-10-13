import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppLanguagePreference } from '../i18n/config';
import { useSettingsModalStore } from '../stores/useSettingsModalStore';

// LanguagePreference.tsx — original language state and persistence through a touch-friendly select.
const languageKeys = {
  system: 'options.appLanguageSystem', 'zh-CN': 'options.appLanguageZhCN',
  en: 'options.appLanguageEnUS', in: 'options.appLanguageInID',
} satisfies Record<AppLanguagePreference, string>;

export default function LanguagePreference() {
  const { t, i18n } = useTranslation();
  const preference = useSettingsModalStore(state => state.appLanguagePreference);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const locked = useRef(false);
  const change = async (value: string) => {
    if (locked.current || !Object.hasOwn(languageKeys, value)) return;
    locked.current = true; setBusy(true); setFailed(false);
    try { await useSettingsModalStore.getState().handleSetAppLanguagePreference(value as AppLanguagePreference); }
    catch { setFailed(true); }
    finally { locked.current = false; setBusy(false); }
  };
  const resolvedKey = languageKeys[i18n.resolvedLanguage as AppLanguagePreference] ?? languageKeys.en;
  return <section className="mobile-preference" aria-label={t('options.languageSettings')}>
    <label>{t('options.appLanguage')}
      <select value={preference} disabled={busy} aria-describedby="language-preference-hint"
        onChange={event => void change(event.target.value)}>
        {Object.entries(languageKeys).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
      </select>
    </label>
    <p className="muted" id="language-preference-hint">{preference === 'system'
      ? t('options.appLanguageSystemHint', { language: t(resolvedKey) }) : t('options.appLanguageDesc')}</p>
    {failed && <p role="alert">{t('mobile.error')}</p>}
  </section>;
}
