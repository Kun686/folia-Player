import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { native } from './bridge';
import { importMobileLocalLyrics } from './localLyricImport';
import LocalLyricSourceSelector from '../components/panelTab/LocalLyricSourceSelector';
import { localLyricsFromSnapshot, type LocalLyricSnapshot } from '../utils/lyrics/localLyricSnapshot';
import { selectLocalSongLyricsSource } from '../utils/lyrics/localSongLyricsSelection';

// LocalLyricTools.tsx — original source controls backed by atomic native snapshots, scoped to one mounted song.
export default function LocalLyricTools({ id, light, onDone }: { id: string; light: boolean; onDone(): void }) {
    const { t } = useTranslation();
    const [snapshot, setSnapshot] = useState<LocalLyricSnapshot>();
    const [error, setError] = useState(false), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
    const active = useRef(false), locked = useRef(false);
    useEffect(() => {
        let mounted = true; active.current = true; setError(false);
        void native.readLocalLyrics({ id }).then(value => { if (mounted) setSnapshot(value); })
            .catch(() => { if (mounted) setError(true); });
        return () => { mounted = false; active.current = false; };
    }, [id, retry]);
    const run = async (work: () => Promise<boolean>) => {
        if (locked.current) return;
        locked.current = true; setBusy(true); setError(false);
        try { if (await work() && active.current) onDone(); }
        catch { if (active.current) setError(true); }
        finally { locked.current = false; if (active.current) setBusy(false); }
    };
    const song = snapshot && localLyricsFromSnapshot(snapshot);
    const sources = [
        ...(song?.hasLocalLyrics ? [{ key: 'local' as const, label: t('localMusic.statusLocal') }] : []),
        ...(song?.hasEmbeddedLyrics ? [{ key: 'embedded' as const, label: t('localMusic.statusEmbedded') }] : []),
    ];
    return <div className="mobile-local-lyrics">
        <fieldset disabled={!snapshot || busy}>
            <legend>{t('localMusic.lyricsSource')}</legend>
            <LocalLyricSourceSelector sources={sources} active={song ? selectLocalSongLyricsSource(song, 'local') : null}
                isDaylight={light} onChange={source => {
                    if (!snapshot || source === 'online') return;
                    void run(async () => {
                        await native.selectLocalLyrics({ id, token: snapshot.token, source });
                        return true;
                    });
                }} />
            {snapshot?.fileName && <p className="muted">{snapshot.fileName}</p>}
            <button onClick={() => void run(() => importMobileLocalLyrics(id, () => active.current))}>{t('mobile.importLyrics')}</button>
        </fieldset>
        {(!snapshot && !error || busy) && <p role="status">{t('localMusic.loadingLyrics')}</p>}
        {error && <p role="alert">{t('mobile.lyricEditError')}</p>}
        {error && !snapshot && <button onClick={() => setRetry(value => value + 1)}>{t('mobile.retry')}</button>}
    </div>;
}
