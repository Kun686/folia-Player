import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ThemeParkColorPanel from '../components/modal/theme-park/ThemeParkColorPanel';
import ThemeParkDetailsPanel from '../components/modal/theme-park/ThemeParkDetailsPanel';
import ThemeParkContentPanel from '../components/modal/theme-park/ThemeParkContentPanel';
import ThemeParkAiPanel from '../components/modal/theme-park/ThemeParkAiPanel';
import { useThemeParkDraft } from '../components/modal/theme-park/useThemeParkDraft';
import { isDualThemeNameValid, type ThemeParkTab } from '../components/modal/theme-park/themeParkDraft';
import { normalizeThemeHexColor } from '../services/themeSanitizer';
import { BASE_DUAL_THEME } from '../services/baseThemes';
import { buildRecommendedColors } from '../utils/themeEditorPalette';
import type { MobileTheme } from './useMobileTheme';
import MobileThemePreview from './MobileThemePreview';
import { native } from './bridge';

// MobileThemeEditor.tsx — original Theme Park draft, panels and JSON workflow inside the existing mobile sheet.
export interface MobileThemeSource { promptSourceText: string | null; songTitle: string | undefined; isPureMusic: boolean }
const tabs: ThemeParkTab[] = ['colors', 'details', 'content', 'ai'];
const labels = { colors: 'theme.tabColors', details: 'theme.tabDetails', content: 'theme.tabContent', ai: 'theme.tabAi' };
export default function MobileThemeEditor({ appearance, light, visible, source, close }: {
  appearance: MobileTheme; light: boolean; visible: boolean; source: MobileThemeSource; close(): void;
}) {
  const { t } = useTranslation(), [tab, setTab] = useState<ThemeParkTab>('colors');
  const [preview, setPreview] = useState(false), [error, setError] = useState(false);
  // The editor is a global custom-theme session, not a per-song AI cache write.
  const draft = useThemeParkDraft({ aiTheme: null, customTheme: appearance.custom, bgMode: 'custom',
    seedTheme: appearance.theme, isDaylight: light, defaultCustomTheme: BASE_DUAL_THEME });
  const colors = useMemo(() => buildRecommendedColors(draft.baseTheme, []), [draft.baseTheme]);
  const save = () => {
    if (!isDualThemeNameValid(draft.draft)) return;
    try { appearance.save(draft.buildFinalTheme()); close(); }
    catch { setError(true); }
  };
  return <div className="sheet-backdrop"><section className="sheet mobile-theme-editor" role="dialog" aria-modal="true" aria-label={t('mobile.themeEditor')}>
    <header><h2>{t('mobile.themeEditor')}</h2><button onClick={close}>{t('mobile.cancel')}</button></header>
    <div className="actions theme-editor-actions"><button onClick={draft.reset}>{t('ui.resetToDefaultTheme')}</button>
      <button disabled={!isDualThemeNameValid(draft.draft)} onClick={save}>{t('options.saveAndApplyCustomTheme')}</button></div>
    {error && <p role="alert">{t('mobile.themeSaveError')}</p>}
    <details onToggle={event => setPreview(event.currentTarget.open)}><summary>{t('mobile.themePreview')}</summary>
      <p>{t('mobile.themePreviewHint')}</p>
      {preview && visible && <MobileThemePreview theme={draft.safeDraft[draft.mode]} mode={draft.mode} />}
    </details>
    <nav className="theme-editor-tabs" aria-label={t('mobile.themeEditorSections')}>
      {tabs.map(value => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{t(labels[value])}</button>)}
    </nav>
    {tab === 'colors' && <ThemeParkColorPanel mode={draft.mode} onModeChange={draft.setMode} activeColorKey={draft.activeColorKey}
      onActiveColorKeyChange={draft.setActiveColorKey} safeDraft={draft.safeDraft} rawColorValue={draft.draft[draft.mode][draft.activeColorKey]}
      recommendedColors={colors} isDaylight={light} onColorDrag={draft.updateColorThrottled} onColorPick={draft.updateColorInstant}
      onHexInput={value => draft.updateModeField({ [draft.activeColorKey]: value })}
      onHexCommit={() => draft.updateModeField({ [draft.activeColorKey]: normalizeThemeHexColor(draft.draft[draft.mode][draft.activeColorKey], draft.baseTheme[draft.mode][draft.activeColorKey]) })} />}
    {tab === 'details' && <ThemeParkDetailsPanel draft={draft.draft} onFieldChange={(mode, patch) => draft.updateModeField(patch, mode)} />}
    {tab === 'content' && <ThemeParkContentPanel wordColors={draft.draft.dark.wordColors ?? []} lyricsIcons={draft.draft.dark.lyricsIcons ?? []}
      accentColor={draft.safeDraft[draft.mode].accentColor} onWordColorsChange={wordColors => draft.updateSharedField({ wordColors })}
      onLyricsIconsChange={lyricsIcons => draft.updateSharedField({ lyricsIcons })} />}
    {tab === 'ai' && <ThemeParkAiPanel {...source} buildFinalTheme={draft.buildFinalTheme} fallbackTheme={draft.baseTheme}
      onImportTheme={draft.replaceDraft} writeClipboard={text => native.copyText({ text })} maxInputLength={200_000} />}
  </section></div>;
}
