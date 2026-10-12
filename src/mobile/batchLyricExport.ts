import type { LocalLyricsPriority, LocalSong } from '../types';
import { runLyricExport } from '../services/lyricExport/runLyricExport';
import { collectOnlineLyricSnapshots, type OnlineLyricExportSnapshot } from '../services/lyricExport/collectOnlineLyrics';
import { collectLocalLyricSongs } from '../services/lyricExport/collectLocalLyrics';
import { songToExportMetadata } from '../services/lyricExport/lyricCacheMetadata';
import { mapWithConcurrency, throwIfAborted, type LyricExportOptions, type LyricExportRunContext } from '../services/lyricExport/types';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { localMatchTarget } from '../utils/localMatchDocument';
import { native } from './bridge';

// batchLyricExport.ts — adapt native catalogs to the original batch pipeline; share only the finished ZIP.
export async function readArchive(blob: Blob, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    if (blob.size > 16_000_000) throw new Error('lyric-archive-too-large');
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const abort = () => reader.abort();
        const clean = () => signal?.removeEventListener('abort', abort);
        reader.onload = () => { clean(); resolve(String(reader.result).split(',', 2)[1]); };
        reader.onerror = () => { clean(); reject(reader.error ?? new Error('archive-read-failed')); };
        reader.onabort = () => { clean(); reject(new DOMException('Canceled', 'AbortError')); };
        signal?.addEventListener('abort', abort, { once: true });
        reader.readAsDataURL(blob);
    });
}

export async function exportMobileBatchLyrics(options: LyricExportOptions, priority: LocalLyricsPriority, context: LyricExportRunContext = {}) {
    const { signal, onProgress } = context;
    let exportToken: string | undefined;
    const result = await runLyricExport(options, priority, context, {
        strictStorage: true,
        online: async () => {
            const inventory = await native.listExportLyrics(); exportToken = inventory.token;
            throwIfAborted(signal);
            let done = 0;
            const groups = await mapWithConcurrency(inventory.entries, 2, async item => {
                const { payload } = await native.readExportLyrics({ key: item.key, token: inventory.token });
                throwIfAborted(signal);
                const ref = item.song?.sourceRef;
                const songKey = item.song ? getPlaybackSongKey(item.song) : `native-cache:${item.key}`;
                onProgress?.({ phase: 'collect', done: ++done, total: inventory.entries.length });
                return {
                    songKey, ...payload,
                    ...(item.song ? { meta: songToExportMetadata(item.song), offsetKey: songKey } : {
                        warnings: ['sourceIdentityUnavailable: legacy cache; song-keyed segmentation and offset cannot be recovered'],
                    }),
                    ...(ref?.kind === 'online' ? { providerId: ref.providerId, mediaId: ref.mediaId } : {}),
                } satisfies OnlineLyricExportSnapshot;
            }, signal);
            return collectOnlineLyricSnapshots(groups);
        },
        local: async () => {
            const { songs } = await native.localCatalog();
            throwIfAborted(signal);
            let done = 0;
            const local = await mapWithConcurrency(songs, 2, async song => {
                const snapshot = await native.readLocalMatch({ id: song.sourceRef!.mediaId });
                throwIfAborted(signal);
                onProgress?.({ phase: 'collect', done: ++done, total: songs.length });
                // The collector reads identity, metadata and source fields only; iOS imports have no retained folder tree.
                return { ...localMatchTarget(snapshot), filePath: snapshot.fileName } as LocalSong;
            }, signal);
            const collection = collectLocalLyricSongs(local, priority, context);
            collection.entries = collection.entries.map(entry => ({ ...entry, offsetKey: entry.songKey }));
            return collection;
        },
    });
    throwIfAborted(signal);
    if (result.archive) {
        const data = await readArchive(result.archive.blob, signal);
        throwIfAborted(signal);
        const shared = await native.shareLyricArchive({ fileName: result.archive.fileName, data, token: exportToken });
        throwIfAborted(signal);
        if (!shared.completed) throw new DOMException('Canceled', 'AbortError');
    }
    return result;
}
