import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MobileTheme } from './useMobileTheme';
import type { MobileThemeGeneration } from './useMobileThemeGeneration';

// ThemeGenerationControls.tsx — original per-song AI/cover generation and opt-in automatic policy on the touch surface.
export default function ThemeGenerationControls({ appearance, generation, configure }: {
  appearance: MobileTheme; generation: MobileThemeGeneration; configure: () => void;
}) {
  const { t } = useTranslation(), [error, setError] = useState(false);
  const change = (work: () => void) => { try { work(); setError(false); } catch { setError(true); } };
  return <fieldset className="mobile-theme-generation"><legend>{t('mobile.ai.generation')}</legend>
    <label>{t('mobile.ai.source')}<select value={appearance.generationSource}
      onChange={e => change(() => appearance.configureGeneration({ source: e.target.value as 'ai' | 'cover' }))}>
      <option value="ai">{t('mobile.ai.fromLyrics')}</option><option value="cover">{t('mobile.ai.fromCover')}</option></select></label>
    <label className="check-label"><input type="checkbox" checked={appearance.autoGenerate}
      onChange={e => change(() => appearance.configureGeneration({ enabled: e.target.checked }))} />{t('mobile.ai.autoGenerate')}</label>
    <p className="muted">{t('mobile.ai.autoHint')}</p>
    <div className="actions"><button disabled={!generation.ready || generation.busy} onClick={() => void generation.generate()}>{t('mobile.ai.generate')}</button>
      {generation.busy && <button onClick={generation.cancel}>{t('mobile.cancel')}</button>}
      <button onClick={configure}>{t('mobile.ai.settings')}</button></div>
    {generation.busy && <p role="status">{t('mobile.ai.generating')}</p>}
    {generation.status && <p role={['applied', 'fallback', 'savedPinned', 'ai-cancelled'].includes(generation.status) ? 'status' : 'alert'}>{t('mobile.ai.' + generation.status)}</p>}
    {error && <p role="alert">{t('mobile.themeReadError')}</p>}
  </fieldset>;
}
