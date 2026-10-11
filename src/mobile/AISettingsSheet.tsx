import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeOpenAIChatCompletionsUrl, resolveOpenAICompatibleModel } from '../../shared/aiResponseClient.mjs';
import { native } from './bridge';
import type { NativeAISettings, NativeAISettingsEdit } from './nativeAI';

// AISettingsSheet.tsx — touch configuration for the original providers; keys are write-only and never enter visual exports.
export default function AISettingsSheet({ close }: { close: () => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<NativeAISettings>();
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [url, setURL] = useState(''), [model, setModel] = useState(''), [temperature, setTemperature] = useState('0.7');
  const [stream, setStream] = useState(false), [key, setKey] = useState(''), [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(true), [error, setError] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0);
  const populate = (value: NativeAISettings) => {
    setSettings(value); setProvider(value.provider); setURL(value.openai.apiURL); setModel(value.openai.model);
    setTemperature(String(value.openai.temperature)); setStream(value.openai.stream); setKey(''); setClearKey(false);
  };
  useEffect(() => {
    let active = true; setBusy(true); setError(false);
    void native.getAISettings().then(value => { if (active) populate(value); })
      .catch(() => { if (active) setError(true); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [reload]);
  const save = async () => {
    if (!settings || busy) return;
    setBusy(true); setError(false); setSaved(false);
    try {
      const credentials = clearKey ? { apiKey: '' } : key.trim() ? { apiKey: key } : {};
      const apiURL = normalizeOpenAIChatCompletionsUrl(url), numeric = Number(temperature);
      if (provider === 'openai' && (!temperature.trim() || !Number.isFinite(numeric) || numeric < 0 || numeric > 2)) throw Error('invalid');
      const edit: NativeAISettingsEdit = provider === 'gemini' ? { provider, ...credentials }
        : { provider, ...credentials, apiURL, model: resolveOpenAICompatibleModel(apiURL, model), temperature: numeric, stream };
      const result = await native.setAISettings({ revision: settings.revision, settings: edit });
      populate(result); setSaved(true);
      window.dispatchEvent(new Event('folia-ai-settings-changed'));
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true" aria-label={t('mobile.ai.settings')}>
    <header><h2>{t('mobile.ai.settings')}</h2><button disabled={busy} onClick={close}>{t('mobile.close')}</button></header>
    <p>{t('mobile.ai.privacy')}</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy || !settings}>
      <label>{t('mobile.ai.provider')}<select value={provider} onChange={event => {
        setProvider(event.target.value as 'gemini' | 'openai'); setKey(''); setClearKey(false); setSaved(false);
      }}><option value="gemini">Google Gemini</option><option value="openai">OpenAI Compatible</option></select></label>
      {provider === 'openai' && <>
        <label>{t('mobile.ai.url')}<input type="url" autoCapitalize="none" autoCorrect="off" value={url} maxLength={2048} onChange={e => setURL(e.target.value)} /></label>
        <p className="muted">{t('mobile.ai.originHint')}</p>
        <label>{t('mobile.ai.model')}<input autoCapitalize="none" autoCorrect="off" value={model} maxLength={200} onChange={e => setModel(e.target.value)} /></label>
        <label>{t('mobile.ai.temperature')}<input type="number" min="0" max="2" step="0.1" inputMode="decimal" value={temperature} onChange={e => setTemperature(e.target.value)} /></label>
        <label className="check-label"><input type="checkbox" checked={stream} onChange={e => setStream(e.target.checked)} />{t('mobile.ai.stream')}</label>
      </>}
      <p>{t(settings?.[provider].hasKey ? 'mobile.ai.keySaved' : 'mobile.ai.keyMissing')}</p>
      <label>API Key<input type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" maxLength={8192} disabled={clearKey}
        value={key} onChange={e => setKey(e.target.value)} placeholder={t('mobile.ai.keyHint')} /></label>
      <label className="check-label"><input type="checkbox" disabled={!settings?.[provider].hasKey} checked={clearKey}
        onChange={e => { setClearKey(e.target.checked); setKey(''); }} />{t('mobile.ai.clearKey')}</label>
      <button className="solid" type="submit">{t(busy ? 'mobile.loading' : 'mobile.ai.save')}</button>
    </fieldset></form>
    {error && <p role="alert">{t('mobile.ai.settingsError')} <button disabled={busy} onClick={() => { setSettings(undefined); setReload(v => v + 1); }}>{t('mobile.ai.reload')}</button></p>}
    {saved && <p role="status">{t('mobile.ai.saved')}</p>}
  </section></div>;
}
