import type { SongResult } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';

// latticeArtworkSource.ts — wall-scoped, visible-card leases; share bytes and limit native cache work to two requests.
export function createLatticeArtworkSource(load: (song: SongResult) => Promise<string | null>, cached?: (song: SongResult) => Promise<string | null>) {
    type Entry = { song: SongResult; refs: number; checked: boolean; started: boolean; done: boolean; url: string | null;
        promise: Promise<string | null>; resolve: (value: string | null) => void };
    const entries = new Map<string, Entry>();
    let running = 0;
    const releaseURL = (url: string | null) => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); };
    const pump = () => {
        for (const [key, entry] of entries) {
            if (running >= 2) break;
            if (entry.started || entry.done || !entry.refs || !entry.checked) continue;
            entry.started = true; running++;
            void Promise.resolve().then(() => load(entry.song)).catch(() => null).then(url => {
                entry.url = url; entry.done = true; running--;
                if (!entry.refs) { entries.delete(key); releaseURL(url); }
                entry.resolve(entry.refs ? url : null);
                pump();
            });
        }
    };
    return {
        acquire(song: SongResult) {
            const key = JSON.stringify([getPlaybackSongKey(song), song.album.coverUrl]);
            let entry = entries.get(key);
            if (!entry) {
                let resolve!: Entry['resolve'];
                const promise = new Promise<string | null>(done => { resolve = done; });
                entry = { song, refs: 0, checked: !cached, started: false, done: false, url: null, promise, resolve };
                entries.set(key, entry);
                if (cached) {
                    const checking = entry;
                    // Disk hits must not queue behind a slow CDN miss. Native cache reads never start network jobs.
                    void Promise.resolve().then(() => cached(song)).catch(() => null).then(url => {
                        if (!checking.refs) { releaseURL(url); checking.resolve(null); return; }
                        checking.checked = true;
                        if (url) { checking.url = url; checking.done = true; checking.resolve(url); }
                        else pump();
                    });
                }
            }
            entry.refs++; pump();
            let released = false;
            return { promise: entry.promise, release: () => {
                if (released) return;
                released = true;
                if (--entry.refs) return;
                if (!entry.started || entry.done) {
                    entries.delete(key); releaseURL(entry.url); entry.resolve(null);
                }
            } };
        },
    };
}
