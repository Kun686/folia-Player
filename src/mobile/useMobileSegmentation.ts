import { useEffect, useMemo, useRef, useState } from 'react';
import type { SongResult } from '../types';
import type { LyricSegmentationRecord, LyricSegmentationSource } from '../types/lyricSegmentation';
import { deleteSongSegmentation, loadSongSegmentation, saveSongSegmentation } from '../services/lyricSegmentation';
import { createLyricSegmentationRecord } from '../utils/lyrics/lyricSegmentationRecord';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

// useMobileSegmentation.ts — reuse per-song IndexedDB records without the desktop playback store.
export function useMobileSegmentation(song?: SongResult) {
    const key = song ? getPlaybackSongKey(song) : null;
    const epoch = useMemo(() => ({}), [key]);
    const current = useRef(epoch); current.current = epoch;
    const mounted = useRef(true), locked = useRef(false);
    const [retry, setRetry] = useState(0);
    const [loaded, setLoaded] = useState<{ epoch: object; record: LyricSegmentationRecord | null; error: boolean }>();
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        let active = true;
        if (!song) return;
        void loadSongSegmentation(song, { strict: true }).then(record => {
            if (active && current.current === epoch) setLoaded({ epoch, record, error: false });
        }).catch(() => { if (active && current.current === epoch) setLoaded({ epoch, record: null, error: true }); });
        return () => { active = false; };
        // Metadata hydration does not change the provider-prefixed storage identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [epoch, retry]);
    const ready = loaded?.epoch === epoch && !loaded.error;
    const record = loaded?.epoch === epoch ? loaded.record : null;
    const write = async (next: LyricSegmentationRecord | null) => {
        if (!song || !ready || !mounted.current || current.current !== epoch || locked.current) throw Error('segmentation-unavailable');
        locked.current = true;
        try {
            if (next) await saveSongSegmentation(song, next, { strict: true });
            else await deleteSongSegmentation(song, { strict: true });
            // A write already committed for the old song never replaces the new song's state.
            if (mounted.current && current.current === epoch) setLoaded({ epoch, record: next, error: false });
        } finally { locked.current = false; }
    };
    return {
        record, ready, error: loaded?.epoch === epoch && loaded.error,
        reload: () => { setLoaded(undefined); setRetry(value => value + 1); },
        save: (lines: Record<string, string[]>, source: LyricSegmentationSource) => write(createLyricSegmentationRecord(key ?? '', source, lines)),
        reset: () => write(null),
    };
}
export type MobileSegmentation = ReturnType<typeof useMobileSegmentation>;
