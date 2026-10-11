import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '../types';
import { selectTypographySettingsSnapshot, useTypographySettingsStore } from '../stores/useTypographySettingsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { LYRICS_FONT_SIZE_AUTO_NOTICE_KEYS } from '../utils/typographyControls';
import FontControls from './FontControls';
import TouchRange from './TouchRange';

// TypographyControls.tsx — original global lyric/subtitle settings, with no alternate persistence.
export default function TypographyControls({ theme, onUploading }: { theme: Theme; onUploading(busy: boolean): void }) {
  const { t } = useTranslation();
  const s = useTypographySettingsStore(useShallow(selectTypographySettingsSnapshot));
  const visual = useVisualizerSettingsStore(useShallow(state => ({ mode: state.visualizerMode,
    opacity: state.visualizerOpacity, setOpacity: state.handleSetVisualizerOpacity })));
  const autoSize = LYRICS_FONT_SIZE_AUTO_NOTICE_KEYS[visual.mode];
  return <div className="typography-controls">
    <details><summary>{t('options.previewCommonSettings')}</summary>
      <FontControls theme={theme} onUploading={onUploading} />
      <label>{t('options.fontSize')} · {Math.round(s.lyricsFontScale * 100)}%
        <TouchRange min={0.85} max={1.4} step={0.05} value={s.lyricsFontScale} disabled={!!autoSize}
          onChange={event => s.handleSetLyricsFontScale(Number(event.target.value))} />
      </label>
      {autoSize && <p>{t(autoSize)}</p>}
      <label>{t('options.visualizerOpacity')} · {Math.round(visual.opacity * 100)}%
        <TouchRange min={0.2} max={1} step={0.05} value={visual.opacity}
          onChange={event => visual.setOpacity(Number(event.target.value))} />
      </label>
    </details>
    <details><summary>{t('options.previewSubtitleSettings')}</summary>
      <label className="check-label"><input type="checkbox" checked={s.hidePlayerTranslationSubtitle}
        onChange={event => s.handleToggleHidePlayerTranslationSubtitle(event.target.checked)} />{t('options.hidePlayerTranslationSubtitle')}</label>
      <label>{t('options.subtitleContentMode')}<select aria-label={t('options.subtitleContentMode')} value={s.subtitleContentMode} onChange={event => {
        const mode = event.target.value;
        if (mode === 'translation' || mode === 'romanization' || mode === 'both' || mode === 'none') s.handleSetSubtitleContentMode(mode);
      }}>
        <option value="translation">{t('options.subtitleContentTranslation')}</option>
        <option value="romanization">{t('options.subtitleContentRomanization')}</option>
        <option value="both">{t('options.subtitleContentBoth')}</option>
        <option value="none">{t('options.subtitleContentNone')}</option>
      </select></label>
      <label className="check-label"><input type="checkbox" checked={s.subtitleOverlayBackground}
        onChange={event => s.handleToggleSubtitleOverlayBackground(event.target.checked)} />{t('options.subtitleOverlayBackground')}</label>
      <label className="check-label"><input type="checkbox" checked={s.subtitleUpcomingLyricsBlur}
        onChange={event => s.handleToggleSubtitleUpcomingLyricsBlur(event.target.checked)} />{t('options.subtitleUpcomingLyricsBlur')}</label>
      <label>{t('options.subtitleOverlayOpacity')} · {Math.round(s.subtitleOverlayOpacity * 100)}%
        <TouchRange min={0.2} max={1} step={0.05} value={s.subtitleOverlayOpacity}
          onChange={event => s.handleSetSubtitleOverlayOpacity(Number(event.target.value))} />
      </label>
      <label className="check-label"><input type="checkbox" checked={s.subtitleFontInheritsLyrics}
        onChange={event => s.handleSetSubtitleFontInheritsLyrics(event.target.checked)} />{t('options.subtitleFontInheritsLyrics')}</label>
      <label>{t('options.subtitleFontScale')} · {Math.round(s.subtitleFontScale * 100)}%
        <TouchRange min={0.85} max={1.4} step={0.05} value={s.subtitleFontScale}
          onChange={event => s.handleSetSubtitleFontScale(Number(event.target.value))} />
      </label>
      {!s.subtitleFontInheritsLyrics && <FontControls theme={theme} subtitle />}
      <label className="check-label"><input type="checkbox" checked={s.showHarmonySubtitle}
        onChange={event => s.handleToggleShowHarmonySubtitle(event.target.checked)} />{t('options.showHarmonySubtitle')}</label>
      <label className="check-label"><input type="checkbox" checked={s.harmonySubtitleBackground}
        onChange={event => s.handleToggleHarmonySubtitleBackground(event.target.checked)} />{t('options.harmonySubtitleBackground')}</label>
    </details>
  </div>;
}
