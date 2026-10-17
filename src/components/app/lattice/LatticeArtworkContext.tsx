import { createContext, useContext, useEffect, useState } from 'react';
import type { SongResult } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import type { createLatticeArtworkSource } from './latticeArtworkSource';

// LatticeArtworkContext.tsx — optional host artwork transport; desktop keeps its existing CDN size ladder.
export const LatticeArtworkContext = createContext<ReturnType<typeof createLatticeArtworkSource> | null>(null);
export function useLatticeCoverSource(song: SongResult, fallback?: string) {
    const source = useContext(LatticeArtworkContext);
    const key = JSON.stringify([getPlaybackSongKey(song), song.album.coverUrl]);
    const [loaded, setLoaded] = useState<{ key: string; url: string | null }>();
    useEffect(() => {
        if (!source) return;
        let active = true;
        const lease = source.acquire(song);
        void lease.promise.then(url => { if (active) setLoaded({ key, url }); });
        return () => { active = false; lease.release(); };
    }, [source, key]);
    return { managed: !!source, url: source ? (loaded?.key === key ? loaded.url ?? undefined : undefined) : fallback };
}
