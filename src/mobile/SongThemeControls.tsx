import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MobileTheme } from './useMobileTheme';

// SongThemeControls.tsx — existing song-theme switching preference and explicit apply actions on the mobile settings surface.
export default function SongThemeControls({ appearance }: { appearance: MobileTheme }) {
  const { t } = useTranslation(), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const act = async (work: () => unknown) => {
    setError(false); setBusy(true);
    try { await work(); } catch { setError(true); } finally { setBusy(false); }
  };
  const { cached } = appearance;
  return <fieldset className="mobile-song-theme" disabled={busy}>
    <label className="check-label"><input type="checkbox" checked={appearance.autoSwitch}
      onChange={event => void act(() => appearance.setAutoSwitch(event.target.checked))} />{t('mobile.themeAutoSwitch')}</label>
    <p>{appearance.loading ? t('mobile.loading') : cached.kind === 'none' ? t('mobile.themeSongEmpty')
      : t('mobile.themeSongSaved', { name: cached.kind === 'dual' ? cached.theme.dark.name : cached.theme.name })}</p>
    <div className="actions"><button disabled={appearance.loading || cached.kind === 'none' || appearance.error}
      onClick={() => void act(appearance.applySong)}>{t('mobile.themeApplySong')}</button>
      <button onClick={() => void act(() => appearance.select(false))}>{t('mobile.themeDefault')}</button></div>
    {(appearance.error || error) && <p role="alert">{t('mobile.themeReadError')} <button onClick={() => { setError(false); appearance.retry(); }}>{t('mobile.retry')}</button></p>}
  </fieldset>;
}
