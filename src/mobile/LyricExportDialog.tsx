import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LyricData, SongResult, Theme } from '../types';
import type { LyricExportFormat } from '../services/lyricExport/types';
import { hasExportableLyrics } from '../utils/lyrics/exportableLyrics';
import LyricFileDialog from '../components/panelTab/LyricFileDialog';
import BatchLyricExportDialog from './BatchLyricExportDialog';

// LyricExportDialog.tsx — keep the original format tiles; the native share sheet owns file delivery.
export default function LyricExportDialog({ song, lyrics, light, theme, close }: {
    song: SongResult; lyrics: LyricData | null; light: boolean; theme: Theme; close(): void;
}) {
    const { t } = useTranslation();
    const mounted = useRef(true), locked = useRef(false);
    const [busy, setBusy] = useState(false);
    const [batch, setBatch] = useState(false);
    const [result, setResult] = useState<'exported' | 'cancelled' | 'empty' | 'failed' | null>(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const dismiss = () => { mounted.current = false; close(); };
    const run = async (format: LyricExportFormat) => {
        if (locked.current) return;
        locked.current = true; setBusy(true); setResult(null);
        try {
            const { exportMobileSongLyrics } = await import('./lyricExport');
            if (!mounted.current) return;
            const value = await exportMobileSongLyrics(song, format, () => mounted.current);
            if (mounted.current) setResult(value);
        } catch { if (mounted.current) setResult('failed'); }
        finally { locked.current = false; if (mounted.current) setBusy(false); }
    };
    if (batch) return <BatchLyricExportDialog theme={theme} light={light} close={() => setBatch(false)} />;
    return <LyricFileDialog isOpen onClose={dismiss} isDaylight={light} maxWidthClass="max-w-md mobile-lyric-file-dialog"
        canExportCurrent={hasExportableLyrics(lyrics)} isExporting={busy} onExportCurrent={format => void run(format)}
        onOpenBatchExport={() => { if (!locked.current) setBatch(true); }} batchDescription={t('lyricExport.mobileBatchDesc')}
        feedback={<>
            {busy && <p role="status">{t('lyricExport.phasePackage')}</p>}
            {result && <p role={result === 'failed' ? 'alert' : 'status'}>{t(`lyricExport.${result}`)}</p>}
            <button type="button" onClick={dismiss}>{t('mobile.close')}</button>
        </>} />;
}
