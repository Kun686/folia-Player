import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatusMessage, Theme } from '../types';
import LyricExportSurfaceView from '../components/command-palette/surfaces/LyricExportSurfaceView';
import { exportMobileBatchLyrics } from './batchLyricExport';

// BatchLyricExportDialog.tsx — original batch export surface in the existing mobile sheet.
export default function BatchLyricExportDialog({ theme, light, close }: { theme: Theme; light: boolean; close(): void }) {
    const { t } = useTranslation();
    const [message, setMessage] = useState<StatusMessage | null>(null);
    const [warnings, setWarnings] = useState(0);
    const [specificError, setSpecificError] = useState<string>();
    const execute: typeof exportMobileBatchLyrics = async (...args) => {
        setMessage(null); setWarnings(0); setSpecificError(undefined);
        try {
            const result = await exportMobileBatchLyrics(...args);
            setWarnings(result.archive?.manifest.exported.filter(entry => entry.warnings?.length).length ?? 0);
            return result;
        } catch (error) {
            if (error instanceof Error && error.message === 'lyric-archive-too-large') {
                setSpecificError(t('lyricExport.mobileTooLarge'));
            }
            throw error;
        }
    };
    return <div className="sheet-backdrop"><section className="sheet mobile-batch-lyrics" role="dialog" aria-modal="true"
        aria-label={t('lyricExport.settingsEntry')}>
        <header><h2>{t('lyricExport.settingsEntry')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
        <LyricExportSurfaceView isDaylight={light} theme={theme} settingsCardClass="" toggleOffBackgroundClass="bg-white/10"
            execute={execute} onStatus={setMessage} closeHint={t('lyricExport.mobileCloseCancels')} />
        {message && <p className="batch-feedback" role={message.type === 'error' ? 'alert' : 'status'}>{specificError ?? message.text}</p>}
        {warnings > 0 && <p className="batch-feedback" role="status">{t('lyricExport.mobileLegacy', { count: warnings })}</p>}
    </section></div>;
}
