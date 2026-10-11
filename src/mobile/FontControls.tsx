import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '../types';
import { selectTypographySettingsSnapshot, useTypographySettingsStore } from '../stores/useTypographySettingsStore';
import FontFallbackStackControl from '../components/visualizer/FontFallbackStackControl';
import { FONT_WEIGHT_STEP, MAX_FONT_WEIGHT, MIN_FONT_WEIGHT } from '../utils/fontStacks';
import { FONT_STYLE_OPTIONS } from '../utils/typographyControls';

// FontControls.tsx — native touch inputs for the original font store and uploaded-font service.
export default function FontControls({ theme, subtitle = false, onUploading }: { theme: Theme; subtitle?: boolean; onUploading?(busy: boolean): void }) {
  const { t } = useTranslation();
  const s = useTypographySettingsStore(useShallow(selectTypographySettingsSnapshot));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const weight = subtitle ? s.subtitleFontWeight : s.lyricsFontWeight;
  const lastWeight = useRef(weight ?? 400);
  if (weight !== null) lastWeight.current = weight;
  const setWeight = subtitle ? s.handleSetSubtitleFontWeight : s.handleSetLyricsFontWeight;
  const font = subtitle ? s.subtitleFontFamily : s.lyricsCustomFont?.label;
  const upload = async (file: File) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onUploading?.(true); setError('');
    try {
      const result = await s.handleUploadLyricsCustomFont(file);
      if (!result.ok) setError(result.error || t('options.uploadFontFailed'));
    } catch { setError(t('options.uploadFontFailed')); }
    finally { lock.current = false; setBusy(false); onUploading?.(false); }
  };
  return <fieldset className="font-controls" disabled={busy}>
    <label>{t(subtitle ? 'options.subtitleFontFamily' : 'options.fontFamily')}
      <select aria-label={t(subtitle ? 'options.subtitleFontFamily' : 'options.fontFamily')}
        value={font ? 'custom' : subtitle ? s.subtitleFontStyle : s.lyricsFontStyle} onChange={event => {
        const option = FONT_STYLE_OPTIONS.find(item => item.value === event.target.value);
        if (!option) return;
        if (subtitle) { s.handleSetSubtitleFontFamily(null); s.handleSetSubtitleFontStyle(option.value); }
        else { s.handleSetLyricsCustomFont(null); s.handleSetLyricsFontStyle(option.value); s.handleSetLyricsFontWeight(null); }
        setError('');
      }}>
        {FONT_STYLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
        {font && <option value="custom">{font}</option>}
      </select>
    </label>
    {!subtitle && <>
      <button type="button" onClick={() => input.current?.click()}>{t(busy ? 'options.uploadingCustomFont' : 'options.uploadCustomFont')}</button>
      {/* Leave document types open on iOS; the original loader validates extension/MIME, size and actual FontFace bytes. */}
      <input ref={input} type="file" hidden aria-label={t('options.uploadCustomFont')} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file) void upload(file);
      }} />
      <p>{t('options.uploadCustomFontDesc')}</p>
      {s.lyricsCustomFont && <button type="button" onClick={() => { s.handleSetLyricsCustomFont(null); s.handleSetLyricsFontWeight(null); setError(''); }}>{t('options.clearSystemFont')}</button>}
    </>}
    {subtitle && <label>{t('options.subtitlePrimaryFont')}
      <input type="text" value={s.subtitleFontFamily ?? ''} autoCapitalize="none" autoCorrect="off"
        placeholder={t('options.subtitlePrimaryFontPlaceholder')} onChange={event => s.handleSetSubtitleFontFamily(event.target.value)} />
    </label>}
    <FontFallbackStackControl label={t(subtitle ? 'options.subtitleFontFallbackFamilies' : 'options.fontFallbackFamilies')}
      value={subtitle ? s.subtitleFontFallbackFamilies : s.lyricsFontFallbackFamilies}
      onChange={subtitle ? s.handleSetSubtitleFontFallbackFamilies : s.handleSetLyricsFontFallbackFamilies}
      theme={theme} placeholder={t(subtitle ? 'options.subtitleFontFallbackFamiliesPlaceholder' : 'options.fontFallbackFamiliesPlaceholder')} />
    <label className="check-label"><input type="checkbox" checked={weight === null}
      onChange={event => setWeight(event.target.checked ? null : lastWeight.current)} />{t('options.fontWeightAuto')}</label>
    {weight !== null && <label>{t(subtitle ? 'options.subtitleFontWeight' : 'options.fontWeight')} · {weight}
      <input type="range" min={MIN_FONT_WEIGHT} max={MAX_FONT_WEIGHT} step={FONT_WEIGHT_STEP} value={weight}
        onChange={event => setWeight(Number(event.target.value))} />
    </label>}
    {busy && <p role="status">{t('options.uploadingCustomFont')}</p>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
