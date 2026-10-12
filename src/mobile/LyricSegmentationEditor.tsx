import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LyricData, StatusMessage, Theme } from '../types';
import LyricSegmentationSurfaceView from '../components/command-palette/surfaces/LyricSegmentationSurfaceView';
import { applyLyricWordSegmentation } from '../utils/lyrics/lyricSegmentationRecord';
import type { MobileSegmentation } from './useMobileSegmentation';
import { native } from './bridge';
import { useMobileSegmentationAI } from './useMobileSegmentationAI';
import AISettingsSheet from './AISettingsSheet';

// LyricSegmentationEditor.tsx — the original editor, with a touch paste box and native clipboard writes.
export default function LyricSegmentationEditor({ lyrics, title, segmentation, theme, light, close, captureGuard, visible }: {
    lyrics: LyricData | null; title: string; segmentation: MobileSegmentation; theme: Theme; light: boolean; close(): void;
    captureGuard(): () => boolean; visible: boolean;
}) {
    const { t } = useTranslation();
    const [source] = useState(lyrics);
    const [draft, setDraft] = useState('');
    const [status, setStatus] = useState<StatusMessage | null>(null);
    const [configuring, setConfiguring] = useState(false);
    const ai = useMobileSegmentationAI(captureGuard, visible && !configuring);
    const preview = useMemo(() => applyLyricWordSegmentation(source, segmentation.record), [source, segmentation.record]);
    if (configuring) return <AISettingsSheet close={() => setConfiguring(false)} />;
    return <div className="sheet-backdrop"><section className="sheet mobile-segmentation" role="dialog" aria-modal="true"
        aria-label={t('commandPalette.commands.lyric-segmentation.title')}>
        <header><h2>{t('commandPalette.commands.lyric-segmentation.title')}</h2><button onClick={() => { ai.cancel(); close(); }}>{t('mobile.close')}</button></header>
        <p>{title}</p>
        <p className="muted">{t('lyricSegmentation.mobileHint')}</p>
        <p className="muted">{t('lyricSegmentation.mobileAiHint')}</p>
        <button onClick={() => { ai.cancel(); setStatus(null); setConfiguring(true); }}>{t('mobile.ai.settings')}</button>
        {segmentation.error ? <><p role="alert">{t('lyricSegmentation.loadFailed')}</p>
            <button onClick={segmentation.reload}>{t('mobile.retry')}</button></>
            : !segmentation.ready ? <p role="status">{t('localMusic.loadingLyrics')}</p>
            : <div className="mobile-segmentation-body"><LyricSegmentationSurfaceView
                isDaylight={light} theme={theme} t={(key, fallback) => t(key, { defaultValue: fallback })} lyrics={preview} record={segmentation.record}
                isAiAvailable={visible} runSegmentation={(lines, options) => { setStatus(null); return ai.run(lines, options); }} formatAiError={error => {
                    const code = error instanceof Error ? error.message : '';
                    return code === 'ai-invalid-response' ? t('lyricSegmentation.mobileAiInvalidResponse')
                        : t(`mobile.ai.${code}`, { defaultValue: t('lyricSegmentation.saveFailed') });
                }} setStatusMsg={setStatus} writeClipboard={text => native.copyText({ text })}
                onSave={async (lines, origin, signal) => {
                    setStatus(null);
                    const current = origin === 'ai' ? ai.isCurrent : captureGuard();
                    await segmentation.save(lines, origin, () => !signal?.aborted && current());
                    setStatus({ type: 'success', text: t('lyricSegmentation.saved') });
                }}
                onReset={async () => { setStatus(null); await segmentation.reset(); setStatus({ type: 'success', text: t('lyricSegmentation.restored') }); }}
                renderImport={(onImport, busy) => <details className="mobile-segmentation-import">
                    <summary>{t('lyricSegmentation.importText')}</summary>
                    <label>{t('lyricSegmentation.pasteLabel')}<textarea rows={4} aria-label={t('lyricSegmentation.pasteLabel')}
                        value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} /></label>
                    <button disabled={busy || !draft.trim()} onClick={() => { setStatus(null); void onImport(draft); }}>{t('lyricSegmentation.applyImport')}</button>
                </details>} />
            </div>}
        {status && <p role="status">{status.text}</p>}
    </section></div>;
}
