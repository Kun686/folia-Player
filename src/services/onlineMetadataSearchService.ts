import type { LocalSongMatchTarget } from '../types/localSongMatch';
import type { LocalSong, SongResult, LyricProviderSource } from '../types';
import { getProviderSongMetadata } from './onlineMusic/songMetadata';
import { getOnlineMusicProvider } from './onlineMusic/providerRegistry';
import { searchQQLyrics } from '../utils/lyrics/providers/qqLyricProvider';
import { buildLyricSearchQuery } from '../utils/lyrics/searchQuery';


import { normalizeOnlineMetadataCandidate as normalizeCandidate, normalizeLyricMatchMetadataCandidate as normalizeLyricCandidate, type OnlineMetadataSource, type OnlineMetadataSearchTarget, type OnlineMetadataCandidate } from '../utils/onlineMetadataCandidate';
export type { OnlineMetadataSource, OnlineMetadataSearchTarget, OnlineMetadataCandidate } from '../utils/onlineMetadataCandidate';

// src/services/onlineMetadataSearchService.ts
// Searches song metadata without invoking any lyric provider or lyric download path.

// Desktop callers retain provider-specific legacy metadata normalization.
export const normalizeOnlineMetadataCandidate = (source: OnlineMetadataSource, result: SongResult, target: OnlineMetadataSearchTarget) =>
    normalizeCandidate(source, result, target, getProviderSongMetadata);
export const normalizeLyricMatchMetadataCandidate = (source: LyricProviderSource, result: SongResult, target: OnlineMetadataSearchTarget) =>
    normalizeLyricCandidate(source, result, target, getProviderSongMetadata);

const stripAudioExtension = (fileName: string) => fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');

export const buildLocalSongMetadataSearchTarget = (song: LocalSongMatchTarget): OnlineMetadataSearchTarget => ({
    title: song.title || stripAudioExtension(song.fileName),
    artist: song.titleOrigin === 'import'
        ? song.importedMetadata.artistNames.join(', ')
        : song.onlineMetadata?.artists.map(artist => artist.name).join(', ') || song.importedMetadata.artistNames.join(', '),
    album: song.titleOrigin === 'import'
        ? song.importedMetadata.albumName || ''
        : song.onlineMetadata?.album?.name || song.importedMetadata.albumName || '',
    durationMs: song.duration || 0,
});

export const buildLocalSongMetadataSearchQuery = (song: LocalSong): string => {
    const target = buildLocalSongMetadataSearchTarget(song);
    return buildLyricSearchQuery(target.title, target.artist, target.album);
};

const throwIfAborted = (signal?: AbortSignal) => {
    if (!signal?.aborted) return;
    const error = new Error('Metadata matching was cancelled');
    error.name = 'AbortError';
    throw error;
};

// Stops waiting immediately when a provider client cannot receive AbortSignal directly.
export const waitForProvider = async <T>(request: Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (!signal) return await request;
    throwIfAborted(signal);
    return await new Promise<T>((resolve, reject) => {
        const abort = () => {
            const error = new Error('Metadata matching was cancelled');
            error.name = 'AbortError';
            reject(error);
        };
        signal.addEventListener('abort', abort, { once: true });
        request.then(
            value => {
                signal.removeEventListener('abort', abort);
                resolve(value);
            },
            error => {
                signal.removeEventListener('abort', abort);
                reject(error);
            },
        );
    });
};

export async function searchOnlineMetadata(
    source: OnlineMetadataSource,
    query: string,
    target: OnlineMetadataSearchTarget,
    options: { limit?: number; signal?: AbortSignal } = {},
): Promise<OnlineMetadataCandidate[]> {
    const safeQuery = query.trim();
    if (!safeQuery) return [];
    throwIfAborted(options.signal);
    const limit = options.limit ?? 10;
    const results = source === 'netease' || source === 'kugou'
        ? ((await waitForProvider(
            getOnlineMusicProvider(source)?.search?.searchSongs(safeQuery, limit, 0)
                || Promise.resolve({ items: [], hasMore: false, nextOffset: 0 }),
            options.signal,
        )).items as SongResult[])
        : await waitForProvider(searchQQLyrics(safeQuery, 1, limit), options.signal);
    throwIfAborted(options.signal);
    return results
        .map(result => normalizeOnlineMetadataCandidate(source, result, target))
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
}

// Preserves the established NetEase-to-QQ fallback and appends KuGou as the final provider-backed source.
export async function findAutomaticOnlineMetadataCandidate(
    song: LocalSong,
    signal?: AbortSignal,
    search: typeof searchOnlineMetadata = searchOnlineMetadata,
): Promise<OnlineMetadataCandidate | null> {
    const target = buildLocalSongMetadataSearchTarget(song);
    const query = buildLocalSongMetadataSearchQuery(song);
    let neteaseCandidates: OnlineMetadataCandidate[] = [];
    try {
        neteaseCandidates = await search('netease', query, target, { limit: 10, signal });
    } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        console.warn('[LocalMusic] NetEase metadata search failed, falling back to QQ:', error);
    }
    if (neteaseCandidates[0]?.titleMatched) return neteaseCandidates[0];
    try {
        const qqCandidates = await search('qq', query, target, { limit: 10, signal });
        if (qqCandidates[0]?.titleMatched) return qqCandidates[0];
    } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        console.warn('[LocalMusic] QQ metadata search failed, falling back to KuGou:', error);
    }
    const kugouCandidates = await search('kugou', query, target, { limit: 10, signal });
    return kugouCandidates[0]?.titleMatched ? kugouCandidates[0] : null;
}
