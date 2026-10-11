import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LyricData, StatusMessage, Theme } from '../types';
import LyricSegmentationSurfaceView from '../components/command-palette/surfaces/LyricSegmentationSurfaceView';
import { applyLyricWordSegmentation } from '../utils/lyrics/lyricSegmentationRecord';
import type { MobileSegmentation } from './useMobileSegmentation';
import { native } from './bridge';

// LyricSegmentationEditor.tsx — the original editor, with a touch paste box and native clipboard writes.
export default function LyricSegmentationEditor({ lyrics, title, segmentation, theme, light, close }: {
    lyrics: LyricData | null; title: string; segmentation: MobileSegmentation; theme: Theme; light: boolean; close(): void;
}) {
    const { t } = useTranslation();
    const [source] = useState(lyrics);
    const [draft, setDraft] = useState('');
    const [status, setStatus] = useState<StatusMessage | null>(null);
    const preview = useMemo(() => applyLyricWordSegmentation(source, segmentation.record), [source, segmentation.record]);
    return <div className="sheet-backdrop"><section className="sheet mobile-segmentation" role="dialog" aria-modal="true"
        aria-label={t('commandPalette.commands.lyric-segmentation.title')}>
        <header><h2>{t('commandPalette.commands.lyric-segmentation.title')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
        <p>{title}</p>
        <p className="muted">{t('lyricSegmentation.mobileHint')}</p>
        {segmentation.error ? <><p role="alert">{t('lyricSegmentation.loadFailed')}</p>
            <button onClick={segmentation.reload}>{t('mobile.retry')}</button></>
            : !segmentation.ready ? <p role="status">{t('localMusic.loadingLyrics')}</p>
            : <div className="mobile-segmentation-body"><LyricSegmentationSurfaceView
                isDaylight={light} theme={theme} t={(key, fallback) => t(key, { defaultValue: fallback })} lyrics={preview} record={segmentation.record}
                isAiAvailable={false} setStatusMsg={setStatus} writeClipboard={text => native.copyText({ text })}
                onSave={async (lines, origin) => { setStatus(null); await segmentation.save(lines, origin); setStatus({ type: 'success', text: t('lyricSegmentation.saved') }); }}
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
