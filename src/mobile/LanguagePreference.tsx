import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppLanguagePreference } from '../i18n/config';
import { useSettingsModalStore } from '../stores/useSettingsModalStore';
import MobileSelect from './MobileSelect';

// LanguagePreference.tsx — original language state and persistence through a touch-friendly select.
const languageKeys = {
  system: 'options.appLanguageSystem', 'zh-CN': 'options.appLanguageZhCN',
  en: 'options.appLanguageEnUS', in: 'options.appLanguageInID',
} satisfies Record<AppLanguagePreference, string>;

export default function LanguagePreference() {
  const { t } = useTranslation();
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
  return <section className="mobile-preference" aria-label={t('options.languageSettings')}>
    <label className="preference-row"><span>{t('options.appLanguage')}</span>
      <MobileSelect value={preference} disabled={busy}
        onChange={event => void change(event.target.value)}>
        {Object.entries(languageKeys).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
      </MobileSelect>
    </label>
    {failed && <p role="alert">{t('mobile.error')}</p>}
  </section>;
}
